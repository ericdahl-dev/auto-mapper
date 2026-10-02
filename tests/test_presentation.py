
import pytest

from engine.hardware import FakeHardware
from tests.helpers import AC410, editor, engine, LAPTOP, output, PROJECTOR, write_scan

WALL = {"polygon": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "area": 2073600.0}


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410])


@pytest.fixture
def scanned(tmp_path):
    write_scan(tmp_path, [WALL], 1920, 1080)
    return tmp_path


def test_scene_starts_in_edit_mode_without_blackout(rig, scanned):
    with engine(rig, data_dir=scanned) as client, output(client) as out:
        assert out.receive_json()["presentation"] == {"mode": "edit", "blackout": False}


def test_play_and_blackout_are_pushed_to_output_and_editors(rig, scanned):
    with engine(rig, data_dir=scanned) as client, editor(client) as ed, output(client) as out:
        ed.receive_json(), ed.receive_json()  # status, scene
        out.receive_json()  # scene
        ed.receive_json()  # status: output connected

        client.post("/api/presentation", json={"mode": "play"})
        for ws in (out, ed):
            assert ws.receive_json()["presentation"] == {"mode": "play", "blackout": False}

        client.post("/api/presentation", json={"blackout": True})
        assert out.receive_json()["presentation"] == {"mode": "play", "blackout": True}

        client.post("/api/presentation", json={"mode": "edit", "blackout": False})
        assert out.receive_json()["presentation"] == {"mode": "edit", "blackout": False}


def test_toggle_blackout(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert client.post("/api/presentation/blackout/toggle").json()["blackout"] is True
        assert client.post("/api/presentation/blackout/toggle").json()["blackout"] is False


def test_invalid_mode_is_rejected(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert client.post("/api/presentation", json={"mode": "dance"}).status_code == 422


def test_opening_a_project_goes_straight_to_play(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.post("/api/projects", json={"name": "Show"})
        client.post("/api/projects/show/open")
        assert client.get("/api/show").json()["presentation"]["mode"] == "play"


def test_output_frame_rate_is_reported_in_status(rig, scanned):
    with engine(rig, data_dir=scanned) as client, editor(client) as ed, output(client) as out:
        ed.receive_json(), ed.receive_json()
        out.receive_json()
        ed.receive_json()
        out.send_json({"type": "output_stats", "fps": 59.8})
        assert ed.receive_json()["output_fps"] == 59.8
