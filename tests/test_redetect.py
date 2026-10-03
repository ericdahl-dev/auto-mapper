import json

import cv2
import numpy as np
import pytest

from engine.hardware import FakeHardware
from engine.scan import GrayDecoder, block_coverage, pattern_sequence, projector_space_image
from engine.surfaces import detect_surfaces
from tests.helpers import AC410, LAPTOP, engine, output
from tests.synthetic import Scene

W, H = 256, 144
PROJECTOR = {"name": "AML TV", "width": W, "height": H, "main": False}
MANUAL = [[10, 10], [60, 10], [60, 40], [10, 40]]


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410])


@pytest.fixture
def scanned(tmp_path):
    """A finished scan of the synthetic wall + box, saved the way the engine saves scans."""
    scene = Scene(proj_w=W, proj_h=H)
    dec = GrayDecoder(W, H)
    for p in pattern_sequence(W, H):
        dec.add(p, scene.frame(p))
    r = dec.result()
    image, covered = projector_space_image(r)
    d = tmp_path / "scans" / "latest"
    d.mkdir(parents=True)
    cv2.imwrite(str(d / "scan.png"), image)
    np.savez_compressed(d / "map.npz", proj_x=r.proj_x.astype(np.int16), proj_y=r.proj_y.astype(np.int16),
                        valid=r.valid, covered=covered)
    surfaces = detect_surfaces(r, (image, covered))
    (d / "meta.json").write_text(json.dumps(
        {"width": W, "height": H, "coverage": block_coverage(covered), "surfaces": surfaces}))
    return tmp_path


def surfaces(client):
    return client.get("/api/show").json()["surfaces"]


def test_drawing_a_surface_adds_a_drawn_one(rig, scanned):
    with engine(rig, data_dir=scanned) as client, output(client) as out:
        out.receive_json()
        resp = client.post("/api/show/surfaces", json={"polygon": MANUAL})

        assert resp.status_code == 200
        pushed = out.receive_json()
    new = pushed["surfaces"][-1]
    assert new["polygon"] == MANUAL and new["source"] == "drawn" and new["effect"] == "none"
    assert new["id"] == max(s["id"] for s in pushed["surfaces"])
    assert pushed["selected"] == new["id"]


def test_detected_surfaces_become_edited_when_reshaped(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert {s["source"] for s in surfaces(client)} == {"detected"}
        box = surfaces(client)[1]
        x, y = box["polygon"][0]
        client.patch(f"/api/show/surfaces/{box['id']}", json={"polygon": [[x + 4, y - 3]] + box["polygon"][1:]})
        assert surfaces(client)[1]["source"] == "edited"


def test_redetect_keeps_drawn_and_edited_surfaces_and_effects(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        wall, box = surfaces(client)
        client.patch(f"/api/show/surfaces/{wall['id']}", json={"effect": "noise"})
        # A realistic touch-up: one corner dragged a few pixels.
        x, y = box["polygon"][0]
        edited_poly = [[x + 4, y - 3]] + box["polygon"][1:]
        client.patch(f"/api/show/surfaces/{box['id']}", json={"polygon": edited_poly, "effect": "fill"})
        drawn = client.post("/api/show/surfaces", json={"polygon": MANUAL}).json()["selected"]

        resp = client.post("/api/show/redetect")
        after = surfaces(client)

    assert resp.status_code == 200
    by_id = {s["id"]: s for s in after}
    assert by_id[drawn]["polygon"] == MANUAL  # drawn surface kept as is
    assert by_id[box["id"]]["polygon"] == edited_poly and by_id[box["id"]]["effect"] == "fill"  # edit kept
    detected = [s for s in after if s["source"] == "detected"]
    assert len(detected) == 1  # the wall again; the box is not duplicated next to the edited one
    assert detected[0]["effect"] == "noise"  # effect carried over to the re-detected wall


def test_redetect_without_a_scan_is_404(rig, tmp_path):
    with engine(rig, data_dir=tmp_path) as client:
        assert client.post("/api/show/redetect").status_code == 404


def test_redetect_can_be_undone(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        box = surfaces(client)[1]
        client.patch(f"/api/show/surfaces/{box['id']}", json={"effect": "fill"})
        before = surfaces(client)
        assert client.post("/api/show/redetect").status_code == 200
        assert client.get("/api/show").json()["history"]["undo"] == "Redetect"
        assert client.post("/api/show/undo").json()["surfaces"] == before


def test_redetect_keeps_every_scenes_effects_on_their_surfaces(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        box = surfaces(client)[1]["id"]
        client.patch(f"/api/show/surfaces/{box}", json={"effect": "fill"})
        client.post("/api/show/scenes", json={"name": "Night"})
        client.patch(f"/api/show/surfaces/{box}", json={"effect": "outline"})
        assert client.post("/api/show/redetect").status_code == 200
        assert next(s for s in surfaces(client) if s["id"] == box)["effect"] == "outline"
        client.post("/api/show/scenes/1/open")
        assert next(s for s in surfaces(client) if s["id"] == box)["effect"] == "fill"
