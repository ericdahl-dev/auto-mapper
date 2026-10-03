"""#55: MIDI bindings (a knob or key to a setting or action) are saved with the show, so per project."""

import pytest

from engine.hardware import FakeHardware
from tests.helpers import AC410, LAPTOP, PROJECTOR, engine, write_scan

WALL = {"polygon": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "area": 2073600.0}
KNOB = {"kind": "cc", "channel": 0, "number": 21, "target": {"surface": 1, "param": "zoom"}}
PAD = {"kind": "note", "channel": 9, "number": 36, "target": {"action": "blackout"}}


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410])


@pytest.fixture
def scanned(tmp_path):
    write_scan(tmp_path, [WALL], 1920, 1080)
    return tmp_path


def test_bindings_are_saved_with_the_show_and_its_project(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert client.get("/api/show").json()["midi"] == []
        assert client.put("/api/show/midi", json={"bindings": [KNOB, PAD]}).status_code == 200
        assert client.get("/api/show").json()["midi"] == [KNOB, PAD]
        client.post("/api/projects", json={"name": "Porch"})
        client.put("/api/show/midi", json={"bindings": []})
        client.post("/api/projects/porch/open")
        assert client.get("/api/show").json()["midi"] == [KNOB, PAD]


def test_bad_bindings_are_refused(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        bad = [{**KNOB, "number": 200}, {**KNOB, "kind": "pitch"}, {**PAD, "target": {"action": "explode"}}]
        for b in bad:
            assert client.put("/api/show/midi", json={"bindings": [b]}).status_code == 422
