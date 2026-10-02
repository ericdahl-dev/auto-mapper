"""#40: choose which display is the projector (multi-monitor setups)."""

import pytest

from engine.hardware import FakeHardware
from tests.helpers import AC410, editor, engine, output

# Work setup: an external monitor is the main display, so "first non-main" is the laptop screen.
THUNDERBOLT = {"name": "Thunderbolt Display", "key": "610:9227:16200ddf", "width": 2560, "height": 1440, "main": True}
LAPTOP = {"name": "Color LCD", "key": "610:a050:fd626d62", "width": 3456, "height": 2234, "main": False}
LENOVO = {"name": "P24q-10", "key": "30ae:61a5:1010101", "width": 1920, "height": 1080, "main": False}


@pytest.fixture
def work():
    return FakeHardware(displays=[THUNDERBOLT, LAPTOP, LENOVO], cameras=[AC410])


def projector(client):
    return client.get("/api/status").json()["hardware"]["projector"]


def test_status_lists_displays_and_defaults_to_the_first_non_main_one(work, tmp_path):
    with engine(work, data_dir=tmp_path) as client:
        hw = client.get("/api/status").json()["hardware"]

    assert [d["name"] for d in hw["displays"]] == ["Thunderbolt Display", "Color LCD", "P24q-10"]
    assert hw["projector"]["key"] == LAPTOP["key"]  # unchanged default for the simple setup


def test_choosing_a_projector_is_pushed_and_remembered(work, tmp_path):
    with engine(work, data_dir=tmp_path) as client, editor(client) as ed:
        ed.receive_json()
        assert client.post("/api/projector", json={"key": LENOVO["key"]}).status_code == 200
        assert ed.receive_json()["hardware"]["projector"]["name"] == "P24q-10"

    with engine(work, data_dir=tmp_path) as client:
        assert projector(client)["key"] == LENOVO["key"]


def test_scan_readiness_uses_the_chosen_display(work, tmp_path):
    with engine(work, data_dir=tmp_path) as client, output(client, 1920, 1080):
        assert client.get("/api/status").json()["can_scan"] is False  # 1080p output vs the laptop default
        client.post("/api/projector", json={"key": LENOVO["key"]})
        assert client.get("/api/status").json()["can_scan"] is True


def test_a_saved_projector_that_is_unplugged_falls_back_and_says_so(work, tmp_path):
    with engine(work, data_dir=tmp_path) as client:
        client.post("/api/projector", json={"key": LENOVO["key"]})

    unplugged = FakeHardware(displays=[THUNDERBOLT, LAPTOP], cameras=[AC410])
    with engine(unplugged, data_dir=tmp_path) as client:
        hw = client.get("/api/status").json()["hardware"]

    assert hw["projector"]["key"] == LAPTOP["key"]
    assert hw["projector_missing"] == "P24q-10"


def test_unknown_display_is_404(work, tmp_path):
    with engine(work, data_dir=tmp_path) as client:
        assert client.post("/api/projector", json={"key": "nope"}).status_code == 404
