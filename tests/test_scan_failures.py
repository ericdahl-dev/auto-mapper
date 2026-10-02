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


def make_rig(**scene_kwargs):
    scene = Scene(proj_w=W, proj_h=H, **scene_kwargs)
    uvc = FakeUvc(DEFAULTS)

    def frame():
        scene.exposure_gain = int(uvc.values["exposure-time-abs"]) / 200
        return scene.frame()

    hw = FakeHardware(displays=[LAPTOP, SMALL_PROJECTOR], cameras=[AC410])
    return scene, uvc, hw, FakeCameraFactory(frame=frame)


def until_done(ed):
    msg = ed.receive_json()
    while msg["type"] not in ("scan_result", "scan_failed", "scan_cancelled"):
        msg = ed.receive_json()
    return msg


def test_cancel_stops_the_scan_and_restores_the_camera(tmp_path):
    scene, uvc, hw, cams = make_rig()
    with engine(hw, data_dir=tmp_path, camera_factory=cams, uvc_factory=lambda a: uvc) as client, \
            editor(client) as ed, output(client, W, H) as out:
        client.post("/api/scan")
        shown = 0
        while True:
            msg = out.receive_json()
            if msg["type"] == "show_test_frame" and msg["kind"] == "black":
                break
            if msg["type"] == "show_pattern":
                shown += 1
                if shown == 5:
                    assert client.post("/api/scan/cancel").status_code == 200
                scene.pattern = msg["pattern"]
                out.send_json({"type": "pattern_shown", "seq": msg["seq"]})
        done = until_done(ed)

    assert done["type"] == "scan_cancelled"
    assert shown < 10  # stopped soon after cancelling, not at the end of 34 patterns
    assert uvc.values == DEFAULTS


def test_cancel_with_no_scan_running_is_409(tmp_path):
    _, uvc, hw, cams = make_rig()
    with engine(hw, data_dir=tmp_path, camera_factory=cams, uvc_factory=lambda a: uvc) as client:
        assert client.post("/api/scan/cancel").status_code == 409


def test_output_that_stops_responding_gives_an_actionable_error(tmp_path):
    scene, uvc, hw, cams = make_rig()
    with engine(hw, data_dir=tmp_path, camera_factory=cams, uvc_factory=lambda a: uvc, ack_timeout=0.2) as client, \
            editor(client) as ed, output(client, W, H) as out:
        client.post("/api/scan")
        out.receive_json()  # first pattern: never acknowledged (e.g. window minimised)
        done = until_done(ed)

    assert done["type"] == "scan_failed"
    assert "visible" in done["error"] and "fullscreen" in done["error"]
    assert uvc.values == DEFAULTS


def test_output_closed_mid_scan_gives_an_actionable_error(tmp_path):
    scene, uvc, hw, cams = make_rig()
    with engine(hw, data_dir=tmp_path, camera_factory=cams, uvc_factory=lambda a: uvc, ack_timeout=5) as client, \
            editor(client) as ed:
        with output(client, W, H) as out:
            client.post("/api/scan")
            out.receive_json()
        # Output window closed while the engine waits for the first acknowledgement.
        done = until_done(ed)

    assert done["type"] == "scan_failed"
    assert "closed" in done["error"]
    assert uvc.values == DEFAULTS


def scan_once(scene, uvc, hw, cams, tmp_path):
    with engine(hw, data_dir=tmp_path, camera_factory=cams, uvc_factory=lambda a: uvc) as client, \
            editor(client) as ed, output(client, W, H) as out:
        client.app.state.hub.settings.save_calibration(AC410["unique_id"], {"exposure": 200, "gain": 0, "p99": 200})
        client.post("/api/scan")
        while True:
            msg = out.receive_json()
            if msg["type"] == "show_test_frame" and msg["kind"] == "black":
                break
            if msg["type"] == "show_pattern":
                scene.pattern = msg["pattern"]
                out.send_json({"type": "pattern_shown", "seq": msg["seq"]})
        done = until_done(ed)
        mask = client.get("/api/scan/latest-mask.png")
    return done, mask


def test_bright_room_low_coverage_warns_about_room_light(tmp_path):
    scene, uvc, hw, cams = make_rig(ambient=200, power=0.04)
    done, mask = scan_once(scene, uvc, hw, cams, tmp_path)

    assert done["type"] == "scan_result"
    assert done["coverage"] < 0.4
    assert any("room" in w.lower() and "bright" in w.lower() for w in done["warnings"])
    assert uvc.values == DEFAULTS


def test_faint_projection_warns_about_projector_light(tmp_path):
    scene, uvc, hw, cams = make_rig(ambient=12, power=0.04)
    done, _ = scan_once(scene, uvc, hw, cams, tmp_path)

    assert done["coverage"] < 0.4
    assert any("faint" in w.lower() for w in done["warnings"])
    assert not any("bright" in w.lower() for w in done["warnings"])


def test_good_scan_has_no_warnings_and_serves_a_coverage_mask(tmp_path):
    import cv2

    scene, uvc, hw, cams = make_rig()
    done, mask = scan_once(scene, uvc, hw, cams, tmp_path)

    assert done["coverage"] > 0.9
    assert done["warnings"] == []
    img = cv2.imdecode(np.frombuffer(mask.content, np.uint8), cv2.IMREAD_GRAYSCALE)
    assert img.shape == (H, W)
    assert (img > 0).mean() > 0.9  # white where decoded


def test_averaging_frames_per_pattern_reads_a_noisy_scene_better(tmp_path):
    def mean_reliability(frames, d):
        # Dim, like the rig at its light limit: the stripe signal is close to the noise.
        scene, uvc, hw, cams = make_rig(power=0.15, noise=8.0)
        with engine(hw, data_dir=d, camera_factory=cams, uvc_factory=lambda a: uvc,
                    scan_frames_per_pattern=frames) as client, editor(client) as ed, output(client, W, H) as out:
            client.app.state.hub.settings.save_calibration(AC410["unique_id"], {"exposure": 200, "gain": 0, "p99": 200})
            client.post("/api/scan")
            while True:
                msg = out.receive_json()
                if msg["type"] == "show_test_frame" and msg["kind"] == "black":
                    break
                if msg["type"] == "show_pattern":
                    scene.pattern = msg["pattern"]
                    out.send_json({"type": "pattern_shown", "seq": msg["seq"]})
            done = until_done(ed)
        bits = done["bit_reliability"]
        return np.mean([v for axis in bits.values() for v in axis.values()])

    single = mean_reliability(1, tmp_path / "one")
    averaged = mean_reliability(4, tmp_path / "four")
    assert averaged > single + 0.03
