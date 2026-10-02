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
