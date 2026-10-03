"""Scanning with a still camera over USB (#136): e.g. a Sony a6600 in PC Remote mode, via gphoto2.

StillCamera speaks the same controls as a UVC webcam (engine/camera_lock.py: exposure in 100 µs
units, gain, auto modes), so locking, calibration, HDR and the scan loop work unchanged:
exposure maps to the camera's nearest shutter speed, gain to ISO, and reading a frame takes and
downloads a photo. Focus is set once, on a white frame, before the scan (focus_and_lock), then held:
focusing per pattern fails on dark or striped frames.
"""

import math
from contextlib import contextmanager
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable, Protocol

import numpy as np

BASE_ISO = 100
GAIN_TRIPLES = 15  # gain 15 is about 3x brighter, as on the AC410 (engine/calibrate.py)


STILL_PREFIX = "gphoto2:"  # unique ids of still cameras (webcams use AVFoundation ids)


def is_still(unique_id: str | None) -> bool:
    return bool(unique_id) and unique_id.startswith(STILL_PREFIX)


class CaptureFailed(Exception):
    pass


class DriverError(Exception):
    pass


class StillDriver(Protocol):
    """The camera's own settings and capture (gphoto2's config names and values)."""

    def set_config(self, name: str, value: str) -> None: ...
    def get_config(self, name: str) -> str: ...
    def choices(self, name: str) -> list[str]: ...
    def capture(self) -> np.ndarray: ...


def _seconds(shutter: str) -> float | None:
    """'1/160' -> 0.00625, '2' -> 2.0; None for anything else (e.g. 'Bulb')."""
    try:
        if "/" in shutter:
            a, b = shutter.split("/")
            return float(a) / float(b)
        return float(shutter)
    except ValueError:
        return None


def _nearest(target: float, options: dict[str, float]) -> str:
    """The option nearest the target on a log scale (exposure steps are multiplicative)."""
    return min(options, key=lambda k: abs(math.log(options[k] / target)))


@contextmanager
def _answering():
    """A camera that stops answering (a hung or failed gphoto2 call) is a clear error, not a crash."""
    try:
        yield
    except DriverError as e:
        raise CaptureFailed(f"The camera isn't answering ({e}). Turn it off and on, and check it's in PC Remote.") from e


class StillCamera:
    def __init__(self, driver: StillDriver, retries: int = 2):
        self.driver = driver
        self.retries = retries
        self._other: dict[str, str] = {}  # webcam-only controls (white balance, focus-abs): kept, unused
        self._exposure: str | None = None
        self._gain = "0"

    def prepare(self) -> None:
        """Photos sized for scanning, kept off the memory card (faster, no card wear)."""
        with _answering():
            self.driver.set_config("imagequality", "Fine")
            self.driver.set_config("imagesize", "Medium")
            self.driver.set_config("capturetarget", "sdram")

    # The webcam controls (engine/camera_lock.Uvc)
    def get(self, name: str) -> str:
        with _answering():
            return self._get(name)

    def set(self, name: str, value: str) -> None:
        with _answering():
            self._set(name, value)

    def _get(self, name: str) -> str:
        if name == "exposure-time-abs":
            if self._exposure is None:
                seconds = _seconds(self.driver.get_config("shutterspeed")) or 0.01
                self._exposure = str(round(seconds * 10000))
            return self._exposure
        if name == "gain":
            return self._gain
        if name == "auto-exposure-mode":
            return "1" if self.driver.get_config("expprogram") == "M" else "8"
        return self._other.get(name, "0")

    def _set(self, name: str, value: str) -> None:
        if name == "exposure-time-abs":
            shutters = {s: v for s in self.driver.choices("shutterspeed") if (v := _seconds(s))}
            choice = _nearest(int(value) / 10000, shutters)
            self.driver.set_config("shutterspeed", choice)
            self._exposure = str(round(shutters[choice] * 10000))
        elif name == "gain":
            isos = {s: float(s) for s in self.driver.choices("iso") if s.isdigit()}
            want = BASE_ISO * 3 ** (int(value) / GAIN_TRIPLES)
            self.driver.set_config("iso", _nearest(want, isos))
            self._gain = value
        elif name == "auto-exposure-mode":
            self.driver.set_config("expprogram", "M" if value == "1" else "P")
        else:  # auto-focus, white balance: focus is held by focus_and_lock; white balance doesn't matter
            self._other[name] = value

    def focus_and_lock(self, timeout: float = 5.0) -> None:
        """Autofocuses once (on whatever is projected: use a white frame), then holds that focus."""
        with _answering():
            self.driver.set_config("focusmode", "Automatic")
            self.driver.set_config("autofocus", "1")
            end = time.monotonic() + timeout
            try:
                while self.driver.get_config("focusindication") != "Focus Locked":
                    if time.monotonic() > end:
                        raise CaptureFailed("The camera couldn't focus. Check the lens cap and that it sees the white frame.")
                    time.sleep(0.1)
            finally:
                self.driver.set_config("autofocus", "0")
            self.driver.set_config("focusmode", "Manual")  # holds the focus it just found

    def read(self) -> np.ndarray:
        """Takes a photo and returns it (BGR), retrying a failed or hung capture."""
        for attempt in range(self.retries + 1):
            try:
                return self.driver.capture()
            except DriverError:
                if attempt == self.retries:
                    break
        raise CaptureFailed("The camera didn't take a photo. Check it's on, in PC Remote, and not showing a menu.")

    def close(self) -> None:
        pass  # the connection is the app's (SharedStill), kept open between scans and previews


