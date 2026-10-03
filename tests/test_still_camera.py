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


# The real driver's parsing, on output recorded from the a6600 (gphoto2 2.5.32).

SHUTTER_CONFIG = """Label: Shutter Speed
Readonly: 0
Type: RADIO
Current: 1/30
Choice: 0 30
Choice: 1 25
Choice: 2 1/30
END
"""

AUTODETECT = """Model                          Port
----------------------------------------------------------
Sony Alpha-A6600 (PC Control)  usb:002,001
"""


def test_config_output_parses_to_current_value_and_choices():
    from engine.still_camera import parse_config

    assert parse_config(SHUTTER_CONFIG) == ("1/30", ["30", "25", "1/30"])


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
