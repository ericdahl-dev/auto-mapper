"""Geometry shared by surface detection and the show."""

import numpy as np


def polygon_area(polygon: list[list[float]]) -> float:
    """A surface's area in projector pixels (shoelace formula), whatever the outline's winding."""
    pts = np.asarray(polygon, float)
    x, y = pts[:, 0], pts[:, 1]
    return float(0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))
