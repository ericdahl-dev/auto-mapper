"""#52: several scenes (looks) per show. Outlines are shared; effects and settings belong to each scene."""

import json

import pytest

from engine.hardware import FakeHardware
from tests.helpers import AC410, LAPTOP, PROJECTOR, engine, write_scan

WALL = {"polygon": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "area": 2073600.0}
BOX = {"polygon": [[1200, 800], [1400, 800], [1400, 1000], [1200, 1000]], "area": 40000.0}


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410])


@pytest.fixture
def scanned(tmp_path):
    write_scan(tmp_path, [WALL, BOX], 1920, 1080)
    return tmp_path


def show(client):
    return client.get("/api/show").json()


def effects(client):
    return {s["id"]: s["effect"] for s in show(client)["surfaces"]}


def test_a_show_starts_with_one_scene(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        s = show(client)
        assert s["scenes"] == [{"id": 1, "name": "Scene 1", "duration": 10.0}]
        assert s["scene"] == 1


def test_scenes_keep_their_own_effects_on_the_same_surfaces(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.patch("/api/show/surfaces/1", json={"effect": "fill", "params": {"colorA": "#ff0000"}})
        new = client.post("/api/show/scenes", json={"name": "Night"}).json()
        assert new["scene"] == 2 and [x["name"] for x in new["scenes"]] == ["Scene 1", "Night"]
        assert effects(client) == {1: "none", 2: "none"}  # a new scene starts dark
        client.patch("/api/show/surfaces/2", json={"effect": "outline"})
        client.post("/api/show/scenes/1/open")
        assert effects(client) == {1: "fill", 2: "none"}
        assert show(client)["surfaces"][0]["params"] == {"colorA": "#ff0000"}
        client.post("/api/show/scenes/2/open")
        assert effects(client) == {1: "none", 2: "outline"}


def test_outlines_are_shared_by_every_scene(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.post("/api/show/scenes", json={})
        moved = [[1200, 800], [1450, 800], [1400, 1000], [1200, 1000]]
        client.patch("/api/show/surfaces/2", json={"polygon": moved, "edge": -2})
        client.post("/api/show/scenes/1/open")
        box = show(client)["surfaces"][1]
        assert box["polygon"] == moved and box["edge"] == -2


def test_duplicating_copies_the_current_look(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.patch("/api/show/surfaces/1", json={"effect": "fill"})
        dup = client.post("/api/show/scenes", json={"duplicate": 1}).json()
        assert dup["scenes"][-1]["name"] == "Scene 1 copy"
        assert effects(client) == {1: "fill", 2: "none"}
        client.patch("/api/show/surfaces/1", json={"effect": "outline"})  # the copy is separate
        client.post("/api/show/scenes/1/open")
        assert effects(client)[1] == "fill"


def test_scenes_can_be_renamed_timed_reordered_and_deleted(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.post("/api/show/scenes", json={"name": "B"})
        client.post("/api/show/scenes", json={"name": "C"})
        client.patch("/api/show/scenes/1", json={"name": "A", "duration": 4.5})
        assert client.patch("/api/show/scenes/1", json={"duration": 0}).status_code == 422
        client.post("/api/show/scenes/order", json={"ids": [3, 1, 2]})
        assert [(x["name"], x["duration"]) for x in show(client)["scenes"]] == [("C", 10.0), ("A", 4.5), ("B", 10.0)]
        assert client.post("/api/show/scenes/order", json={"ids": [3, 1]}).status_code == 422
        assert client.delete("/api/show/scenes/3").status_code == 200  # the open one: the next opens
        assert [x["name"] for x in show(client)["scenes"]] == ["A", "B"] and show(client)["scene"] in (1, 2)
        client.delete("/api/show/scenes/1")
        assert client.delete("/api/show/scenes/2").status_code == 409  # never zero scenes
        assert client.post("/api/show/scenes/9/open").status_code == 404


def test_scenes_are_saved_and_older_shows_open_as_one_scene(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.patch("/api/show/surfaces/1", json={"effect": "fill"})
        client.post("/api/show/scenes", json={"name": "Night"})
        client.patch("/api/show/surfaces/2", json={"effect": "outline"})
    with engine(rig, data_dir=scanned) as client:  # reopened from disk
        assert [x["name"] for x in show(client)["scenes"]] == ["Scene 1", "Night"]
        assert effects(client) == {1: "none", 2: "outline"}
        client.post("/api/show/scenes/1/open")
        assert effects(client) == {1: "fill", 2: "none"}
    # A show saved before scenes existed: no "scenes" key.
    path = scanned / "scans" / "latest" / "scene.json"
    data = json.loads(path.read_text())
    data.pop("scenes", None)
    data.pop("scene", None)
    data["surfaces"][0]["effect"] = "fill"
    path.write_text(json.dumps(data))
    with engine(rig, data_dir=scanned) as client:
        assert show(client)["scenes"] == [{"id": 1, "name": "Scene 1", "duration": 10.0}]
        assert effects(client)[1] == "fill"


def test_scene_changes_are_undo_steps(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.post("/api/show/scenes", json={"name": "Night"})
        assert show(client)["history"]["undo"] == "Add scene"
        client.post("/api/show/undo")
        assert [x["name"] for x in show(client)["scenes"]] == ["Scene 1"]


def test_the_show_message_lists_scenes_without_their_saved_effects(rig, scanned):
    path = scanned / "scans" / "latest" / "scene.json"
    with engine(rig, data_dir=scanned) as client:
        client.patch("/api/show/surfaces/1", json={"effect": "fill"})
        client.post("/api/show/scenes", json={"name": "Night"})
    # Saved by an earlier build, which called each scene's saved effects "looks".
    data = json.loads(path.read_text())
    data["scenes"][0]["looks"] = data["scenes"][0].pop("effects")
    path.write_text(json.dumps(data))
    with engine(rig, data_dir=scanned) as client:
        assert all(set(sc) == {"id", "name", "duration"} for sc in show(client)["scenes"])
        client.post("/api/show/scenes/1/open")
        assert effects(client)[1] == "fill"
