import numpy as np

from engine.scan import GrayDecoder, pattern_sequence, projector_space_image
from engine.surfaces import detect_surfaces
from tests.synthetic import Scene


def surfaces_for(scene: Scene):
    dec = GrayDecoder(scene.proj_w, scene.proj_h)
    for p in pattern_sequence(scene.proj_w, scene.proj_h):
        dec.add(p, scene.frame(p))
    return detect_surfaces(dec.result(), projector_space_image(dec.result()))


def centroid(poly):
    return np.asarray(poly, float).mean(axis=0)


def test_box_the_same_colour_as_the_wall_is_found_by_depth_alone():
    scene = Scene(box_albedo=0.75, wall_albedo=0.75)
    surfaces = surfaces_for(scene)

    assert len(surfaces) == 2
    wall, box = surfaces  # largest first
    truth = scene.box_projector_quad()
    assert np.linalg.norm(centroid(box["polygon"]) - truth.mean(axis=0)) < 10
    a, b = truth[2] - truth[0], truth[3] - truth[1]
    true_area = 0.5 * abs(a[0] * b[1] - a[1] * b[0])
    assert 0.7 * true_area < box["area"] < 1.3 * true_area
    assert wall["area"] > 5 * box["area"]


def test_plain_wall_is_one_surface():
    surfaces = surfaces_for(Scene(box=False))

    assert len(surfaces) == 1


def test_polygons_are_in_projector_pixels():
    scene = Scene()
    for s in surfaces_for(scene):
        pts = np.asarray(s["polygon"])
        assert pts.shape[1] == 2 and len(pts) >= 3
        assert (pts[:, 0] >= 0).all() and (pts[:, 0] < 256).all()
        assert (pts[:, 1] >= 0).all() and (pts[:, 1] < 144).all()
