"""One definition of a surface's area, used by detection and by the show (#77)."""

from engine.geometry import polygon_area
from engine.scan import GrayDecoder, pattern_sequence, projector_space_image
from engine.surfaces import detect_surfaces
from tests.synthetic import Scene


def test_area_of_simple_outlines_in_either_winding():
    square = [[0, 0], [10, 0], [10, 10], [0, 10]]
    assert polygon_area(square) == 100
    assert polygon_area(square[::-1]) == 100
    assert polygon_area([[0, 0], [4, 0], [0, 3]]) == 6


def test_detected_surfaces_report_the_same_area_the_show_uses():
    scene = Scene(proj_w=256, proj_h=144)
    dec = GrayDecoder(256, 144)
    for p in pattern_sequence(256, 144):
        dec.add(p, scene.frame(p))
    result = dec.result()
    found = detect_surfaces(result, projector_space_image(result))
    assert found
    for s in found:
        assert s["area"] == polygon_area(s["polygon"])
