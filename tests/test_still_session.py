"""#136: one held gphoto2 session for the still camera (no reconnect per command, so macOS can't grab
it in between), shared by preview, calibration and scans."""

import cv2
import numpy as np
import pytest

from engine.still_camera import DriverError, GPhoto2Session, SharedStill


class Widget:
    def __init__(self, value, choices=()):
        self.value, self.choices = value, list(choices)

    def get_value(self):
        return self.value

    def set_value(self, v):
        if self.choices and v not in self.choices:
            raise ValueError(v)
        self.value = v

    def get_choices(self):
        return self.choices


class Tree:
    def __init__(self, widgets):
        self.widgets = widgets

    def get_child_by_name(self, name):
        return self.widgets[name]


class Path:
    folder, name = "/", "capt0001.JPG"


class FakeGpCamera:
    """The parts of gphoto2.Camera the session uses."""

    opened = 0

    def __init__(self, fail_captures=0):
        self.settings = {"shutterspeed": Widget("1/60", ["1/30", "1/60"]), "imagequality": Widget("RAW", ["RAW", "Fine"]),
                         "focusindication": Widget("Unlock")}
        self.applied: list[str] = []
        self.fail_captures = fail_captures
        self.inits = 0

    def init(self):
        self.inits += 1
        FakeGpCamera.opened += 1

    def exit(self):
        pass

    def get_config(self):
        return Tree({k: type(w)(w.value, w.choices) for k, w in self.settings.items()})

    def set_config(self, tree):
        for k, w in tree.widgets.items():
            if w.value != self.settings[k].value:
                self.applied.append(f"{k}={w.value}")
                self.settings[k].value = w.value

    def capture(self, kind):
        if self.fail_captures:
            self.fail_captures -= 1
            raise IOError("[-7] I/O problem")
        return Path()

    def file_get(self, folder, name, kind):
        class File:
            def get_data_and_size(self):
                ok, jpg = cv2.imencode(".jpg", np.full((12, 16, 3), 200, np.uint8))
                return jpg.tobytes()
        return File()


def session(cam):
    return GPhoto2Session(camera=lambda: cam, stop_macos=lambda: calls.append("stop macos"))


calls: list[str] = []


def test_settings_go_through_the_cameras_settings_tree():
    cam = FakeGpCamera()
    s = session(cam)
    assert s.get_config("shutterspeed") == "1/60"
    assert s.choices("shutterspeed") == ["1/30", "1/60"]
    s.set_config("imagequality", "Fine")
    assert cam.applied == ["imagequality=Fine"]
    with pytest.raises(DriverError):
        s.set_config("imagequality", "Huge")


def test_one_connection_for_many_commands_and_macos_kept_off_first():
    calls.clear()
    cam = FakeGpCamera()
    s = session(cam)
    for _ in range(5):
        s.get_config("shutterspeed")
        s.capture()
    assert cam.inits == 1
    assert calls[0] == "stop macos"


def test_photos_come_back_as_images():
    frame = session(FakeGpCamera()).capture()
    assert frame.shape == (12, 16, 3)


def test_a_dropped_connection_reopens_once_and_retries():
    cam = FakeGpCamera(fail_captures=1)
    s = session(cam)
    assert s.capture().shape == (12, 16, 3)
    assert cam.inits == 2
    cam.fail_captures = 2
    with pytest.raises(DriverError):
        s.capture()


def test_the_app_shares_one_session_per_camera():
    opened = []
    shared = SharedStill(open_driver=lambda uid: opened.append(uid) or FakeDriverStub())
    a = shared.camera("gphoto2:A6600")
    b = shared.camera("gphoto2:A6600")
    assert opened == ["gphoto2:A6600"] and a.driver is b.driver
    a.close()  # a scan or preview finishing doesn't close the shared session
    assert not b.driver.closed
    shared.close()
    assert b.driver.closed


class FakeDriverStub:
    closed = False

    def close(self):
        self.closed = True


def test_connecting_keeps_trying_while_macos_grabs_the_camera_first():
    """macOS's camera service respawns in milliseconds and grabs the camera; connecting retries
    for a few seconds, keeping it off meanwhile, instead of failing on the first try."""
    stops = []

    class Grabbed(FakeGpCamera):
        attempts = 0

        def init(self):
            Grabbed.attempts += 1
            if Grabbed.attempts < 4:
                raise IOError("[-53] Could not claim the USB device")
            super().init()

    cam = Grabbed()
    s = GPhoto2Session(camera=lambda: cam, stop_macos=lambda: stops.append(1), connect_seconds=3)
    assert s.get_config("shutterspeed") == "1/60"
    assert Grabbed.attempts == 4 and len(stops) >= 4


def test_a_camera_that_never_frees_up_fails_after_the_connect_time():
    class NeverFree(FakeGpCamera):
        def init(self):
            raise IOError("[-53] Could not claim the USB device")

    s = GPhoto2Session(camera=NeverFree, stop_macos=lambda: None, connect_seconds=0.3)
    with pytest.raises(DriverError, match="claim"):
        s.get_config("shutterspeed")


def test_switches_and_ranges_take_numbers():
    """gphoto2 toggles (autofocus) and ranges (manualfocus) want numbers, not text."""

    class Toggle(Widget):
        def set_value(self, v):
            if isinstance(v, str):
                raise TypeError("in method 'CameraWidget_set_value', argument 2 of type 'int/float/str'")
            self.value = v

    cam = FakeGpCamera()
    cam.settings["autofocus"] = Toggle(0)
    session(cam).set_config("autofocus", "1")
    assert cam.settings["autofocus"].value == 1


def test_a_camera_call_that_never_returns_times_out_instead_of_freezing_the_engine():
    import threading
    import time

    release = threading.Event()

    class Hangs(FakeGpCamera):
        def capture(self, kind):
            if not release.is_set():
                release.wait(5)  # stuck inside libgphoto2
            return super().capture(kind)

    cam = Hangs()
    s = GPhoto2Session(camera=lambda: cam, stop_macos=lambda: None, call_seconds=0.3)
    t = time.monotonic()
    with pytest.raises(DriverError, match="didn't answer"):
        s.capture()
    assert time.monotonic() - t < 2
    release.set()
    assert s.capture().shape == (12, 16, 3)  # the next call reconnects and works
