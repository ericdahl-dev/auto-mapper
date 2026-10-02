from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from engine.app import create_app
from engine.hardware import FakeHardware

PROJECTOR = {"name": "AML TV", "width": 1920, "height": 1080, "main": False}
LAPTOP = {"name": "Color LCD", "width": 3456, "height": 2234, "main": True}


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=["Webcam AC410"])


@contextmanager
def engine(hardware):
    with TestClient(create_app(hardware=hardware)) as client:
        yield client


@contextmanager
def editor(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello", "role": "editor"})
        yield ws


@contextmanager
def output(client, width=1920, height=1080):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello", "role": "output", "width": width, "height": height})
        yield ws


def test_status_reports_hardware_and_no_output(rig):
    with engine(rig) as client:
        status = client.get("/api/status").json()

    assert status["hardware"]["projector"] == {"name": "AML TV", "width": 1920, "height": 1080}
    assert status["hardware"]["cameras"] == ["Webcam AC410"]
    assert status["hardware"]["issues"] == []
    assert status["output_connected"] is False
    assert status["can_scan"] is False


def test_editor_receives_status_on_hello(rig):
    with engine(rig) as client, editor(client) as ed:
        msg = ed.receive_json()

    assert msg["type"] == "status"
    assert msg["output_connected"] is False


def test_output_connect_and_disconnect_are_pushed_to_editor(rig):
    with engine(rig) as client, editor(client) as ed:
        ed.receive_json()  # initial status

        with output(client):
            connected = ed.receive_json()
            assert connected["type"] == "status"
            assert connected["output_connected"] is True
            assert connected["output_resolution"] == {"width": 1920, "height": 1080}
            assert connected["can_scan"] is True
            assert client.get("/api/status").json()["output_connected"] is True

        disconnected = ed.receive_json()
        assert disconnected["output_connected"] is False
        assert disconnected["can_scan"] is False


def test_missing_projector_is_an_issue_and_blocks_scan():
    hw = FakeHardware(displays=[LAPTOP], cameras=["Webcam AC410"])
    with engine(hw) as client, output(client):
        status = client.get("/api/status").json()

    assert status["hardware"]["projector"] is None
    assert "no_projector" in status["hardware"]["issues"]
    assert status["can_scan"] is False


def test_missing_camera_is_an_issue_and_blocks_scan():
    hw = FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[])
    with engine(hw) as client, output(client):
        status = client.get("/api/status").json()

    assert "no_camera" in status["hardware"]["issues"]
    assert status["can_scan"] is False


def test_test_frame_is_sent_to_output(rig):
    with engine(rig) as client, output(client) as out:
        resp = client.post("/api/test-frame", json={"kind": "grid"})
        msg = out.receive_json()

    assert resp.status_code == 200
    assert msg == {"type": "show_test_frame", "kind": "grid"}


def test_test_frame_without_output_is_rejected(rig):
    with engine(rig) as client:
        resp = client.post("/api/test-frame", json={"kind": "white"})

    assert resp.status_code == 409


def test_unknown_test_frame_kind_is_rejected(rig):
    with engine(rig) as client, output(client):
        resp = client.post("/api/test-frame", json={"kind": "plaid"})

    assert resp.status_code == 422


def test_hardware_refresh_picks_up_newly_connected_projector():
    hw = FakeHardware(displays=[LAPTOP], cameras=["Webcam AC410"])
    with engine(hw) as client, editor(client) as ed:
        assert ed.receive_json()["hardware"]["projector"] is None

        hw.displays.append(PROJECTOR)
        client.post("/api/hardware/refresh")

        pushed = ed.receive_json()
        assert pushed["hardware"]["projector"]["name"] == "AML TV"
        assert "no_projector" not in pushed["hardware"]["issues"]


def test_websocket_without_hello_is_closed(rig):
    from starlette.websockets import WebSocketDisconnect

    with engine(rig) as client, client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "nonsense"})
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()

    assert exc.value.code == 1008


def test_output_resize_updates_resolution_for_editor(rig):
    with engine(rig) as client, editor(client) as ed:
        ed.receive_json()
        with output(client, width=1280, height=720) as out:
            assert ed.receive_json()["output_resolution"] == {"width": 1280, "height": 720}

            out.send_json({"type": "hello", "role": "output", "width": 1920, "height": 1080})

            assert ed.receive_json()["output_resolution"] == {"width": 1920, "height": 1080}


def test_scan_blocked_until_output_matches_projector_resolution(rig):
    with engine(rig) as client, editor(client) as ed:
        ed.receive_json()
        with output(client, width=3456, height=1882) as out:
            assert ed.receive_json()["can_scan"] is False

            out.send_json({"type": "hello", "role": "output", "width": 1920, "height": 1080})

            assert ed.receive_json()["can_scan"] is True
