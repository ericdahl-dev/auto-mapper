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
        # Brightness follows shutter x ISO, like a real camera (the scan sets ISO; the shutter is the dial's).
        iso = float(driver.config["iso"]) if driver.config["iso"].isdigit() else 100
        scene.exposure_gain = (_seconds(driver.config["shutterspeed"]) or 0.01) * iso / 100 * 10000 / 200
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
    first_photo = driver.calls.index(("capture",))
    before = driver.calls[:first_photo]
    assert ("set", "focusmode", "Manual") in before  # focus held for the photos
    assert ("set", "imagesize", "Medium") in before and ("set", "capturetarget", "sdram") in before
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


def test_a_scan_sets_the_cameras_aperture_and_calibrates_for_it(rig, tmp_path):
    scene, driver, hw, shown = rig
    driver._choices["f-number"] = ["f/3.5", "f/5.6", "f/8", "f/11"]
    with engine(hw, data_dir=tmp_path, still_factory=lambda uid: StillCamera(driver)) as client, \
            editor(client) as ed, output(client, W, H) as out:
        assert client.get("/api/camera/scan-settings").json()["aperture"] == "8"  # default for scanning
        assert client.post("/api/camera/scan-settings", json={"aperture": "11"}).json()["aperture"] == "11"
        assert client.post("/api/camera/scan-settings", json={"aperture": "f8"}).status_code == 422
        client.post("/api/scan")
        play_output(out, scene)
        while (msg := ed.receive_json())["type"] not in ("scan_result", "scan_failed"):
            pass
    assert msg["type"] == "scan_result", msg
    assert ("set", "f-number", "f/11") in driver.calls[:driver.calls.index(("capture",))]



def test_an_hdr_scan_with_a_still_camera_takes_each_pattern_at_two_isos_and_never_touches_the_shutter(rig, tmp_path):
    scene, driver, hw, shown = rig

    def scan(client, ed, out):
        before = sum(c == ("capture",) for c in driver.calls)
        mark = len(driver.calls)
        client.post("/api/scan")
        play_output(out, scene)
        while (msg := ed.receive_json())["type"] not in ("scan_result", "scan_failed"):
            pass
        assert msg["type"] == "scan_result", msg
        calls = driver.calls[mark:]
        photos = sum(c == ("capture",) for c in driver.calls) - before
        assert not any(c[:2] == ("set", "shutterspeed") for c in calls)  # the dial's, never written
        # The ISOs photos were taken at (Auto ISO: the owner's, given back after).
        return photos, {c[2] for c in calls if c[:2] == ("set", "iso")} - {"Auto ISO"}, msg

    with engine(hw, data_dir=tmp_path, still_factory=lambda uid: StillCamera(driver)) as client, \
            editor(client) as ed, output(client, W, H) as out:
        scan(client, ed, out)  # HDR off; this one also calibrates
        plain, plain_shutters, _ = scan(client, ed, out)  # calibrated: just the patterns
        client.post("/api/camera/scan-settings", json={"hdr": 2})
        hdr, hdr_shutters, msg = scan(client, ed, out)
    assert hdr == 2 * plain  # every pattern twice
    assert len(hdr_shutters) == 2 and len(plain_shutters) <= 1  # two ISOs, alternating
    assert msg["coverage"] > 0.9


def test_after_a_scan_the_camera_is_back_as_its_owner_had_it(rig, tmp_path):
    scene, driver, hw, shown = rig
    driver.config.update({"capturemode": "Continuous Med Speed", "whitebalance": "Automatic", "focusmode": "AF-C"})
    with engine(hw, data_dir=tmp_path, still_factory=lambda uid: StillCamera(driver)) as client, \
            editor(client) as ed, output(client, W, H) as out:
        client.post("/api/scan")
        play_output(out, scene)
        while (msg := ed.receive_json())["type"] not in ("scan_result", "scan_failed"):
            pass
    assert msg["type"] == "scan_result", msg
    shots = [i for i, c in enumerate(driver.calls) if c == ("capture",)]
    single = driver.calls.index(("set", "capturemode", "Single Shot"))
    assert single < shots[0]  # single shots before any photo
    assert (driver.config["capturemode"], driver.config["whitebalance"], driver.config["focusmode"]) == (
        "Continuous Med Speed", "Automatic", "AF-C")


def test_status_shows_the_camera_battery_and_a_nearly_flat_one_stops_a_scan(rig, tmp_path):
    scene, driver, hw, shown = rig
    driver.config["batterylevel"] = "64%"
    with engine(hw, data_dir=tmp_path, still_factory=lambda uid: StillCamera(driver)) as client, \
            editor(client) as ed, output(client, W, H) as out:
        assert client.get("/api/status").json()["camera"]["battery"] is None  # not read until the camera is used
        client.get("/api/camera/preview.jpg")
        assert client.get("/api/status").json()["camera"]["battery"] == 64
        driver.config["batterylevel"] = "8%"
        photos = driver.calls.count(("capture",))
        client.post("/api/scan")
        while (msg := ed.receive_json())["type"] not in ("scan_result", "scan_failed"):
            pass
        assert msg["type"] == "scan_failed" and "battery" in msg["error"].lower() and "8%" in msg["error"]
        assert client.get("/api/status").json()["camera"]["battery"] == 8
        assert driver.calls.count(("capture",)) == photos  # stopped before any photo



@pytest.mark.parametrize("level, state, can_scan", [("64%", "ok", True), ("18%", "low", True), ("8%", "flat", False)])
def test_status_says_how_the_camera_battery_stands_and_a_flat_one_disables_scan(rig, tmp_path, level, state, can_scan):
    """The engine decides readiness, battery included: Scan is disabled with a reason instead of
    failing as it starts, and the editor keeps no copy of the thresholds (#142)."""
    scene, driver, hw, shown = rig
    driver.config["batterylevel"] = level
    with engine(hw, data_dir=tmp_path, still_factory=lambda uid: StillCamera(driver)) as client, \
            output(client, W, H):
        client.get("/api/camera/preview.jpg")  # reads the battery
        s = client.get("/api/status").json()
    assert s["camera"]["battery_state"] == state
    assert s["can_scan"] is can_scan
    assert (s["scan_blocker"] is None) is can_scan
    if not can_scan:
        assert "battery" in s["scan_blocker"].lower() and "8%" in s["scan_blocker"]
