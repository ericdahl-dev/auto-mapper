"""#74: the messages the engine actually sends match a committed example of each type, which the
browser's tests parse too (frontend/src/shared/fixtures/engine-messages.json). A field renamed or
retyped on one side fails a test. To accept an intended change: UPDATE_MESSAGE_FIXTURES=1 pytest."""

import json
import os
from pathlib import Path

from engine.camera_device import FakeCameraFactory
from engine.camera_lock import FakeUvc
from engine.hardware import FakeHardware
from tests.helpers import AC410, LAPTOP, editor, engine, output, play_output
from tests.synthetic import Scene

FIXTURE = Path(__file__).parent.parent / "frontend" / "src" / "shared" / "fixtures" / "engine-messages.json"
W, H = 256, 144
DEFAULTS = {
    "auto-exposure-mode": "8", "exposure-time-abs": "160", "gain": "0",
    "auto-white-balance-temp": "true", "white-balance-temp": "6500",
    "auto-focus": "true", "focus-abs": "395",
}
# Values that change run to run; the shape is what's compared.
VOLATILE = {"image": "/api/scan/latest.png?t=0", "seconds": 0.0, "scan_rev": "0", "seq": 1}


def shape(value):
    """Field names and value types, recursively (lists by their first item)."""
    if isinstance(value, dict):
        return {k: shape(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [shape(value[0])] if value else []
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    return type(value).__name__


def real_messages() -> dict[str, dict]:
    """One example of every message type, from a real engine run: hello, a scan, edits, errors."""
    scene = Scene(proj_w=W, proj_h=H)
    uvc = FakeUvc(DEFAULTS)

    def frame():
        scene.exposure_gain = int(uvc.values["exposure-time-abs"]) / 200
        return scene.frame()

    hw = FakeHardware(displays=[LAPTOP, {"name": "AML TV", "width": W, "height": H, "main": False}], cameras=[AC410])
    seen: dict[str, dict] = {}

    def keep(msg):
        seen.setdefault(msg["type"], {**msg, **{k: v for k, v in VOLATILE.items() if k in msg}})
        return msg

    with engine(hw, camera_factory=FakeCameraFactory(frame=frame), uvc_factory=lambda a: uvc) as client, \
            editor(client) as ed, output(client, W, H) as out:
        keep(ed.receive_json())  # status
        client.post("/api/test-frame", json={"kind": "grid"})
        keep(out.receive_json())  # show_test_frame
        client.post("/api/scan")
        out_msgs = []
        original = out.receive_json

        def recording():
            m = original()
            out_msgs.append(m)
            return m

        out.receive_json = recording
        play_output(out, scene)
        for m in out_msgs:
            keep(m)  # show_pattern, show_test_frame
        while "scan_result" not in seen:
            keep(ed.receive_json())  # scan_started, scan_progress, status, scan_result
        while "show" not in seen:
            keep(ed.receive_json())
        out.send_json({"type": "effect_error", "surface": 1, "effect": "fill", "log": "ERROR: 0:1: oops"})
        while "effect_error" not in seen:
            keep(ed.receive_json())
        client.post("/api/show/redetect")
        while "scan_reload" not in seen:
            keep(ed.receive_json())
    return seen


def test_engine_messages_match_the_shared_examples():
    messages = real_messages()
    for kind in ["status", "show", "show_pattern", "show_test_frame", "scan_started", "scan_progress",
                 "scan_result", "effect_error", "scan_reload"]:
        assert kind in messages, f"no {kind} message was sent"
    if os.environ.get("UPDATE_MESSAGE_FIXTURES"):
        FIXTURE.write_text(json.dumps(messages, indent=2, sort_keys=True) + "\n")
    committed = json.loads(FIXTURE.read_text())
    assert sorted(committed) == sorted(messages), "message types changed: rerun with UPDATE_MESSAGE_FIXTURES=1"
    for kind, msg in messages.items():
        assert shape(msg) == shape(committed[kind]), f"{kind} changed shape: rerun with UPDATE_MESSAGE_FIXTURES=1"


def test_messages_from_the_output_window_are_checked_not_forwarded_blindly(tmp_path):
    hw = FakeHardware(displays=[LAPTOP, {"name": "AML TV", "width": W, "height": H, "main": False}], cameras=[AC410])
    with engine(hw, data_dir=tmp_path) as client, editor(client) as ed, output(client, W, H) as out:
        ed.receive_json()  # status
        ed.receive_json()  # status: output connected
        out.send_json({"type": "effect_error", "surface": "one", "log": 7})  # malformed
        out.send_json({"type": "output_stats", "fps": "fast"})  # malformed
        out.send_json({"type": "effect_error", "surface": 1, "effect": "fill", "log": "ERROR"})  # fine
        assert ed.receive_json() == {"type": "effect_error", "surface": 1, "effect": "fill", "log": "ERROR"}
