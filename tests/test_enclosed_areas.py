"""Areas a surface encloses (#15): a glossy TV, a bookshelf's contents, a chair in front of a wall.

Scans are drawn straight in projector space: the camera sees the projector one to one, so
outlines come from color edges and missed areas alone.
"""

import cv2
import numpy as np
import pytest

from engine.scan import DecodeResult
from engine.surfaces import detect_surfaces

W, H = 960, 540
WALL = 150


def detect(image: np.ndarray, covered: np.ndarray) -> list[dict]:
    v, u = np.mgrid[0:H, 0:W]
    decoded = DecodeResult(
        proj_x=np.where(covered, u, -1).astype(np.int32), proj_y=np.where(covered, v, -1).astype(np.int32),
        valid=covered.copy(), white=None, black=None, bit_reliability={}, width=W, height=H,
    )
    noise = np.random.default_rng(0).normal(0, 1.5, image.shape)
    image = np.clip(image + noise, 0, 255).astype(np.uint8)
    return detect_surfaces(decoded, (np.dstack([image] * 3), covered))


def wall():
    return np.full((H, W), WALL, np.float64), np.ones((H, W), bool)


def centroid(surface):
    return np.asarray(surface["polygon"], float).mean(axis=0)


def inside(surfaces, box):
    x0, y0, x1, y1 = box
    return [s for s in surfaces if x0 <= centroid(s)[0] <= x1 and y0 <= centroid(s)[1] <= y1]


def bounds(surface):
    x, y, w, h = cv2.boundingRect(np.int32(np.round(surface["polygon"])))
    return x, y, x + w, y + h


def close_to(surface, box, px=12):
    return all(abs(a - b) <= px for a, b in zip(bounds(surface), box))


@pytest.mark.parametrize("box", [(520, 280, 820, 500), (0, 100, 260, 360)], ids=["middle", "at-the-edge"])
def test_a_large_missed_area_the_wall_encloses_is_a_surface(box):
    """A glossy TV doesn't decode, but the projector still lights it: its outline is the missed area's edge."""
    image, covered = wall()
    x0, y0, x1, y1 = box
    image[y0:y1, x0:x1] = 20
    covered[y0:y1, x0:x1] = False

    surfaces = detect(image, covered)

    assert len(surfaces) == 2
    tv = inside(surfaces, box)
    assert len(tv) == 1 and close_to(tv[0], box)


def test_a_small_missed_spot_stays_a_missed_area():
    image, covered = wall()
    image[200:250, 400:460] = 20
    covered[200:250, 400:460] = False

    assert len(detect(image, covered)) == 1


def test_missed_background_around_an_object_is_not_a_surface():
    """Most of the frame is missed (a dark room): it surrounds the object, the object doesn't enclose it."""
    image, covered = wall()
    covered[:, :] = False
    image[:, :] = 20
    covered[100:400, 200:500] = True
    image[100:400, 200:500] = WALL

    surfaces = detect(image, covered)

    assert len(surfaces) == 1
    assert close_to(surfaces[0], (200, 100, 500, 400))


SHELF = (560, 40, 900, 500)


def bookshelf(image, covered):
    """A dark bookshelf on the wall; its contents are a few objects with missed areas between them."""
    x0, y0, x1, y1 = SHELF
    image[y0:y1, x0:x1] = 60
    covered[y0 + 20:y1 - 20, x0 + 20:x1 - 20] = False  # shadowed shelf interior
    image[y0 + 20:y1 - 20, x0 + 20:x1 - 20] = 15
    for (bx, by), shade in zip([(600, 80), (760, 90), (610, 290), (750, 300)], [200, 110, 230, 90]):
        image[by:by + 130, bx:bx + 110] = shade
        covered[by:by + 130, bx:bx + 110] = True


def test_fragments_inside_a_clear_outline_are_one_surface():
    image, covered = wall()
    bookshelf(image, covered)

    surfaces = detect(image, covered)

    assert len(surfaces) == 2
    shelf = inside(surfaces, SHELF)
    assert len(shelf) == 1 and close_to(shelf[0], SHELF)


def test_objects_that_fill_the_outline_between_them_stay_separate():
    """Two boxes side by side on a wall: they share the wall's outline but are two surfaces."""
    image, covered = wall()
    image[80:330, 100:280] = 200
    image[80:330, 280:460] = 90

    surfaces = detect(image, covered)

    assert len(surfaces) == 3
    assert len(inside(surfaces, (100, 80, 280, 330))) == 1
    assert len(inside(surfaces, (280, 80, 460, 330))) == 1


CHAIR = (150, 330, 450, 540)


def test_a_scrap_of_something_in_front_of_the_wall_is_not_a_surface():
    """A chair in front of the wall: mostly missed (its shadow) with one small piece that decodes."""
    image, covered = wall()
    x0, y0, x1, y1 = CHAIR
    image[y0:y1, x0:x1] = 15
    covered[y0:y1, x0:x1] = False
    for y in range(y0 + 30, y1, 60):  # rails, too thin to be surfaces
        covered[y:y + 14, x0:x1] = True
        image[y:y + 14, x0:x1] = 70
    covered[440:492, 330:390] = True  # the seat corner
    image[440:492, 330:390] = 120

    surfaces = detect(image, covered)

    assert len(surfaces) == 1  # the wall, around the chair
    assert surfaces[0]["area"] > 0.8 * W * H
