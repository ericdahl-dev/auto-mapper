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


# room1: front of a wooden kitchen island: a centre pillar, door panels either side,
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
        assert len(s["polygon"]) <= 8, f"{len(s['polygon'])} corners on a {int(s['area'])} px surface"


def test_pillar_shaft_has_parallel_sides(room1):
    """The pillar joins the centre corbel at the top (continuous wood), so only its shaft,
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
