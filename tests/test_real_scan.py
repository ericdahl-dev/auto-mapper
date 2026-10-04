"""Regression tests against a real scan of the rig (fixtures/local/, never committed).

Skipped where the fixture isn't present. Synthetic scenes can't catch regressions on
real rooms (texture, cloth folds, dark objects); this can.
"""

import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from engine.scan import DecodeResult, block_coverage
from engine.surfaces import detect_surfaces

ROOM1 = Path(__file__).parent.parent / "fixtures" / "local" / "room1"
pytestmark = pytest.mark.skipif(not ROOM1.exists(), reason="local real-scan fixture not present")


@pytest.fixture(scope="module")
def room1():
    m = np.load(ROOM1 / "map.npz")
    meta = json.loads((ROOM1 / "meta.json").read_text())
    decoded = DecodeResult(
        proj_x=m["proj_x"].astype(np.int32), proj_y=m["proj_y"].astype(np.int32), valid=m["valid"],
        white=None, black=None, bit_reliability={}, width=meta["width"], height=meta["height"],
    )
    image, covered = cv2.imread(str(ROOM1 / "scan.png")), m["covered"]
    return detect_surfaces(decoded, (image, covered)), covered


def centroids(surfaces):
    return [np.asarray(s["polygon"], float).mean(axis=0) for s in surfaces]


def solidity(polygon):
    pts = np.asarray(polygon, np.float32)
    hull = cv2.convexHull(pts)
    return cv2.contourArea(pts) / max(cv2.contourArea(hull), 1.0)


# room1: front of a wooden kitchen island: a center pillar, door panels either side,
# corbels under a countertop; dark cabinets and background around it.


def test_room_still_decodes_most_of_the_frame(room1):
    _, covered = room1
    assert block_coverage(covered) > 0.75


def test_room_gives_a_handful_of_surfaces_not_fragments(room1):
    surfaces, _ = room1
    assert 6 <= len(surfaces) <= 16


def test_large_surfaces_have_straight_sides(room1):
    surfaces, _ = room1
    big = [s for s in surfaces if s["area"] > 0.03 * 1920 * 1080]
    assert big
    for s in big:
        # No squiggles. Not "a box": the door panels legitimately have a groove inlet (~16 corners).
        assert len(s["polygon"]) <= 20, f"{len(s['polygon'])} corners on a {int(s['area'])} px surface"


def test_pillar_shaft_has_parallel_sides(room1):
    """The pillar joins the center corbel at the top (continuous wood), so only its shaft,
    the lower part, is a box."""
    surfaces, _ = room1
    pillar = [s for s, c in zip(surfaces, centroids(surfaces)) if 780 <= c[0] <= 1020 and c[1] > 500]
    assert len(pillar) == 1
    mask = np.zeros((1080, 1920), np.uint8)
    cv2.fillPoly(mask, [np.int32(pillar[0]["polygon"])], 1)
    rows = np.nonzero(mask.any(axis=1))[0]
    shaft = range(int(rows.min() + 0.4 * np.ptp(rows)), int(rows.max()) - 5)
    widths = [np.ptp(np.nonzero(mask[y])[0]) for y in shaft]
    assert np.ptp(widths) < 0.15 * np.median(widths)  # constant width: parallel sides


def test_left_corbel_keeps_its_curved_scroll_edge(room1):
    """#31: curves are followed, not collapsed into a few straight sides."""
    surfaces, _ = room1
    corbel = [s for s, c in zip(surfaces, centroids(surfaces)) if 420 <= c[0] <= 560 and 330 <= c[1] <= 470]
    assert len(corbel) == 1
    assert len(corbel[0]["polygon"]) >= 12


# room2 (#15): the a6600 scan of a wall, 2026-10-03: a TV (glossy, doesn't decode), a recessed panel,
# a light switch plate and a bookshelf, with a chair in front. Boxes in projector pixels (1920x1080).
ROOM2 = Path(__file__).parent.parent / "fixtures" / "local" / "room2"
TV = (0, 134, 405, 576)
PANEL = (790, 250, 1030, 525)
SWITCH = (1045, 815, 1190, 980)
BOOKSHELF = (1385, 50, 1920, 1080)
CHAIR = (230, 860, 600, 1080)


@pytest.fixture(scope="module")
def room2():
    if not ROOM2.exists():
        pytest.skip("local real-scan fixture room2 not present")
    m = np.load(ROOM2 / "map.npz")
    meta = json.loads((ROOM2 / "meta.json").read_text())
    decoded = DecodeResult(
        proj_x=m["proj_x"].astype(np.int32), proj_y=m["proj_y"].astype(np.int32), valid=m["valid"],
        white=None, black=None, bit_reliability={}, width=meta["width"], height=meta["height"],
    )
    image, covered = cv2.imread(str(ROOM2 / "scan.png")), m["covered"]
    return detect_surfaces(decoded, (image, covered)), covered


def inside(surfaces, box):
    """Surfaces whose middle lies in the box."""
    x0, y0, x1, y1 = box
    return [s for s, (cx, cy) in zip(surfaces, centroids(surfaces)) if x0 <= cx <= x1 and y0 <= cy <= y1]


def fills(surface, box, share):
    """The surface's bounding box spans at least `share` of the box both ways."""
    x, y, w, h = cv2.boundingRect(np.int32(np.round(surface["polygon"])))
    return w >= share * (box[2] - box[0]) and h >= share * (box[3] - box[1])


def test_room2_still_decodes_most_of_the_frame(room2):
    assert block_coverage(room2[1]) > 0.8


def test_room2_switch_plate_is_one_surface(room2):
    found = inside(room2[0], SWITCH)
    assert len(found) == 1 and fills(found[0], SWITCH, 0.6)


def test_room2_recessed_panel_is_one_surface(room2):
    found = inside(room2[0], PANEL)
    assert len(found) == 1 and fills(found[0], PANEL, 0.6)


def test_room2_tv_is_a_surface(room2):
    found = inside(room2[0], TV)
    assert len(found) == 1 and fills(found[0], TV, 0.7)


def test_room2_bookshelf_is_one_surface(room2):
    found = inside(room2[0], BOOKSHELF)
    assert len(found) == 1 and fills(found[0], BOOKSHELF, 0.8)


def test_room2_no_surface_on_the_chair(room2):
    assert inside(room2[0], CHAIR) == []
