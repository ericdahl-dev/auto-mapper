"""Scanning with a still camera over USB (#136): e.g. a Sony a6600 in PC Remote mode, via gphoto2.

StillCamera speaks the same controls as a UVC webcam (engine/camera_lock.py: exposure in 100 µs
units, gain, auto modes), so locking, calibration, HDR and the scan loop work unchanged:
exposure maps to the camera's nearest shutter speed, gain to ISO, and reading a frame takes and
downloads a photo. Focus is set once, on a white frame, before the scan (focus_and_lock), then held:
focusing per pattern fails on dark or striped frames.
"""

import math
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Protocol

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


class StillCamera:
    def __init__(self, driver: StillDriver, retries: int = 2):
        self.driver = driver
        self.retries = retries
        self._other: dict[str, str] = {}  # webcam-only controls (white balance, focus-abs): kept, unused
        self._exposure: str | None = None
        self._gain = "0"

    def prepare(self) -> None:
        """Photos sized for scanning, kept off the memory card (faster, no card wear)."""
        self.driver.set_config("imagequality", "Fine")
        self.driver.set_config("imagesize", "Medium")
        self.driver.set_config("capturetarget", "sdram")

    # The webcam controls (engine/camera_lock.Uvc)
    def get(self, name: str) -> str:
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

    def set(self, name: str, value: str) -> None:
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
        close = getattr(self.driver, "close", None)
        if close:
            close()


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

def parse_config(text: str) -> tuple[str, list[str]]:
    """`gphoto2 --get-config` output -> (current value, choices)."""
    current, choices = "", []
    for line in text.splitlines():
        if line.startswith("Current: "):
            current = line[len("Current: "):].strip()
        elif line.startswith("Choice: "):
            choices.append(line[len("Choice: "):].split(" ", 1)[1].strip())
    return current, choices


def parse_auto_detect(text: str) -> list[dict]:
    """`gphoto2 --auto-detect` output -> camera entries for Hardware (device_type "still")."""
    cameras = []
    for line in text.splitlines()[2:]:
        model = re.split(r"\s{2,}", line.strip())[0] if line.strip() else ""
        if model:
            name = model.replace("(PC Control)", "").strip()
            cameras.append({"name": name, "unique_id": STILL_PREFIX + model, "device_type": "still"})
    return cameras


class _KeepMacOsOff:
    """macOS's camera service (ptpcamerad) grabs PTP cameras and respawns when stopped, so it's
    stopped over and over while the camera is in use. By exact process name only."""

    def __init__(self):
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.wait(0.1):
            for name in ("ptpcamerad", "mscamerad-xpc"):
                subprocess.run(["pkill", "-9", "-x", name], capture_output=True)

    def stop(self) -> None:
        self._stop.set()


class GPhoto2Driver:
    """One camera over USB, through the gphoto2 command line (each call opens and closes it)."""

    def __init__(self, timeout: float = 20.0):
        self.timeout = timeout
        self._guard = _KeepMacOsOff()
        self._choices: dict[str, list[str]] = {}
        self._dir = Path(tempfile.mkdtemp(prefix="auto-mapper-still-"))

    def _run(self, *args: str, timeout: float | None = None) -> str:
        try:
            r = subprocess.run(["gphoto2", *args], capture_output=True, text=True, timeout=timeout or self.timeout)
        except FileNotFoundError:
            raise DriverError("gphoto2 isn't installed: brew install gphoto2")
        except subprocess.TimeoutExpired:
            raise DriverError(f"gphoto2 {args[0]} timed out")
        if r.returncode != 0 or "*** Error" in r.stdout + r.stderr:
            raise DriverError((r.stderr or r.stdout).strip().splitlines()[-1] if (r.stderr or r.stdout).strip() else "gphoto2 failed")
        return r.stdout

    def set_config(self, name: str, value: str) -> None:
        self._run("--set-config-value", f"{name}={value}")

    def get_config(self, name: str) -> str:
        current, choices = parse_config(self._run("--get-config", name))
        self._choices.setdefault(name, choices)
        return current

    def choices(self, name: str) -> list[str]:
        if name not in self._choices:
            self.get_config(name)
        return self._choices[name]

    def capture(self) -> np.ndarray:
        import cv2

        for old in self._dir.glob("shot.*"):
            old.unlink()
        self._run("--capture-image-and-download", "--filename", str(self._dir / "shot.%C"), "--force-overwrite")
        shots = list(self._dir.glob("shot.*"))
        frame = cv2.imread(str(shots[0])) if shots else None
        if frame is None:
            raise DriverError("The camera sent no photo (set File Format to JPEG)")
        return frame

    def close(self) -> None:
        self._guard.stop()
        shutil.rmtree(self._dir, ignore_errors=True)


def list_still_cameras() -> list[dict]:
    """Still cameras on USB, for Hardware; [] without gphoto2 or a camera."""
    try:
        r = subprocess.run(["gphoto2", "--auto-detect"], capture_output=True, text=True, timeout=10)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []
    return parse_auto_detect(r.stdout)


def open_gphoto2_camera(unique_id: str) -> StillCamera:
    return StillCamera(GPhoto2Driver())
