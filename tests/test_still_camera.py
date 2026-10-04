"""#136: a still camera (Sony a6600 over gphoto2) behind the same controls the webcam scan uses."""

import numpy as np
import pytest

from engine.still_camera import CaptureFailed, DriverError, FakeStillDriver, StillCamera

SHUTTERS = ["30", "1", "1/2", "1/4", "1/10", "1/30", "1/60", "1/160", "1/500", "1/4000"]
ISOS = ["Auto ISO", "100", "200", "400", "800", "1600"]


def camera(**kw):
    driver = FakeStillDriver(shutters=SHUTTERS, isos=ISOS, **kw)
    return StillCamera(driver, retries=2), driver


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
        cam.set("auto-exposure-mode", "1")


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


def test_a_scan_takes_full_control_and_gives_the_camera_back_as_it_was():
    """Every pattern photo must be made the same way: single shots (no bursts), fixed white balance,
    no DRO or flash, M mode, the scan's aperture; the owner's own settings come back afterwards."""
    cam, driver = camera()
    driver._choices["f-number"] = APERTURES
    mine = {"capturemode": "Continuous Med Speed", "whitebalance": "Automatic", "dro": "DRO Auto",
            "flashmode": "Automatic Flash", "exposurecompensation": "0.7", "expprogram": "A", "focusarea": "Flexible Spot: S",
            "imagequality": "RAW", "imagesize": "Large", "capturetarget": "card+sdram", "f-number": "f/3.5",
            "shutterspeed": "1/60", "iso": "Auto ISO", "focusmode": "AF-C"}
    driver.config.update(mine)
    with cam.scan_profile(aperture="8"):
        c = driver.config
        assert (c["capturemode"], c["whitebalance"], c["dro"], c["flashmode"]) == ("Single Shot", "Daylight", "Off", "Flash off")
        assert (c["exposurecompensation"], c["expprogram"], c["focusarea"], c["f-number"]) == ("0", "M", "Wide", "f/8")
        assert (c["imagequality"], c["imagesize"], c["capturetarget"]) == ("Fine", "Medium", "sdram")
        cam.focus_and_lock()  # the scan changes focus; exposure is the owner's, never written
    for name, value in mine.items():
        assert driver.config[name] == value, name


def test_settings_a_camera_doesnt_have_are_skipped():
    cam, driver = camera()

    class Missing(FakeStillDriver):
        def set_config(self, name, value):
            if name == "dro":
                raise DriverError("dro: not found")
            super().set_config(name, value)

        def get_config(self, name):
            if name == "dro":
                raise DriverError("dro: not found")
            return super().get_config(name)

    driver = Missing(shutters=SHUTTERS, isos=ISOS)
    cam = StillCamera(driver)
    with cam.scan_profile():
        assert driver.config["capturemode"] == "Single Shot"


def test_battery_level_reads_as_a_percentage():
    cam, driver = camera()
    driver.config["batterylevel"] = "98%"
    assert cam.battery() == 98
    driver.config["batterylevel"] = ""  # a camera that doesn't report it
    assert cam.battery() is None


def test_settings_left_by_an_interrupted_scan_go_back_to_the_owner_next_time(tmp_path):
    """A scan killed mid-way skips giving the camera back. The owner's settings are on disk while a
    scan has the camera, so the next take-over gives back those, not the scan's (#143)."""
    import json

    cam, driver = camera()
    driver.config.update({"capturemode": "Continuous Med Speed", "whitebalance": "Automatic"})
    snapshot = tmp_path / "still-camera-restore.json"

    profile = cam.scan_profile(snapshot=snapshot)
    profile.__enter__()  # killed here: never exits
    assert json.loads(snapshot.read_text())["capturemode"] == "Continuous Med Speed"
    assert driver.config["capturemode"] == "Single Shot"

    with StillCamera(driver).scan_profile(snapshot=snapshot):  # the next run, in a new engine
        pass
    assert (driver.config["capturemode"], driver.config["whitebalance"]) == ("Continuous Med Speed", "Automatic")
    assert not snapshot.exists()
