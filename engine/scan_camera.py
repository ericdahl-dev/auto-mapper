"""The camera a scan uses, whatever kind it is (#143).

Preview, calibration and scans ask the selected camera to take over, read frames, and give it back;
what that means is up to each kind:

- a USB webcam (the AC410): UVC controls locked (auto exposure, white balance and focus off) with a
  snapshot on disk for crash recovery; frames from the open OpenCV stream, a few dropped after each
  change (it buffers) and several averaged per pattern (sensor noise).
- a still camera over USB (the a6600, #136): full control for the scan (scan_profile), the battery
  checked first, focused once on the white frame the caller shows, then held; each frame a fresh
  photo, so none dropped or averaged.

Callers show white on the output window before taking over (a still camera focuses on it).
"""

import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator, Protocol

import numpy as np

from engine.calibrate import LONGER_EXPOSURES
from engine.camera_device import CameraSession
from engine.camera_lock import Uvc, locked_camera
from engine.cameras import CameraSettings, UsbAddress, usb_address
from engine.still_camera import FLAT_BATTERY, CaptureFailed, StillCamera, is_still

STILL_PREVIEW_SECONDS = 5.0  # how long a still camera's preview photo is reused
STILL_RETRY_SECONDS = 10.0  # after a failed preview photo, don't queue up retries of a stuck camera
STILL_SNAPSHOT = "still-camera-restore.json"  # the owner's settings while a scan has the camera


class NotScannable(Exception):
    """The selected camera can be previewed but not controlled for calibration or scans."""


class ScanCamera(Protocol):
    drop_frames: int  # frames read and thrown away after a pattern or exposure change
    frames_per_pattern: int  # frames averaged per pattern
    controls: Uvc  # exposure and gain, set by calibration and HDR
    longer_exposures: tuple[int, ...]  # exposures (100 us units) calibration tries first, longest first

    def preview(self) -> np.ndarray: ...
    def taken_over(self) -> Iterator[None]: ...  # a context manager: control for the scan, given back after
    def read(self) -> np.ndarray: ...


class _Webcam:
    def __init__(self, session: CameraSession, cameras: list[dict], selected: str, uvc: Uvc | None,
                 data_dir: Path, drop_frames: int, frames_per_pattern: int):
        self._session, self._cameras, self._selected = session, cameras, selected
        self._uvc, self._data_dir = uvc, data_dir
        self.drop_frames, self.frames_per_pattern = drop_frames, frames_per_pattern
        self.longer_exposures = LONGER_EXPOSURES

    @property
    def controls(self) -> Uvc:
        if self._uvc is None:
            raise NotScannable("Calibration and scans need a USB webcam with UVC controls, or a still camera over USB")
        return self._uvc

    def preview(self) -> np.ndarray:
        return self.read()

    @contextmanager
    def taken_over(self) -> Iterator[None]:
        with locked_camera(self.controls, self._data_dir):
            yield

    def read(self) -> np.ndarray:
        return self._session.read(self._cameras, self._selected)


class _StillPreview:
    """A still camera takes a photo per preview (1.5-4 s) while the editor polls twice a second: a
    recent photo is reused, one is taken at a time, and a failure isn't retried for a while."""

    def __init__(self):
        self.lock = threading.Lock()
        self.frame: np.ndarray | None = None
        self.at = self.failed_at = 0.0
        self.error = ""


class _Still:
    drop_frames = 0  # each frame is a fresh photo
    frames_per_pattern = 1

    def __init__(self, still: StillCamera, aperture: str | None, data_dir: Path,
                 on_battery: Callable[[int | None], None], preview_state: _StillPreview):
        self._still, self._aperture, self._data_dir = still, aperture, data_dir
        self._on_battery, self._preview = on_battery, preview_state
        self.controls = still  # exposure -> shutter speed, gain -> ISO
        self.longer_exposures = still.longer_exposures

    def _battery(self) -> int | None:
        level = self._still.battery()
        self._on_battery(level)
        return level

    def preview(self) -> np.ndarray:
        p = self._preview
        if time.monotonic() - p.failed_at < STILL_RETRY_SECONDS:
            raise CaptureFailed(p.error)
        with p.lock:
            if p.frame is None or time.monotonic() - p.at > STILL_PREVIEW_SECONDS:
                try:
                    self._battery()
                    self._still.prepare(aperture=self._aperture)
                    p.frame = self._still.read()
                except CaptureFailed as e:
                    p.failed_at, p.error = time.monotonic(), str(e)
                    raise
                p.at = time.monotonic()
            return p.frame

    @contextmanager
    def taken_over(self) -> Iterator[None]:
        level = self._battery()
        if level is not None and level <= FLAT_BATTERY:
            raise CaptureFailed(f"The camera battery is at {level}%: charge or swap it before scanning.")
        with self._still.scan_profile(aperture=self._aperture, snapshot=self._data_dir / STILL_SNAPSHOT):
            self._still.focus_and_lock()  # on the white frame the caller shows; refocusing on stripes fails
            yield

    def read(self) -> np.ndarray:
        return self._still.read()


class ScanCameras:
    """Opens the selected camera as a ScanCamera. The one place that knows which kinds there are."""

    def __init__(self, *, session: CameraSession, make_uvc: Callable[[UsbAddress], Uvc],
                 make_still: Callable[[str], StillCamera], settings: CameraSettings, data_dir: Path,
                 drop_frames: int, frames_per_pattern: int,
                 on_battery: Callable[[int | None], None] = lambda level: None):
        self._session, self._make_uvc, self._make_still = session, make_uvc, make_still
        self._settings, self._data_dir = settings, Path(data_dir)
        self._drop_frames, self._frames_per_pattern = drop_frames, frames_per_pattern
        self.on_battery = on_battery  # a still camera's battery level, each time it's read
        self._still_preview = _StillPreview()

    def open(self, cameras: list[dict], selected: str) -> ScanCamera:
        if is_still(selected):
            aperture = self._settings.scan_settings(selected).get("aperture", "8")
            return _Still(self._make_still(selected), None if aperture == "camera" else aperture,
                          self._data_dir, lambda level: self.on_battery(level), self._still_preview)
        address = usb_address(selected)
        uvc = self._make_uvc(address) if address is not None else None
        return _Webcam(self._session, cameras, selected, uvc, self._data_dir,
                       self._drop_frames, self._frames_per_pattern)

    def scannable(self, selected: str | None) -> bool:
        return selected is not None and (is_still(selected) or usb_address(selected) is not None)

    def release(self) -> None:
        """Frees the webcam stream (a still camera's connection is kept: reconnecting is slow and flaky)."""
        self._session.close()
