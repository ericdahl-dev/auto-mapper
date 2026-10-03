"""#136: a still camera (Sony a6600 over gphoto2) behind the same controls the webcam scan uses."""

import numpy as np
import pytest

from engine.still_camera import CaptureFailed, FakeStillDriver, StillCamera

SHUTTERS = ["30", "1", "1/2", "1/4", "1/10", "1/30", "1/60", "1/160", "1/500", "1/4000"]
ISOS = ["Auto ISO", "100", "200", "400", "800", "1600"]


def camera(**kw):
    driver = FakeStillDriver(shutters=SHUTTERS, isos=ISOS, **kw)
    return StillCamera(driver, retries=2), driver


def test_exposure_in_100_microsecond_units_maps_to_the_nearest_shutter_speed():
    cam, driver = camera()
    cam.set("exposure-time-abs", "1000")  # 100 ms
    assert driver.config["shutterspeed"] == "1/10"
    cam.set("exposure-time-abs", "160")  # 16 ms: nearer 1/60 than 1/30 on a log scale
    assert driver.config["shutterspeed"] == "1/60"
    assert cam.get("exposure-time-abs") == str(round(10000 / 60))


def test_gain_maps_to_iso_and_manual_exposure_turns_off_auto():
    cam, driver = camera()
    cam.set("auto-exposure-mode", "1")  # the webcam's "manual": the camera's M mode
    assert driver.config["expprogram"] == "M"
    cam.set("gain", "0")
    assert driver.config["iso"] == "100"
    cam.set("gain", "15")  # 15 is about 3x, as on the AC410: ISO 300 -> nearest 400
    assert driver.config["iso"] == "400"


def test_focus_once_then_hold_it():
    cam, driver = camera()
    cam.focus_and_lock()
    assert driver.calls[:3] == [("set", "focusmode", "Automatic"), ("set", "autofocus", "1"), ("get", "focusindication")]
    assert driver.config["focusmode"] == "Manual"
    cam.set("auto-focus", "false")  # the scan's lock leaves the held focus alone
    assert driver.config["focusmode"] == "Manual"


def test_focus_that_never_locks_is_an_error():
    cam, driver = camera(never_focuses=True)
    with pytest.raises(CaptureFailed, match="focus"):
        cam.focus_and_lock(timeout=0.3)


def test_capture_returns_the_photo_and_retries_a_failed_one():
    cam, driver = camera(fail_next=1)
    frame = cam.read()
    assert isinstance(frame, np.ndarray) and frame.shape == (24, 32, 3)
    assert driver.captures == 2  # one failure, then success


def test_repeated_capture_failure_fails_with_a_clear_message():
    cam, driver = camera(fail_next=5)
    with pytest.raises(CaptureFailed, match="photo"):
        cam.read()


def test_settings_for_scanning_are_set_when_opened():
    cam, driver = camera()
    cam.prepare()
    assert driver.config["imagequality"] == "Fine"
    assert driver.config["imagesize"] == "Medium"
    assert driver.config["capturetarget"] == "sdram"


# Listing still cameras, on output recorded from the a6600 (gphoto2 2.5.32).

AUTODETECT = """Model                          Port
----------------------------------------------------------
Sony Alpha-A6600 (PC Control)  usb:002,001
"""


def test_auto_detect_lists_still_cameras_with_stable_ids():
    from engine.still_camera import parse_auto_detect

    assert parse_auto_detect(AUTODETECT) == [
        {"name": "Sony Alpha-A6600", "unique_id": "gphoto2:Sony Alpha-A6600 (PC Control)", "device_type": "still"}
    ]
    assert parse_auto_detect("Model    Port\n------\n") == []


def test_a_still_camera_is_the_default_only_when_there_is_no_usb_webcam():
    from engine.cameras import default_camera

    webcam = {"name": "Webcam AC410", "unique_id": "0x110000f1311306", "device_type": "external"}
    virtual = {"name": "OBS Virtual Camera", "unique_id": "7626645E-4425", "device_type": "external"}
    still = {"name": "Sony Alpha-A6600", "unique_id": "gphoto2:Sony Alpha-A6600 (PC Control)", "device_type": "still"}
    assert default_camera([virtual, still, webcam]) == webcam["unique_id"]
    assert default_camera([virtual, still]) == still["unique_id"]
    assert default_camera([virtual]) is None


def test_a_camera_that_stops_answering_is_a_clear_error_not_a_crash():
    from engine.still_camera import DriverError

    class Stuck(FakeStillDriver):
        def set_config(self, name, value):
            raise DriverError("gphoto2 --set-config-value timed out")

    cam = StillCamera(Stuck(shutters=SHUTTERS, isos=ISOS))
    with pytest.raises(CaptureFailed, match="camera"):
        cam.prepare()
    with pytest.raises(CaptureFailed):
        cam.set("exposure-time-abs", "100")


APERTURES = ["f/3.5", "f/4", "f/5.6", "f/8", "f/11", "f/16"]


def test_the_aperture_is_set_to_the_nearest_stop_the_lens_has_in_manual_mode():
    cam, driver = camera()
    driver._choices["f-number"] = APERTURES
    cam.prepare(aperture="8")
    assert driver.config["f-number"] == "f/8"
    assert driver.config["expprogram"] == "M"  # aperture is only the app's to set in M
    cam.prepare(aperture="7")  # between stops: nearest on a log scale
    assert driver.config["f-number"] == "f/8"


def test_no_aperture_leaves_the_lens_as_it_is():
    cam, driver = camera()
    driver._choices["f-number"] = APERTURES
    driver.config["f-number"] = "f/3.5"
    cam.prepare()
    assert driver.config["f-number"] == "f/3.5"


def test_a_still_camera_may_expose_for_seconds():
    """At f/8 a dim room needs long exposures: still cameras on a tripod can take them."""
    cam, driver = camera()
    assert max(cam.longer_exposures) >= 20000  # 2 s, in 100 us units
