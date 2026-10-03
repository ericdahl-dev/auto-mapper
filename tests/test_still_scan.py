"""#136: a full scan with a still camera: focus once on white, then one photo per pattern."""

import pytest

from engine.hardware import FakeHardware
from engine.still_camera import FakeStillDriver, StillCamera, _seconds
from tests.helpers import LAPTOP, editor, engine, output, play_output
from tests.synthetic import Scene

W, H = 256, 144
PROJECTOR = {"name": "AML TV", "width": W, "height": H, "main": False}
A6600 = {"name": "Sony Alpha-A6600", "unique_id": "gphoto2:Sony Alpha-A6600 (PC Control)", "device_type": "still"}
SHUTTERS = ["1", "1/2", "1/4", "1/8", "1/15", "1/30", "1/60", "1/125", "1/250", "1/500", "1/1000", "1/2000", "1/4000"]
ISOS = ["Auto ISO", "100", "200", "400", "800"]


@pytest.fixture
def rig():
    scene = Scene(proj_w=W, proj_h=H)
    shown: list[dict] = []

    def photo():
        # Brightness follows the shutter speed the scan chose (like the webcam rig follows exposure).
        scene.exposure_gain = (_seconds(driver.config["shutterspeed"]) or 0.01) * 10000 / 200
        return scene.frame()

    driver = FakeStillDriver(shutters=SHUTTERS, isos=ISOS, frame=photo)
    hw = FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[A6600])
    return scene, driver, hw, shown


def test_a_scan_with_a_still_camera_focuses_once_then_takes_a_photo_per_pattern(rig, tmp_path):
    scene, driver, hw, shown = rig
    with engine(hw, data_dir=tmp_path, still_factory=lambda uid: StillCamera(driver)) as client, \
            editor(client) as ed, output(client, W, H) as out:
        assert client.post("/api/scan").status_code == 202
        play_output(out, scene)
        while (msg := ed.receive_json())["type"] not in ("scan_result", "scan_failed"):
            pass
    assert msg["type"] == "scan_result", msg
    assert msg["coverage"] > 0.9 and len(msg["surfaces"]) == 2
    focus = [c for c in driver.calls if c[:2] == ("set", "autofocus")]
    assert focus == [("set", "autofocus", "1"), ("set", "autofocus", "0")]  # once
    assert driver.config["focusmode"] == "Manual"
    assert driver.config["imagesize"] == "Medium" and driver.config["capturetarget"] == "sdram"
    first_capture = driver.calls.index(next(c for c in driver.calls if c == ("capture",)))
    assert driver.calls.index(("set", "autofocus", "1")) < first_capture  # focus before any photo


def test_a_camera_that_cant_focus_fails_the_scan_with_a_clear_message(rig, tmp_path):
    scene, driver, hw, shown = rig
    driver.never_focuses = True
    with engine(hw, data_dir=tmp_path, still_factory=lambda uid: StillCamera(driver)) as client, \
            editor(client) as ed, output(client, W, H) as out:
        client.post("/api/scan")
        play_output(out, scene)
        while (msg := ed.receive_json())["type"] not in ("scan_result", "scan_failed"):
            pass
    assert msg["type"] == "scan_failed"
    assert "focus" in msg["error"] and "crashed" not in msg["error"].lower()


def test_preview_and_calibration_work_with_a_still_camera(rig, tmp_path):
    scene, driver, hw, shown = rig
    with engine(hw, data_dir=tmp_path, still_factory=lambda uid: StillCamera(driver)) as client, \
            editor(client) as ed, output(client, W, H) as out:
        r = client.get("/api/camera/preview.jpg")
        assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
        assert driver.captures == 1  # a photo from the still camera
        before = driver.captures
        client.get("/api/camera/preview.jpg")  # polled twice a second: a recent photo is reused
        assert driver.captures == before
        scene.pattern = {"kind": "white"}
        cal = client.post("/api/camera/calibrate")
        assert cal.status_code == 200, cal.text
        assert client.get("/api/status").json()["camera"]["calibration"]["exposure"] > 0
