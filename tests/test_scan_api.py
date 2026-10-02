import cv2
import numpy as np
import pytest

from engine.camera_device import FakeCameraFactory
from engine.camera_lock import FakeUvc
from engine.hardware import FakeHardware
from tests.helpers import AC410, LAPTOP, editor, engine, output
from tests.synthetic import Scene

DEFAULTS = {
    "auto-exposure-mode": "8", "exposure-time-abs": "160", "gain": "0",
    "auto-white-balance-temp": "true", "white-balance-temp": "6500",
    "auto-focus": "true", "focus-abs": "395",
}
W, H = 256, 144
SMALL_PROJECTOR = {"name": "AML TV", "width": W, "height": H, "main": False}


@pytest.fixture
def rig():
    scene = Scene(proj_w=W, proj_h=H)
    uvc = FakeUvc(DEFAULTS)

    def frame():
        scene.exposure_gain = int(uvc.values["exposure-time-abs"]) / 200
        return scene.frame()

    hw = FakeHardware(displays=[LAPTOP, SMALL_PROJECTOR], cameras=[AC410])
    return scene, uvc, hw, FakeCameraFactory(frame=frame)


def play_output(out, scene, ack=True):
    """Acts as the output window: shows each pattern on the synthetic scene and acks it."""
    shown = []
    while True:
        msg = out.receive_json()
        if msg["type"] == "show_test_frame" and msg["kind"] == "black":
            return shown  # engine blanks the projector when the scan ends
        if msg["type"] == "show_pattern":
            scene.pattern = msg["pattern"]
            shown.append(msg["pattern"])
            if ack:
                out.send_json({"type": "pattern_shown", "seq": msg["seq"]})


def test_scan_decodes_the_scene_and_reports_progress(rig, tmp_path):
    scene, uvc, hw, cams = rig
    with engine(hw, data_dir=tmp_path, camera_factory=cams, uvc_factory=lambda a: uvc) as client, \
            editor(client) as ed, output(client, W, H) as out:
        resp = client.post("/api/scan")
        assert resp.status_code == 202, resp.text
        shown = play_output(out, scene)

        msgs = []
        while not msgs or msgs[-1]["type"] not in ("scan_result", "scan_failed"):
            msgs.append(ed.receive_json())
        result = msgs[-1]
        assert result["type"] == "scan_result", result
        progress = [m for m in msgs if m["type"] == "scan_progress"]
        assert progress[-1]["done"] == progress[-1]["total"] == 2 + 2 * (8 + 8)

        assert result["coverage"] > 0.9
        assert len(result["surfaces"]) == 2  # wall + box, largest first
        assert result["surfaces"][0]["area"] > result["surfaces"][1]["area"]
        latest = client.get("/api/scan/latest").json()
        assert latest["surfaces"] == result["surfaces"]
        assert latest["width"] == W and latest["height"] == H
        projected = client.get("/api/scene").json()
        assert [s["effect"] for s in projected["surfaces"]] == ["none", "none"]
        png = client.get(result["image"])
        img = cv2.imdecode(np.frombuffer(png.content, np.uint8), cv2.IMREAD_COLOR)
        assert img.shape == (H, W, 3)

    assert {"kind": "white"} in shown
    saved = np.load(tmp_path / "scans" / "latest" / "map.npz")
    ok = saved["valid"] & scene.lit
    assert ok.sum() > 0.95 * scene.lit.sum()
    assert np.abs(saved["proj_x"][ok] - scene.true_x[ok]).max() <= 1
    assert uvc.values == DEFAULTS  # camera unlocked again


def test_scan_fails_cleanly_when_the_output_stops_acking(rig, tmp_path):
    scene, uvc, hw, cams = rig
    with engine(hw, data_dir=tmp_path, camera_factory=cams, uvc_factory=lambda a: uvc,
                ack_timeout=0.2) as client, editor(client) as ed, output(client, W, H) as out:
        client.post("/api/scan")
        play_output(out, scene, ack=False)

        msg = ed.receive_json()
        while msg["type"] not in ("scan_result", "scan_failed"):
            msg = ed.receive_json()

    assert msg["type"] == "scan_failed"
    assert "output window" in msg["error"].lower()
    assert uvc.values == DEFAULTS


def test_scan_refused_when_rig_not_ready(rig, tmp_path):
    scene, uvc, hw, cams = rig
    with engine(hw, data_dir=tmp_path, camera_factory=cams, uvc_factory=lambda a: uvc) as client:
        resp = client.post("/api/scan")

    assert resp.status_code == 409
    assert uvc.writes == []


def test_preview_is_refused_while_scanning(rig, tmp_path):
    scene, uvc, hw, cams = rig
    with engine(hw, data_dir=tmp_path, camera_factory=cams, uvc_factory=lambda a: uvc) as client, \
            editor(client) as ed, output(client, W, H) as out:
        client.post("/api/scan")
        msg = out.receive_json()  # first pattern is on screen, engine is waiting for the ack
        assert client.get("/api/camera/preview.jpg").status_code == 409

        out.send_json({"type": "pattern_shown", "seq": msg["seq"]})
        scene.pattern = msg["pattern"]
        play_output(out, scene)


def test_latest_scan_is_404_before_any_scan(rig, tmp_path):
    scene, uvc, hw, cams = rig
    with engine(hw, data_dir=tmp_path, camera_factory=cams) as client:
        assert client.get("/api/scan/latest").status_code == 404


def test_a_lamp_in_view_does_not_fail_the_scan(tmp_path):
    """Bright spots saturated in every frame must not hide that the projector works."""
    scene = Scene(proj_w=W, proj_h=H, lamp=True)
    uvc = FakeUvc(DEFAULTS)

    def frame():
        scene.exposure_gain = int(uvc.values["exposure-time-abs"]) / 200
        return scene.frame()

    hw = FakeHardware(displays=[LAPTOP, SMALL_PROJECTOR], cameras=[AC410])
    with engine(hw, data_dir=tmp_path, camera_factory=FakeCameraFactory(frame=frame),
                uvc_factory=lambda a: uvc) as client, editor(client) as ed, output(client, W, H) as out:
        # Pre-calibrated, as on the rig, so the scan goes straight to patterns.
        client.app.state.hub.settings.save_calibration(AC410["unique_id"], {"exposure": 160, "gain": 0, "p99": 200})
        client.post("/api/scan")
        play_output(out, scene)
        msg = ed.receive_json()
        while msg["type"] not in ("scan_result", "scan_failed"):
            msg = ed.receive_json()

    assert msg["type"] == "scan_result", msg


def test_second_scan_click_is_refused_while_one_is_starting(rig, tmp_path):
    scene, uvc, hw, cams = rig
    with engine(hw, data_dir=tmp_path, camera_factory=cams, uvc_factory=lambda a: uvc) as client, \
            output(client, W, H) as out:
        first = client.post("/api/scan")
        second = client.post("/api/scan")  # double click: before the first scan takes its lock
        play_output(out, scene)

    assert first.status_code == 202
    assert second.status_code == 409


def test_releasing_the_camera_during_a_scan_is_refused(rig, tmp_path):
    scene, uvc, hw, cams = rig
    with engine(hw, data_dir=tmp_path, camera_factory=cams, uvc_factory=lambda a: uvc) as client, \
            output(client, W, H) as out:
        client.post("/api/scan")
        msg = out.receive_json()  # first pattern is up, the scan holds the camera
        released = client.post("/api/camera/release")
        out.send_json({"type": "pattern_shown", "seq": msg["seq"]})
        scene.pattern = msg["pattern"]
        play_output(out, scene)

    assert released.status_code == 409
