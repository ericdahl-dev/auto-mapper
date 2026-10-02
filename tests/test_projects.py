import json

import pytest

from engine.hardware import FakeHardware
from tests.helpers import AC410, engine, LAPTOP, output, PROJECTOR, write_scan

WALL = {"polygon": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "area": 2073600.0}
BOX = {"polygon": [[1230, 880], [1540, 880], [1690, 1080], [1220, 1080]], "area": 70000.0}


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410])


@pytest.fixture
def scanned(tmp_path):
    folder = write_scan(tmp_path, [WALL, BOX], 1920, 1080)
    (folder.path / "scan.png").write_bytes(b"png")
    (folder.path / "map.npz").write_bytes(b"npz")
    return tmp_path


def test_saved_project_reopens_with_the_same_scene(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.patch("/api/show/surfaces/2", json={"effect": "outline", "params": {"width": 9}, "name": "Box"})
        saved_scene = client.get("/api/show").json()

        resp = client.post("/api/projects", json={"name": "Kitchen island"})
        assert resp.status_code == 200
        assert resp.json()["slug"] == "kitchen-island"

        client.patch("/api/show/surfaces/2", json={"effect": "none"})  # later changes...
        listed = client.get("/api/projects").json()
        assert [p["name"] for p in listed] == ["Kitchen island"]
        assert listed[0]["surfaces"] == 2

        assert client.post("/api/projects/kitchen-island/open").status_code == 200
        reopened = client.get("/api/show").json()
        # ...are discarded by reopening. Presentation (session state) and scan_rev (derived on
        # load) are not part of the project.
        session = {"presentation", "scan_rev"}
        assert {k: v for k, v in reopened.items() if k not in session} == {
            k: v for k, v in saved_scene.items() if k not in session}
        assert client.get("/api/status").json()["project"] == {"name": "Kitchen island", "slug": "kitchen-island"}

    folder = scanned / "projects" / "kitchen-island"
    assert sorted(p.name for p in folder.iterdir()) == ["map.npz", "meta.json", "project.json", "scan.png", "scene.json"]


def test_opening_a_project_plays_without_a_camera(scanned):
    with engine(FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410]), data_dir=scanned) as client:
        client.patch("/api/show/surfaces/1", json={"effect": "noise"})
        client.post("/api/projects", json={"name": "Show"})

    no_camera = FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[])
    with engine(no_camera, data_dir=scanned) as client, output(client) as out:
        out.receive_json()  # scene on hello
        assert client.post("/api/projects/show/open").status_code == 200
        pushed = out.receive_json()

    assert pushed["type"] == "show"
    assert pushed["surfaces"][0]["effect"] == "noise"


def test_unknown_project_is_404(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert client.post("/api/projects/nope/open").status_code == 404


def test_nothing_to_save_before_a_scan(rig, tmp_path):
    with engine(rig, data_dir=tmp_path) as client:
        assert client.post("/api/projects", json={"name": "Empty"}).status_code == 409


def test_saving_again_after_a_rescan_updates_the_project(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.post("/api/projects", json={"name": "Island"})
        # A rescan replaces the latest scan (here: new image and one surface fewer)...
        latest = scanned / "scans" / "latest"
        (latest / "scan.png").write_bytes(b"new png")
        meta = {"width": 1920, "height": 1080, "surfaces": [WALL]}
        (latest / "meta.json").write_text(json.dumps(meta))
        (latest / "scene.json").unlink()
        client.post("/api/projects/island/open")  # simulate: reopen, then rescan resets the scene
        (latest / "scan.png").write_bytes(b"new png")
        (latest / "meta.json").write_text(json.dumps(meta))
        (latest / "scene.json").unlink()
        client.app.state.hub.show.reload()
        # ...and saving under the same name overwrites the project.
        client.post("/api/projects", json={"name": "Island"})
        listed = client.get("/api/projects").json()

    assert len(listed) == 1 and listed[0]["surfaces"] == 1
    assert (scanned / "projects" / "island" / "scan.png").read_bytes() == b"new png"
