import json

import pytest

from engine.hardware import FakeHardware
from tests.helpers import AC410, editor, engine, LAPTOP, output, PROJECTOR, write_scan

WALL = {"polygon": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "area": 2073600.0}
BOX = {"polygon": [[1230, 880], [1540, 880], [1690, 1080], [1220, 1080]], "area": 70000.0}


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410])


@pytest.fixture
def scanned(tmp_path):
    """A data dir holding a finished scan with two detected surfaces."""
    write_scan(tmp_path, [WALL, BOX], 1920, 1080, coverage=0.99)
    return tmp_path


def test_scene_starts_from_the_latest_scan_with_no_effects(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        scene = client.get("/api/show").json()

    assert scene["width"] == 1920 and scene["height"] == 1080
    assert [s["id"] for s in scene["surfaces"]] == [1, 2]
    assert scene["surfaces"][1]["polygon"] == BOX["polygon"]
    assert all(s["effect"] == "none" and s["params"] == {} for s in scene["surfaces"])
    assert scene["selected"] is None


def test_no_scene_before_any_scan(rig, tmp_path):
    with engine(rig, data_dir=tmp_path) as client:
        assert client.get("/api/show").status_code == 404


def test_changing_an_effect_is_pushed_to_output_and_editors(rig, scanned):
    with engine(rig, data_dir=scanned) as client, editor(client) as ed, output(client) as out:
        assert ed.receive_json()["type"] == "status"
        assert ed.receive_json()["type"] == "show"  # sent on hello
        assert out.receive_json()["type"] == "show"  # sent on hello
        ed.receive_json()  # status: output connected

        resp = client.patch("/api/show/surfaces/2", json={"effect": "fill", "params": {"colorA": "#ff0000"}})

        assert resp.status_code == 200
        for ws in (out, ed):
            msg = ws.receive_json()
            assert msg["type"] == "show"
            assert msg["surfaces"][1]["effect"] == "fill"
            assert msg["surfaces"][1]["params"] == {"colorA": "#ff0000"}


def test_params_update_merges_and_effect_change_resets_params(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.patch("/api/show/surfaces/1", json={"effect": "fill", "params": {"colorA": "#ff0000"}})
        client.patch("/api/show/surfaces/1", json={"params": {"colorB": "#0000ff"}})
        merged = client.get("/api/show").json()["surfaces"][0]["params"]
        client.patch("/api/show/surfaces/1", json={"effect": "none"})
        reset = client.get("/api/show").json()["surfaces"][0]

    assert merged == {"colorA": "#ff0000", "colorB": "#0000ff"}
    assert reset["effect"] == "none" and reset["params"] == {}


def test_selecting_a_surface_is_pushed_to_output(rig, scanned):
    with engine(rig, data_dir=scanned) as client, output(client) as out:
        out.receive_json()
        client.post("/api/show/select", json={"id": 2})
        assert out.receive_json()["selected"] == 2
        client.post("/api/show/select", json={"id": None})
        assert out.receive_json()["selected"] is None


def test_unknown_surface_is_404(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert client.patch("/api/show/surfaces/9", json={"effect": "fill"}).status_code == 404
        assert client.post("/api/show/select", json={"id": 9}).status_code == 404


def test_effect_errors_from_the_output_reach_editors(rig, scanned):
    with engine(rig, data_dir=scanned) as client, editor(client) as ed, output(client) as out:
        ed.receive_json(), ed.receive_json(), ed.receive_json()  # status, scene, status
        out.send_json({"type": "effect_error", "surface": 2, "effect": "fill", "log": "ERROR: 0:3: syntax error"})

        msg = ed.receive_json()

    assert msg == {"type": "effect_error", "surface": 2, "effect": "fill", "log": "ERROR: 0:3: syntax error"}


def test_effects_survive_an_engine_restart(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.patch("/api/show/surfaces/2", json={"effect": "fill", "params": {"colorA": "#00ff00"}})

    with engine(rig, data_dir=scanned) as client:
        box = client.get("/api/show").json()["surfaces"][1]

    assert box["effect"] == "fill" and box["params"] == {"colorA": "#00ff00"}


def test_engine_starts_even_if_scene_file_was_cut_off_by_a_crash(rig, scanned):
    (scanned / "scans" / "latest" / "scene.json").write_text('{"width": 1920, "surf')  # truncated mid-write
    with engine(rig, data_dir=scanned) as client:
        scene = client.get("/api/show").json()

    assert [s["id"] for s in scene["surfaces"]] == [1, 2]  # rebuilt from the scan's meta.json


def test_saved_files_are_written_whole(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.patch("/api/show/surfaces/2", json={"effect": "fill"})

    folder = scanned / "scans" / "latest"
    assert not list(folder.glob("*.tmp"))  # temp files are renamed into place
    json.loads((folder / "scene.json").read_text())


def test_scene_carries_a_scan_revision_that_only_changes_with_new_scan_data(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        first = client.get("/api/show").json()["scan_rev"]
        client.patch("/api/show/surfaces/2", json={"polygon": [[10, 10], [50, 10], [50, 50]]})
        after_edit = client.get("/api/show").json()["scan_rev"]
        client.post("/api/projects", json={"name": "P"})
        client.post("/api/projects/p/open")
        after_open = client.get("/api/show").json()["scan_rev"]

    assert first == after_edit  # editing geometry must not make the output re-fetch the scan image
    assert after_open != first
