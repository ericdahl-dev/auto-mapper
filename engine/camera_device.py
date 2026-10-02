"""Opening and reading the selected camera. Only one camera is ever open at a time."""

import threading
from typing import Callable, Protocol

import numpy as np

from engine.cameras import opencv_index


class Camera(Protocol):
    def read(self) -> np.ndarray: ...
    def close(self) -> None: ...


# Ask for the camera's full resolution. OpenCV's default (1080p) left 3/4 of the AC410's
# 4K sensor unused, and the finest scan stripes undecodable.
CAPTURE_SIZE = (3840, 2160)


class CameraFactory(Protocol):
    def open(self, index: int, size: tuple[int, int] = CAPTURE_SIZE) -> Camera: ...


class OpenCVCamera:
    WARMUP_FRAMES = 8  # first frames after opening are dark while the sensor settles

    def __init__(self, index: int, size: tuple[int, int] = CAPTURE_SIZE):
        import cv2

        self._cap = cv2.VideoCapture(index, cv2.CAP_AVFOUNDATION)
        if not self._cap.isOpened():
            raise RuntimeError(f"Could not open camera {index}")
        # A camera that can't do this size picks its nearest; frames report the real size.
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, size[0])
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, size[1])
        for _ in range(self.WARMUP_FRAMES):
            self._cap.read()

    def read(self) -> np.ndarray:
        ok, frame = self._cap.read()
        if not ok:
            raise RuntimeError("Camera read failed")
        return frame

    def close(self) -> None:
        self._cap.release()


class OpenCVCameraFactory:
    def open(self, index: int, size: tuple[int, int] = CAPTURE_SIZE) -> Camera:
        return OpenCVCamera(index, size)


class FakeCamera:
    def __init__(self, factory: "FakeCameraFactory", index: int):
        self.factory, self.index = factory, index

    def read(self) -> np.ndarray:
        if self.factory.frame is not None:
            return self.factory.frame()
        b = self.factory.brightness
        return np.full((self.factory.height, self.factory.width, 3), b() if callable(b) else b, np.uint8)

    def close(self) -> None:
        self.factory.open_now.remove(self.index)


class FakeCameraFactory:
    """Test camera: records which OpenCV indices were opened and which are still open."""

    def __init__(
        self,
        width: int = 320,
        height: int = 180,
        brightness: int | Callable[[], int] = 128,
        frame: Callable[[], np.ndarray] | None = None,  # e.g. a synthetic scene renderer
    ):
        self.width, self.height, self.brightness, self.frame = width, height, brightness, frame
        self.opened: list[int] = []
        self.open_now: list[int] = []
        self.requested_sizes: list[tuple[int, int]] = []

    def open(self, index: int, size: tuple[int, int] = CAPTURE_SIZE) -> Camera:
        self.requested_sizes.append(size)
        self.opened.append(index)
        self.open_now.append(index)
        return FakeCamera(self, index)


class CameraSession:
    """Keeps the selected camera open and switches when the selection changes."""

    def __init__(self, factory: CameraFactory, size: tuple[int, int] = CAPTURE_SIZE):
        self._factory = factory
        self._size = size
        self._lock = threading.Lock()
        self._camera: Camera | None = None
        self._unique_id: str | None = None

    def read(self, cameras: list[dict], unique_id: str) -> np.ndarray:
        with self._lock:
            if unique_id != self._unique_id:
                self._close()
                index = opencv_index(cameras, unique_id)
                if index is None:
                    raise LookupError(unique_id)
                self._camera = self._factory.open(index, self._size)
                self._unique_id = unique_id
            return self._camera.read()

    def close(self) -> None:
        with self._lock:
            self._close()

    def _close(self) -> None:
        if self._camera is not None:
            self._camera.close()
        self._camera, self._unique_id = None, None
