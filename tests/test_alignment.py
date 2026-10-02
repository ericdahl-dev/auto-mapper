"""#63: realign the whole show (a corner pin over the output) and a master brightness."""

import pytest

from engine.hardware import FakeHardware
from tests.helpers import AC410, LAPTOP, PROJECTOR, editor, engine, output, write_scan

WALL = {"polygon": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "area": 2073600.0}
NUDGED = [[10, 4], [1915, 0], [1920, 1078], [0, 1080]]


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410])


@pytest.fixture
def scanned(tmp_path):
    write_scan(tmp_path, [WALL])
    return tmp_path


def test_a_new_show_is_unaligned_at_full_brightness(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert client.get("/api/show").json()["alignment"] == {
            "corners": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "brightness": 1.0}


def test_realigning_and_dimming_are_pushed_to_the_output_and_saved(rig, scanned):
    with engine(rig, data_dir=scanned) as client, output(client) as out:
        out.receive_json()
        client.post("/api/show/alignment", json={"corners": NUDGED, "brightness": 0.6})
        pushed = out.receive_json()
        assert pushed["alignment"] == {"corners": NUDGED, "brightness": 0.6}
    with engine(rig, data_dir=scanned) as client:  # saved with the show
        assert client.get("/api/show").json()["alignment"]["corners"] == NUDGED


def test_alignment_can_be_reset(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.post("/api/show/alignment", json={"corners": NUDGED, "brightness": 0.5})
        client.post("/api/show/alignment/reset")
        assert client.get("/api/show").json()["alignment"] == {
            "corners": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "brightness": 1.0}


def test_bad_alignments_are_refused(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert client.post("/api/show/alignment", json={"corners": [[0, 0], [1, 1]]}).status_code == 422
        assert client.post("/api/show/alignment", json={"brightness": 1.5}).status_code == 422


def test_a_rescan_keeps_brightness_but_drops_the_alignment(rig, scanned):
    """A new scan already matches where the projector is now, so an old correction would be wrong."""
    with engine(rig, data_dir=scanned) as client:
        client.post("/api/show/alignment", json={"corners": NUDGED, "brightness": 0.7})
        client.app.state.hub.show.apply_detection({"width": 1920, "height": 1080, "surfaces": [WALL]})
        assert client.get("/api/show").json()["alignment"] == {
            "corners": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "brightness": 0.7}
