"""Outlines follow curves (#31) while straight edges stay straight."""

import cv2
import numpy as np

from engine.surfaces import outline_polygon


def max_distance_to_boundary(poly, mask):
    """Largest distance from any polygon edge point to the true region boundary, in px."""
    edges = cv2.Canny(mask.astype(np.uint8) * 255, 50, 150)
    dist = cv2.distanceTransform((edges == 0).astype(np.uint8), cv2.DIST_L2, 5)
    pts = np.asarray(poly, float)
    worst = 0.0
    for a, b in zip(pts, np.roll(pts, -1, axis=0)):
        for t in np.linspace(0, 1, 20):
            x, y = a + (b - a) * t
            worst = max(worst, float(dist[int(round(y)), int(round(x))]))
    return worst


def test_a_disc_comes_back_round():
    mask = np.zeros((600, 800), np.uint8)
    cv2.circle(mask, (400, 300), 150, 1, -1)

    poly = outline_polygon(mask)

    assert max_distance_to_boundary(poly, mask) <= 3
    assert len(poly) >= 16  # many short sides, not a coarse polygon


def test_an_s_curve_keeps_both_bends():
    """Outward and inward bends, like a corbel's scroll profile."""
    mask = np.zeros((600, 900), np.uint8)
    xs = np.arange(150, 751)
    top = (300 + 70 * np.sin((xs - 150) / 600 * 2 * np.pi)).astype(int)
    for x, t in zip(xs, top):
        mask[t:500, x] = 1

    poly = outline_polygon(mask)

    assert max_distance_to_boundary(poly, mask) <= 3


def test_wobbly_straight_edges_still_come_out_as_a_few_sides():
    """Real edges wobble by a pixel or two; that must not be mistaken for a curve."""
    rng = np.random.default_rng(3)
    mask = np.zeros((600, 900), np.uint8)
    cv2.fillPoly(mask, [np.int32([[200, 150], [700, 170], [690, 450], [210, 430]])], 1)
    noise = (rng.random(mask.shape) < 0.5) & (cv2.Canny(mask * 255, 50, 150) > 0)
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8)) * ~noise + mask * noise

    poly = outline_polygon(mask)

    assert 4 <= len(poly) <= 6