class FakeStillDriver:
    """A still camera for tests: remembers its settings and calls; photos are 32x24 gray frames."""

    def __init__(self, shutters: list[str], isos: list[str], never_focuses: bool = False, fail_next: int = 0,
                 frame=None):
        self._choices = {"shutterspeed": shutters, "iso": isos}
        self.config = {"shutterspeed": shutters[len(shutters) // 2], "iso": isos[0], "expprogram": "P",
                       "focusmode": "Manual", "focusindication": "Unlock"}
        self.calls: list[tuple] = []
        self.never_focuses = never_focuses
        self.fail_next = fail_next
        self.captures = 0
        self.frame = frame  # optional: a function returning the photo (e.g. a synthetic scene)

    def set_config(self, name: str, value: str) -> None:
        self.calls.append(("set", name, value))
        self.config[name] = value
        if name == "autofocus" and value == "1" and not self.never_focuses:
            self.config["focusindication"] = "Focus Locked"

    def get_config(self, name: str) -> str:
        self.calls.append(("get", name))
        return self.config.get(name, "")

    def choices(self, name: str) -> list[str]:
        return self._choices.get(name, [])

    def capture(self) -> np.ndarray:
        self.calls.append(("capture",))
        self.captures += 1
        if self.fail_next:
            self.fail_next -= 1
            raise DriverError("Could not capture image")
        if self.frame:
            return self.frame()
        return np.full((24, 32, 3), 128, np.uint8)


# The real camera, through the gphoto2 command line.

def parse_auto_detect(text: str) -> list[dict]:
    """`gphoto2 --auto-detect` output -> camera entries for Hardware (device_type "still")."""
    cameras = []
    for line in text.splitlines()[2:]:
        model = re.split(r"\s{2,}", line.strip())[0] if line.strip() else ""
        if model:
            name = model.replace("(PC Control)", "").strip()
            cameras.append({"name": name, "unique_id": STILL_PREFIX + model, "device_type": "still"})
    return cameras


def _stop_macos_camera_service() -> None:
    for name in ("ptpcamerad", "mscamerad-xpc"):
        subprocess.run(["pkill", "-9", "-x", name], capture_output=True)


def list_still_cameras() -> list[dict]:
    """Still cameras on USB, for Hardware; [] without gphoto2 or a camera."""
    try:
        r = subprocess.run(["gphoto2", "--auto-detect"], capture_output=True, text=True, timeout=10)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []
    return parse_auto_detect(r.stdout)


def _as_numbers(value: str) -> list:
    out = []
    for kind in (int, float):
        try:
            out.append(kind(value))
        except ValueError:
            pass
    return out


class GPhoto2Session:
    """The camera over USB through libgphoto2 (python-gphoto2), connected once and held: reconnecting
    for every command gave macOS's camera service a gap to grab it ("Could not claim the USB device").
    One command at a time; a dropped connection is reopened once and the command retried."""

    def __init__(self, camera: Callable[[], object] | None = None, stop_macos: Callable[[], None] = _stop_macos_camera_service,
                 connect_seconds: float = 6.0, call_seconds: float = 30.0):
        self._new = camera or self._gphoto2_camera
        self._stop_macos = stop_macos
        self._connect_seconds = connect_seconds
        self._call_seconds = call_seconds
        self._lock = threading.RLock()
        self._cam = None

    @staticmethod
    def _gphoto2_camera():
        import gphoto2 as gp  # macOS rig only; tests pass a fake

        return gp.Camera()

    def _open(self):
        """Connects, if not already. macOS's camera service grabs PTP cameras and respawns within
        milliseconds of being stopped, so it's kept off in the background while connecting, and
        connecting is retried until the camera is ours (then macOS can't take it)."""
        if self._cam is not None:
            return self._cam
        done = threading.Event()

        def keep_off():
            while not done.wait(0.05):
                self._stop_macos()

        guard = threading.Thread(target=keep_off, daemon=True)
        guard.start()
        end = time.monotonic() + self._connect_seconds
        try:
            while True:
                self._stop_macos()
                cam = self._new()
                try:
                    cam.init()
                    self._cam = cam
                    return cam
                except Exception as e:
                    if time.monotonic() > end:
                        raise DriverError(f"couldn't connect: {e}") from e
                    time.sleep(0.1)
        finally:
            done.set()

    def _timed(self, what: str, fn):
        """Runs one camera call with a time limit: a call stuck inside libgphoto2 (a camera that
        stopped answering) mustn't freeze the engine. The stuck connection is abandoned; the next
        call reconnects."""
        result: dict = {}

        def run():
            try:
                result["value"] = fn(self._open())
            except BaseException as e:
                result["error"] = e

        worker = threading.Thread(target=run, daemon=True)
        worker.start()
        worker.join(self._call_seconds)
        if worker.is_alive():
            self._cam = None  # abandoned: exit() could hang too
            raise DriverError(f"{what}: the camera didn't answer within {self._call_seconds:.0f} s")
        if "error" in result:
            raise result["error"]
        return result["value"]

    def _do(self, what: str, fn, retry: bool = True):
        with self._lock:
            try:
                return self._timed(what, fn)
            except DriverError:
                raise
            except Exception as e:  # gphoto2.GPhoto2Error and friends
                self._drop()
                if not retry:
                    raise DriverError(f"{what}: {e}") from e
                try:
                    return self._timed(what, fn)
                except Exception as e2:
                    self._drop()
                    raise DriverError(f"{what}: {e2}") from e2

    def _drop(self) -> None:
        if self._cam is not None:
            try:
                self._cam.exit()
            except Exception:
                pass
            self._cam = None

    def get_config(self, name: str) -> str:
        return self._do(f"reading {name}", lambda cam: str(cam.get_config().get_child_by_name(name).get_value()))

    def choices(self, name: str) -> list[str]:
        return self._do(f"reading {name}", lambda cam: [str(c) for c in cam.get_config().get_child_by_name(name).get_choices()])

    def set_config(self, name: str, value: str) -> None:
        def apply(cam):
            tree = cam.get_config()
            widget = tree.get_child_by_name(name)
            # Menus and text take the label; toggles (autofocus) and ranges (manualfocus) want numbers.
            for v in (value, *_as_numbers(value)):
                try:
                    widget.set_value(v)
                    break
                except TypeError:
                    continue
                except ValueError as e:
                    raise DriverError(f"{name} can't be {value!r}") from e
            else:
                raise DriverError(f"{name} can't be {value!r}")
            cam.set_config(tree)

        self._do(f"setting {name}", apply)

    def capture(self) -> np.ndarray:
        import cv2

        def shoot(cam):
            path = cam.capture(0)  # GP_CAPTURE_IMAGE
            data = cam.file_get(path.folder, path.name, 1).get_data_and_size()  # GP_FILE_TYPE_NORMAL
            frame = cv2.imdecode(np.frombuffer(memoryview(data), np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                raise DriverError("the camera sent no photo (set File Format to JPEG)")
            return frame

        return self._do("taking a photo", shoot)

    def close(self) -> None:
        if self._lock.acquire(timeout=2):  # a call stuck in libgphoto2 mustn't hold up shutdown
            try:
                self._drop()
            finally:
                self._lock.release()
        else:
            self._cam = None


class SharedStill:
    """The app's one connection per still camera, shared by preview, calibration and scans."""

    def __init__(self, open_driver: Callable[[str], object] = lambda uid: GPhoto2Session()):
        self._open_driver = open_driver
        self._uid: str | None = None
        self._driver = None
        self._lock = threading.Lock()

    def camera(self, unique_id: str) -> StillCamera:
        with self._lock:
            if self._uid != unique_id:
                self.close()
                self._driver, self._uid = self._open_driver(unique_id), unique_id
            return StillCamera(self._driver)

    def close(self) -> None:
        if self._driver is not None and hasattr(self._driver, "close"):
            self._driver.close()
        self._driver, self._uid = None, None


_shared = SharedStill()


def open_gphoto2_camera(unique_id: str) -> StillCamera:
    """The shared, held connection to a still camera (see SharedStill)."""
    return _shared.camera(unique_id)


def close_still_cameras() -> None:
    """Releases the held still camera (engine shutdown)."""
    _shared.close()
