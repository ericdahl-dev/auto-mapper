import numpy as np

from engine.scan import GrayDecoder, pattern_sequence
from tests.synthetic import Scene


def decode(scene: Scene):
    dec = GrayDecoder(scene.proj_w, scene.proj_h)
    for p in pattern_sequence(scene.proj_w, scene.proj_h):
        dec.add(p, scene.frame(p))
    return dec.result()


def test_clean_scene_decodes_to_true_projector_pixels():
    scene = Scene()
    r = decode(scene)

    assert (r.valid == scene.lit).mean() > 0.99
    both = r.valid & scene.lit
    assert np.abs(r.proj_x[both] - scene.true_x[both]).max() <= 1
    assert np.abs(r.proj_y[both] - scene.true_y[both]).max() <= 1


def test_unlit_camera_pixels_are_invalid():
    scene = Scene()
    r = decode(scene)

    assert not r.valid[~scene.lit].any()
    assert (r.proj_x[~r.valid] == -1).all()


def test_stripes_too_fine_for_the_camera_still_decode_coarsely():
    scene = Scene(unresolved_bits=2)
    r = decode(scene)

    both = r.valid & scene.lit
    assert both.sum() > 0.95 * scene.lit.sum()
    assert np.abs(r.proj_x[both] - scene.true_x[both]).max() <= 3
    assert r.bit_reliability["x"][0] < 0.2  # reported so the rig can see which bits failed
    assert r.bit_reliability["x"][5] > 0.95


def test_white_and_black_reference_frames_are_kept():
    scene = Scene()
    r = decode(scene)

    assert r.white.shape == (scene.cam_h, scene.cam_w, 3)
    assert r.white[scene.lit].mean() > r.black[scene.lit].mean() + 100


def test_scan_image_is_the_scene_seen_from_the_projector():
    from engine.scan import projector_space_image

    scene = Scene()
    r = decode(scene)
    img, covered = projector_space_image(r)

    assert img.shape == (scene.proj_h, scene.proj_w, 3)
    # Inside the projection, every projector pixel gets a colour (holes filled).
    assert covered[10:-10, 10:-10].all()
    assert img[10:-10, 10:-10].mean() > 100


def test_coverage_counts_projector_blocks_that_decoded():
    from engine.scan import block_coverage

    covered = np.zeros((144, 256), bool)
    covered[:, :128] = True
    assert block_coverage(covered) == 0.5
    assert block_coverage(np.ones((144, 256), bool)) == 1.0


def test_full_synthetic_scan_covers_most_of_the_projector():
    from engine.scan import block_coverage, projector_space_image

    _, covered = projector_space_image(decode(Scene()))
    assert block_coverage(covered) > 0.9
