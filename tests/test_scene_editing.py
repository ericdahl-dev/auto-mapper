import json

import numpy as np
import pytest

from engine.hardware import FakeHardware
from tests.helpers import AC410, LAPTOP, PROJECTOR, engine, output

WALL = {"polygon": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "area": 2073600.0}
LEFT = {"polygon": [[1200, 800], [1400, 800], [1400, 1000], [1200, 1000]], "area": 40000.0}
RIGHT = {"polygon": [[1400, 800], [1600, 800], [1600, 1000], [1400, 1000]], "area": 40000.0}


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410])


@pytest.fixture
def scanned(tmp_path):
    d = tmp_path / "scans" / "latest"
    d.mkdir(parents=True)
    (d / "meta.json").write_text(json.dumps({"width": 1920, "height": 1080, "surfaces": [WALL, LEFT, RIGHT]}))
    return tmp_path


def surface(client, sid):
    return next(s for s in client.get("/api/scene").json()["surfaces"] if s["id"] == sid)


def test_surfaces_have_default_names_and_can_be_renamed(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert surface(client, 2)["name"] == "Surface 2"
        client.patch("/api/scene/surfaces/2", json={"name": "Box top"})
        assert surface(client, 2)["name"] == "Box top"


def test_moving_vertices_updates_polygon_and_area_live(rig, scanned):
    with engine(rig, data_dir=scanned) as client, output(client) as out:
        out.receive_json()
        moved = [[1200, 800], [1400, 800], [1400, 1100], [1200, 1000]]
        resp = client.patch("/api/scene/surfaces/2", json={"polygon": moved})

        assert resp.status_code == 200
        pushed = out.receive_json()
        box = next(s for s in pushed["surfaces"] if s["id"] == 2)
        # Vertices are clamped to the projector frame.
        assert box["polygon"] == [[1200, 800], [1400, 800], [1400, 1080], [1200, 1000]]
        assert box["area"] == pytest.approx(200 * 200 + 0.5 * 200 * 80)


def test_degenerate_polygons_are_rejected(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert client.patch("/api/scene/surfaces/2", json={"polygon": [[0, 0], [10, 10]]}).status_code == 422
        assert client.patch("/api/scene/surfaces/2", json={"polygon": [[0, 0], ["a", 1], [5, 5]]}).status_code == 422
        assert surface(client, 2)["polygon"] == LEFT["polygon"]


def test_deleting_a_surface_removes_it_and_its_selection(rig, scanned):
    with engine(rig, data_dir=scanned) as client, output(client) as out:
        out.receive_json()
        client.post("/api/scene/select", json={"id": 2})
        out.receive_json()

        assert client.delete("/api/scene/surfaces/2").status_code == 200

        pushed = out.receive_json()
        assert [s["id"] for s in pushed["surfaces"]] == [1, 3]
        assert pushed["selected"] is None
        assert client.delete("/api/scene/surfaces/2").status_code == 404


def test_merging_surfaces_covers_both_and_keeps_the_first_effect(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.patch("/api/scene/surfaces/2", json={"effect": "fill", "params": {"colorA": "#ff0000"}})
        client.patch("/api/scene/surfaces/3", json={"effect": "noise"})

        resp = client.post("/api/scene/merge", json={"ids": [2, 3]})

        assert resp.status_code == 200
        scene = client.get("/api/scene").json()
    assert [s["id"] for s in scene["surfaces"]] == [1, 2]
    merged = scene["surfaces"][1]
    assert merged["effect"] == "fill" and merged["params"] == {"colorA": "#ff0000"}
    assert merged["area"] == pytest.approx(80000, rel=0.03)
    xs, ys = np.array(merged["polygon"]).T
    assert xs.min() <= 1202 and xs.max() >= 1598 and ys.min() <= 802 and ys.max() >= 998
    assert scene["selected"] == 2


def test_merge_needs_two_known_surfaces(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert client.post("/api/scene/merge", json={"ids": [2]}).status_code == 422
        assert client.post("/api/scene/merge", json={"ids": [2, 9]}).status_code == 404


def test_one_surfaces_effect_can_be_applied_to_all(rig, scanned):
    with engine(rig, data_dir=scanned) as client, output(client) as out:
        out.receive_json()
        client.patch("/api/scene/surfaces/2", json={"effect": "edgeglow", "params": {"glowColor": "#ff00ff"}})
        out.receive_json()

        resp = client.post("/api/scene/apply", json={"from": 2})

        assert resp.status_code == 200
        pushed = out.receive_json()  # one update for the whole scene
    assert [(s["effect"], s["params"]) for s in pushed["surfaces"]] == [("edgeglow", {"glowColor": "#ff00ff"})] * 3


def test_effect_can_be_applied_to_chosen_surfaces_only(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.patch("/api/scene/surfaces/3", json={"effect": "noise", "params": {"scale": 9}})
        client.post("/api/scene/apply", json={"from": 3, "to": [2]})
        effects = {s["id"]: (s["effect"], s["params"]) for s in client.get("/api/scene").json()["surfaces"]}

    assert effects[2] == ("noise", {"scale": 9})
    assert effects[1] == ("none", {})  # not chosen, unchanged


def test_applying_copies_params_rather_than_sharing_them(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.patch("/api/scene/surfaces/2", json={"effect": "fill", "params": {"colorA": "#ff0000"}})
        client.post("/api/scene/apply", json={"from": 2})
        client.patch("/api/scene/surfaces/3", json={"params": {"colorA": "#00ff00"}})
        colors = {s["id"]: s["params"].get("colorA") for s in client.get("/api/scene").json()["surfaces"]}

    assert colors[2] == "#ff0000" and colors[3] == "#00ff00"


def test_apply_from_unknown_surface_is_404(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert client.post("/api/scene/apply", json={"from": 9}).status_code == 404
        assert client.post("/api/scene/apply", json={"from": 2, "to": [9]}).status_code == 404


BEZ = {"anchors": [[1200, 800], [1400, 800], [1400, 1000], [1200, 1000]], "controls": {"0": [[1260, 760], [1340, 760]]}}


def test_a_bezier_outline_is_stored_with_its_flattened_polygon(rig, scanned):
    flat = [[1200, 800], [1300, 770], [1400, 800], [1400, 1000], [1200, 1000]]
    with engine(rig, data_dir=scanned) as client:
        client.patch("/api/scene/surfaces/2", json={"polygon": flat, "bezier": BEZ})
        box = surface(client, 2)

    assert box["polygon"] == flat  # what everything renders and detects with
    assert box["bezier"] == BEZ  # kept only so the editor can keep editing the curves


def test_a_plain_polygon_edit_drops_a_stale_bezier(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.patch("/api/scene/surfaces/2", json={"polygon": BEZ["anchors"], "bezier": BEZ})
        client.patch("/api/scene/surfaces/2", json={"polygon": [[1200, 800], [1450, 800], [1400, 1000]]})
        assert surface(client, 2).get("bezier") is None


def test_merging_drops_the_bezier(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.patch("/api/scene/surfaces/2", json={"polygon": BEZ["anchors"], "bezier": BEZ})
        client.post("/api/scene/merge", json={"ids": [2, 3]})
        assert surface(client, 2).get("bezier") is None
