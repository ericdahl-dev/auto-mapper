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
    return GPhoto2Session(camera=lambda: cam, stop_macos=lambda: calls.append("stop macos"), settle_seconds=0,
                          retry_seconds=0.1)


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
    s = GPhoto2Session(camera=lambda: cam, stop_macos=lambda: stops.append(1), connect_seconds=3, settle_seconds=0,
                       retry_seconds=0.1)
    assert s.get_config("shutterspeed") == "1/60"
    assert Grabbed.attempts == 4 and len(stops) >= 4


def test_a_camera_that_never_frees_up_fails_after_the_connect_time():
    class NeverFree(FakeGpCamera):
        def init(self):
            raise IOError("[-53] Could not claim the USB device")

    s = GPhoto2Session(camera=NeverFree, stop_macos=lambda: None, connect_seconds=0.3, settle_seconds=0, retry_seconds=0.1)
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
    s = GPhoto2Session(camera=lambda: cam, stop_macos=lambda: None, call_seconds=0.3, settle_seconds=0)
    t = time.monotonic()
    with pytest.raises(DriverError, match="didn't answer"):
        s.capture()
    assert time.monotonic() - t < 2
    release.set()
    assert s.capture().shape == (12, 16, 3)  # the next call reconnects and works


def test_connect_attempts_are_few_and_spaced_so_the_camera_can_settle():
    """A failed connect leaves a Sony 'Connecting'; hammering it every 0.1 s kept it there. Wait for
    macOS's service to be gone before the first try, then a few tries a couple of seconds apart."""
    import time

    tries = []

    class Busy(FakeGpCamera):
        def init(self):
            tries.append(time.monotonic())
            raise IOError("[-10] Timeout reading from or writing to the port")

    start = time.monotonic()
    s = GPhoto2Session(camera=Busy, stop_macos=lambda: None, connect_seconds=2.5, settle_seconds=0.3,
                       retry_seconds=1.0)
    with pytest.raises(DriverError):
        s.get_config("shutterspeed")
    assert tries[0] - start >= 0.3  # waited for macOS to let go first
    assert len(tries) <= 3
    assert all(b - a >= 0.9 for a, b in zip(tries, tries[1:]))


def test_waits_after_connecting_until_the_camera_reports_its_real_settings():
    """For ~5 s after connecting, the a6600 reports placeholders (RAW, f/0, shutter 65535/65535,
    ISO 0). Read then, a scan's "owner's settings" were placeholders, and giving them back put the
    camera in RAW. Nothing is read or set until it reports real values."""

    class Waking(FakeGpCamera):
        def __init__(self):
            super().__init__()
            self.reads = 0

        def get_config(self):
            self.reads += 1
            if self.reads <= 3:  # still waking up
                return Tree({"shutterspeed": Widget("65535/65535"), "imagequality": Widget("RAW"),
                             "f-number": Widget("f/0"), "iso": Widget("0")})
            return super().get_config()

    cam = Waking()
    s = GPhoto2Session(camera=lambda: cam, stop_macos=lambda: None, settle_seconds=0, ready_poll_seconds=0.01)
    assert s.get_config("shutterspeed") == "1/60"
    assert s.get_config("imagequality") == "RAW"  # the fake's real value, read after waking


def test_a_camera_that_never_wakes_is_a_clear_error():
    class Asleep(FakeGpCamera):
        def get_config(self):
            return Tree({"shutterspeed": Widget("65535/65535"), "f-number": Widget("f/0")})

    cam = Asleep()
    s = GPhoto2Session(camera=lambda: cam, stop_macos=lambda: None, settle_seconds=0,
                       ready_seconds=0.2, ready_poll_seconds=0.01)
    with pytest.raises(DriverError, match="settings"):
        s.get_config("shutterspeed")


def sony_wrapped(main: bytes, thumb: bytes, preview: bytes) -> bytes:
    """What the a6600 sent over USB on 2026-10-03: a Sony header, EXIF tags with a small thumbnail,
    the main photo's JPEG *without its start marker*, then a 1920x1080 preview JPEG."""
    header = b"\x01\x00\x00\x00" + b"\x00" * 28 + b"\x00\x00\x0f\x01\x02\x00\x05\x00"
    return header + b"\x00" * 64 + thumb + b"\x00" * 32 + b"II*\x00" + b"\x00" * 64 + main[2:] + b"\x00" * 16 + preview


def test_a_photo_sent_wrapped_by_the_camera_is_unwrapped_to_the_full_size_image():
    import cv2

    rng = np.random.default_rng(0)
    big = rng.integers(0, 255, (240, 424, 3), np.uint8)
    jpg = lambda img: cv2.imencode(".jpg", img)[1].tobytes()  # noqa: E731
    data = sony_wrapped(jpg(big), jpg(cv2.resize(big, (16, 12))), jpg(cv2.resize(big, (192, 108))))

    class Wrapping(FakeGpCamera):
        def file_get(self, folder, name, kind):
            class F:
                def get_data_and_size(self_):
                    return data
            return F()

    s = GPhoto2Session(camera=lambda: Wrapping(), stop_macos=lambda: None, settle_seconds=0)
    assert s.capture().shape == (240, 424, 3)  # the main photo, not the thumbnail or the preview


def test_one_press_in_bracketing_collects_every_photo_it_takes():
    """On the rig, one capture in 'Bracketing C ... 3 Pictures' gave three photos: the first from the
    capture, the other two announced as new files within half a second."""
    import cv2

    shades = [40, 120, 220]

    class Bracketing(FakeGpCamera):
        def __init__(self):
            super().__init__()
            self.pending = []

        def capture(self, kind):
            self.pending = [("/", "b.JPG"), ("/", "c.JPG")]
            p = Path(); p.name = "a.JPG"
            return p

        def wait_for_event(self, timeout_ms):
            import gphoto2 as gp

            if self.pending:
                folder, name = self.pending.pop(0)
                p = Path(); p.folder, p.name = folder, name
                return gp.GP_EVENT_FILE_ADDED, p
            return gp.GP_EVENT_TIMEOUT, None

        def file_get(self, folder, name, kind):
            shade = shades["abc".index(name[0])]

            class F:
                def get_data_and_size(self_):
                    return cv2.imencode(".jpg", np.full((12, 16, 3), shade, np.uint8))[1].tobytes()
            return F()

    s = GPhoto2Session(camera=lambda: Bracketing(), stop_macos=lambda: None, settle_seconds=0)
    photos = s.capture_burst(3)
    assert [int(np.median(p)) for p in photos] == [40, 120, 220]
