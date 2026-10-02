"""#65: undo and redo for show edits, kept by the engine so every editor and the output agree."""

import pytest

from engine.hardware import FakeHardware
from tests.helpers import AC410, LAPTOP, PROJECTOR, engine, write_scan

WALL = {"polygon": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "area": 2073600.0}
LEFT = {"polygon": [[1200, 800], [1400, 800], [1400, 1000], [1200, 1000]], "area": 40000.0}
RIGHT = {"polygon": [[1400, 800], [1600, 800], [1600, 1000], [1400, 1000]], "area": 40000.0}


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410])


@pytest.fixture
def scanned(tmp_path):
    write_scan(tmp_path, [WALL, LEFT, RIGHT], 1920, 1080)
    return tmp_path


def surfaces(client):
    return client.get("/api/show").json()["surfaces"]


def history(client):
    return client.get("/api/show").json()["history"]


def test_nothing_to_undo_at_first(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert history(client) == {"undo": None, "redo": None}
        assert client.post("/api/show/undo").status_code == 409


@pytest.mark.parametrize("label, change", [
    ("Change effect", lambda c: c.patch("/api/show/surfaces/2", json={"effect": "fill"})),
    ("Delete", lambda c: c.delete("/api/show/surfaces/2")),
    ("Merge", lambda c: c.post("/api/show/merge", json={"ids": [2, 3]})),
    ("Apply to all", lambda c: c.post("/api/show/apply", json={"from": 2})),
    ("Draw surface", lambda c: c.post("/api/show/surfaces", json={"polygon": [[0, 0], [50, 0], [0, 50]]})),
    ("Realign", lambda c: c.post("/api/show/alignment", json={"brightness": 0.5})),
])
def test_each_kind_of_change_can_be_undone_and_redone(rig, scanned, label, change):
    with engine(rig, data_dir=scanned) as client:
        if label == "Apply to all":
            client.patch("/api/show/surfaces/2", json={"effect": "media"})
        before = client.get("/api/show").json()
        assert change(client).status_code == 200
        after = client.get("/api/show").json()
        assert history(client)["undo"] == label
        undone = client.post("/api/show/undo").json()
        assert undone["surfaces"] == before["surfaces"] and undone["alignment"] == before["alignment"]
        assert history(client)["redo"] == label
        redone = client.post("/api/show/redo").json()
        assert redone["surfaces"] == after["surfaces"] and redone["alignment"] == after["alignment"]


def test_a_new_change_clears_redo(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.patch("/api/show/surfaces/2", json={"effect": "fill"})
        client.post("/api/show/undo")
        client.patch("/api/show/surfaces/3", json={"name": "Shelf"})
        assert history(client) == {"undo": "Rename", "redo": None}
        assert client.post("/api/show/redo").status_code == 409


def test_one_drag_is_one_undo_step(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        start = surfaces(client)
        for x in (1410, 1420, 1430, 1440):  # one drag: many PATCHes, one gesture id
            client.patch("/api/show/surfaces/2", json={"polygon": [[1200, 800], [x, 800], [1400, 1000], [1200, 1000]], "gesture": "g1"})
        client.patch("/api/show/surfaces/2", json={"params": {"zoom": 2}, "gesture": "g2"})
        client.post("/api/show/undo")  # the zoom
        assert client.post("/api/show/undo").json()["surfaces"] == start  # the whole drag at once
        assert history(client)["undo"] is None


def test_history_is_capped_at_100_steps(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        for i in range(105):
            client.patch("/api/show/surfaces/2", json={"name": f"Name {i}"})
        undone = 0
        while client.post("/api/show/undo").status_code == 200:
            undone += 1
        assert undone == 100


def test_selection_presentation_and_sound_are_not_undo_steps(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.post("/api/show/select", json={"id": 2})
        client.post("/api/presentation", json={"mode": "play"})
        client.post("/api/sound", json={"enabled": True})
        assert history(client)["undo"] is None


def test_opening_a_project_clears_the_history(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.post("/api/projects", json={"name": "Porch"})
        client.patch("/api/show/surfaces/2", json={"effect": "fill"})
        assert client.post("/api/projects/porch/open").status_code == 200
        assert history(client) == {"undo": None, "redo": None}
