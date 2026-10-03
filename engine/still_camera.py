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


LOW_BATTERY = 20  # percent: warn
FLAT_BATTERY = 10  # percent: don't start a scan (a camera dying mid-scan wastes it, and can stick)


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


def _f_number(text: str) -> float | None:
    """'f/5.6' -> 5.6; None for anything else."""
    try:
        return float(text.removeprefix("f/")) if text.startswith("f/") else None
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

    # Calibration may use exposures this long (100 us units): a still camera on a tripod can take
    # seconds, which a small aperture in a dim room needs.
    longer_exposures = (20000, 10000, 5000, 3000)

    # How every pattern photo is made (scan_profile): single shots (no bursts), fixed white balance,
    # no DRO, flash or exposure compensation, M mode, a wide focus area for the one-time focus, and
    # photos sized for scanning kept off the card. Settings a camera doesn't have are skipped.
    SCAN_SETTINGS = (
        ("capturemode", "Single Shot"), ("whitebalance", "Daylight"), ("dro", "Off"), ("flashmode", "Flash off"),
        ("exposurecompensation", "0"), ("expprogram", "M"), ("focusarea", "Wide"),
        ("imagequality", "Fine"), ("imagesize", "Medium"), ("capturetarget", "sdram"),
    )
    # Changed during a scan, so put back too.
    SCAN_CHANGES = ("f-number", "shutterspeed", "iso", "focusmode")

    @contextmanager
    def scan_profile(self, aperture: str | None = None):
        """Takes full control of the camera for a scan or calibration, then gives it back exactly as
        the owner had it."""
        names = [n for n, _ in self.SCAN_SETTINGS] + list(self.SCAN_CHANGES)
        original: dict[str, str] = {}
        for name in names:
            try:
                original[name] = self.driver.get_config(name)
            except DriverError:
                pass  # this camera doesn't have it
        try:
            for name, value in self.SCAN_SETTINGS:
                if name in original:
                    with _answering():
                        self.driver.set_config(name, value)
            self._exposure = None  # read afresh in M mode
            self.prepare(aperture=aperture)
            yield self
        finally:
            # Exposure program last: the shutter, ISO and aperture it restores need M while set.
            for name in sorted(original, key=lambda n: n == "expprogram"):
                try:
                    self.driver.set_config(name, original[name])
                except DriverError:
                    pass  # best effort: never fail a finished scan over a setting

    def prepare(self, aperture: str | None = None) -> None:
        """Photos sized for scanning, kept off the memory card (faster, no card wear); and the
        aperture, e.g. "8" for f/8 (deep focus for a scene with depth), or None to leave the lens."""
        with _answering():
            self.driver.set_config("imagequality", "Fine")
            self.driver.set_config("imagesize", "Medium")
            self.driver.set_config("capturetarget", "sdram")
            if aperture:
                self.driver.set_config("expprogram", "M")  # the aperture is only the app's to set in M
                stops = {c: v for c in self.driver.choices("f-number") if (v := _f_number(c))}
                if stops:
                    self.driver.set_config("f-number", _nearest(float(aperture), stops))

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

    def battery(self) -> int | None:
        """Battery level in percent, or None if the camera doesn't report it."""
        with _answering():
            text = self.driver.get_config("batterylevel")
        digits = text.strip().rstrip("%")
        return int(digits) if digits.isdigit() else None

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

def decode_photo(data: bytes) -> np.ndarray | None:
    """The photo in what the camera sent: a JPEG, or (the a6600 over USB, seen 2026-10-03) a Sony
    wrapper holding EXIF tags, a thumbnail, the main photo's JPEG without its start marker, and a
    1920x1080 preview. Each JPEG inside is tried, with the start marker put back where it's missing;
    the largest that decodes is the photo."""
    import cv2

    frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if frame is not None:
        return frame
    starts = set()
    for marker in (b"\xff\xd8\xff", b"\xff\xdb"):  # a JPEG's start, or its first table (start lost)
        i = data.find(marker)
        while i != -1:
            starts.add(i if marker[1] == 0xD8 else -i)
            i = data.find(marker, i + 1)
    best = None
    for start in starts:
        chunk = data[start:] if start >= 0 else b"\xff\xd8" + data[-start:]
        if start < 0 and data[-start - 2:-start] == b"\xff\xd8":
            continue  # a table right after a start marker: tried as that JPEG already
        img = cv2.imdecode(np.frombuffer(chunk, np.uint8), cv2.IMREAD_COLOR)
        if img is not None and (best is None or img.shape[0] * img.shape[1] > best.shape[0] * best.shape[1]):
            best = img
    return best


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
                 connect_seconds: float = 12.0, call_seconds: float = 30.0, settle_seconds: float = 1.0,
                 retry_seconds: float = 3.0, ready_seconds: float = 15.0, ready_poll_seconds: float = 0.5):
        self._new = camera or self._gphoto2_camera
        self._stop_macos = stop_macos
        self._connect_seconds = connect_seconds
        self._call_seconds = call_seconds
        self._settle_seconds = settle_seconds  # macOS's service kept off this long before the first try
        self._retry_seconds = retry_seconds  # between tries: a failed one leaves a Sony "Connecting"
        self._ready_seconds, self._ready_poll_seconds = ready_seconds, ready_poll_seconds
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
            self._stop_macos()
            time.sleep(self._settle_seconds)  # let macOS's service actually let go first
            while True:
                cam = self._new()
                try:
                    cam.init()
                except Exception as e:
                    if time.monotonic() + self._retry_seconds > end:
                        raise DriverError(f"couldn't connect: {e}") from e
                    time.sleep(self._retry_seconds)  # few, spaced tries: hammering kept it "Connecting"
                    continue
                self._wait_until_awake(cam)
                self._cam = cam
                return cam
        finally:
            done.set()

    # What the a6600 reports for ~5 s after connecting, before its real settings (placeholders).
    _PLACEHOLDERS = {"shutterspeed": "65535/65535", "f-number": "f/0", "iso": "0"}

    def _wait_until_awake(self, cam) -> None:
        """Waits until the camera reports real settings. Read before that, a scan's record of the
        owner's settings was placeholders, and giving them back put the camera in RAW."""
        end = time.monotonic() + self._ready_seconds
        while True:
            tree = cam.get_config()
            asleep = []
            for name, placeholder in self._PLACEHOLDERS.items():
                try:
                    if str(tree.get_child_by_name(name).get_value()) == placeholder:
                        asleep.append(name)
                except Exception:
                    pass  # a camera without this setting
            if not asleep:
                return
            if time.monotonic() > end:
                try:
                    cam.exit()
                except Exception:
                    pass
                raise DriverError(f"the camera connected but hasn't reported its settings ({', '.join(asleep)}): "
                                  "turn it off and on again")
            time.sleep(self._ready_poll_seconds)

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
            frame = decode_photo(bytes(memoryview(data)))
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
