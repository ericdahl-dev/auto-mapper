import json

import pytest

from engine.hardware import FakeHardware
from tests.helpers import AC410, LAPTOP, PROJECTOR, engine

WALL = {"polygon": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "area": 2073600.0}
PNG = b"\x89PNG\r\n\x1a\nfake image"
MP4 = b"\x00\x00\x00\x18ftypmp42 fake video"


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410])


@pytest.fixture
def scanned(tmp_path):
    d = tmp_path / "scans" / "latest"
    d.mkdir(parents=True)
    (d / "meta.json").write_text(json.dumps({"width": 1920, "height": 1080, "surfaces": [WALL]}))
    return tmp_path


def upload(client, name: str, body: bytes):
    return client.post("/api/media", params={"name": name}, content=body)


def test_uploaded_media_is_served_back(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        resp = upload(client, "My Holiday Photo.PNG", PNG)
        assert resp.status_code == 200
        media = resp.json()
        assert media["kind"] == "image"
        assert media["name"].startswith("my-holiday-photo-") and media["name"].endswith(".png")
        assert media["url"] == f"/api/media/{media['name']}"

        got = client.get(media["url"])
        assert got.status_code == 200
        assert got.content == PNG
        assert got.headers["content-type"] == "image/png"

    assert (scanned / "scans" / "latest" / "media" / media["name"]).read_bytes() == PNG


def test_videos_are_served_with_range_support(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        media = upload(client, "loop.mp4", MP4).json()
        assert media["kind"] == "video"
        part = client.get(media["url"], headers={"Range": "bytes=0-3"})  # browsers seek and loop video this way
        assert part.status_code == 206
        assert part.content == MP4[:4]
        assert client.get(media["url"]).headers["content-type"] == "video/mp4"


def test_same_name_different_content_does_not_replace_the_first_file(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        first = upload(client, "art.png", PNG).json()
        second = upload(client, "art.png", PNG + b"v2").json()
        again = upload(client, "art.png", PNG).json()
        assert first["name"] != second["name"]
        assert again["name"] == first["name"]  # the same file uploaded twice is stored once
        assert client.get(first["url"]).content == PNG


def test_unsupported_or_unsafe_media_is_rejected(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert upload(client, "notes.txt", b"hello").status_code == 415
        assert upload(client, "script.html", b"<script>").status_code == 415
        assert upload(client, "empty.png", b"").status_code == 400
        assert client.get("/api/media/nope.png").status_code == 404
        assert client.get("/api/media/..%2Fmeta.json").status_code == 404
        assert client.get("/api/media/meta.json").status_code == 404


def test_media_is_saved_with_the_project_and_restored_on_open(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        media = upload(client, "wall.png", PNG).json()
        client.patch("/api/scene/surfaces/1", json={"effect": "media", "params": {"src": media["url"], "fit": "cover"}})
        assert client.post("/api/projects", json={"name": "Gallery"}).status_code == 200
        assert (scanned / "projects" / "gallery" / "media" / media["name"]).read_bytes() == PNG

        # Another project's media replaces the latest scan's media...
        latest_media = scanned / "scans" / "latest" / "media"
        for f in latest_media.iterdir():
            f.unlink()
        other = upload(client, "other.png", PNG + b"other").json()

        # ...and opening the project brings its own back.
        assert client.post("/api/projects/gallery/open").status_code == 200
        assert client.get(media["url"]).content == PNG
        assert client.get(other["url"]).status_code == 404
        surface = client.get("/api/scene").json()["surfaces"][0]
        assert surface["params"] == {"src": media["url"], "fit": "cover"}


def test_opening_a_project_without_media_clears_the_latest_media(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.post("/api/projects", json={"name": "Plain"})
        stray = upload(client, "stray.png", PNG).json()
        client.post("/api/projects/plain/open")
        assert client.get(stray["url"]).status_code == 404

    assert sorted(p.name for p in (scanned / "projects" / "plain").iterdir()) == ["meta.json", "project.json", "scene.json"]
