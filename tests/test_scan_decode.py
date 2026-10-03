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
    # Refinement blends across the box's depth edge; check the error away from it.
    import cv2
    near_box = cv2.dilate(scene.box_region.astype(np.uint8), np.ones((15, 15), np.uint8)).astype(bool)
    away = both & ~near_box
    assert np.abs(r.proj_x[away] - scene.true_x[away]).max() <= 3
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
    # Inside the projection, projector pixels get a color (small holes filled). The only
    # gap left is the strip beside the box that the camera can't see (its shadow).
    assert covered[10:-10, 10:-10].mean() > 0.97
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


def test_scan_image_is_solid_when_camera_is_coarser_than_projector():
    """Real rig: ~0.7 camera px per projector px, finest 3 bits unreadable.
    Pixels must not snap onto an 8-px lattice of dots."""
    from engine.scan import projector_space_image

    scene = Scene(proj_w=512, proj_h=288, cam_w=320, cam_h=240, unresolved_bits=3)
    r = decode(scene)
    img, covered = projector_space_image(r)

    interior = covered[40:-40, 40:-40]
    assert interior.mean() > 0.98
    assert (img[40:-40, 40:-40].max(axis=2) > 50).mean() > 0.98


def test_coarse_decode_is_refined_below_the_stripe_width():
    import cv2

    scene = Scene(proj_w=512, proj_h=288, cam_w=320, cam_h=240, unresolved_bits=3)
    r = decode(scene)

    # Away from the box edge, where smoothing would blend two surfaces.
    near_box = cv2.dilate(scene.box_region.astype(np.uint8), np.ones((15, 15), np.uint8)).astype(bool)
    ok = r.valid & scene.lit & ~near_box
    err = np.abs(r.proj_x[ok] - scene.true_x[ok])
    assert np.percentile(err, 95) <= 2  # raw coarse decode is up to 7 px off


def test_hole_fill_closes_more_gaps_the_higher_it_is():
    """#66: hole fill 0 leaves the camera's undecoded specks; higher values close them."""
    from engine.scan import projector_space_image

    r = decode(Scene())
    hit = np.zeros((r.height, r.width), bool)
    hit[r.proj_y[r.valid], r.proj_x[r.valid]] = True
    filled = {px: projector_space_image(r, hole_fill_px=px)[1] for px in (0, 5, 15)}
    assert (filled[0] == hit).all()  # 0: only what was actually decoded
    assert filled[0].sum() < filled[5].sum() < filled[15].sum()
    assert projector_space_image(r)[1].sum() == projector_space_image(r, hole_fill_px=9)[1].sum()  # today's default


def test_a_camera_mask_drops_everything_outside_it():
    """#66: only the masked area of the camera image is scanned; the rest yields nothing."""
    from engine.scan import apply_camera_mask, projector_space_image
    from engine.surfaces import detect_surfaces

    scene = Scene()
    full = decode(scene)
    # Keep the left half of the camera image (0..1 coordinates), so the box (u 190..250) is outside.
    left = [[[0, 0], [0.5, 0], [0.5, 1], [0, 1]]]
    masked = apply_camera_mask(decode(scene), left)
    assert not masked.valid[:, 170:].any()  # nothing decoded right of the mask's edge (160 px)
    assert masked.valid[:, :150].sum() == full.valid[:, :150].sum()  # inside: untouched
    assert (masked.proj_x[~masked.valid] == -1).all()
    surfaces = detect_surfaces(masked, projector_space_image(masked))
    assert len(surfaces) < len(detect_surfaces(full, projector_space_image(full)))  # the box is gone


def test_no_mask_or_an_empty_one_keeps_everything():
    from engine.scan import apply_camera_mask

    r = decode(Scene())
    assert apply_camera_mask(r, None).valid.sum() == r.valid.sum()
    assert apply_camera_mask(decode(Scene()), []).valid.sum() == r.valid.sum()


def _decode_at(scene: Scene, gains: list[float]):
    """Decodes with each pattern captured at every gain and merged (HDR); one gain = a plain scan."""
    from engine.scan import HdrDecoder

    dec = HdrDecoder(scene.proj_w, scene.proj_h, gains)
    for p in pattern_sequence(scene.proj_w, scene.proj_h):
        frames = []
        for g in gains:
            scene.exposure_gain = g
            frames.append(scene.frame(p))
        dec.add(p, frames)
    return dec.result()


def test_hdr_decodes_a_dark_and_bright_scene_better_than_any_single_exposure():
    """#66: a near-black box and a bright, well-lit wall. Short exposures lose the box in the noise;
    long ones saturate the wall in both stripe states (room light too); merging per pixel keeps both."""
    def coverage(r):
        return int(r.valid.sum())

    scene = lambda: Scene(box_albedo=0.05, wall_albedo=0.9, ambient=110, room_light=True)  # noqa: E731
    short = coverage(_decode_at(scene(), [0.8]))
    long = coverage(_decode_at(scene(), [3.0]))
    hdr_result = _decode_at(scene(), [0.8, 3.0])
    assert coverage(hdr_result) > max(short, long)
    s = scene()
    assert hdr_result.valid[s.box_region & s.lit].mean() > 0.9  # the dark box decodes
    err = np.abs(hdr_result.proj_x - s.true_x)[hdr_result.valid]
    assert (err <= 1).mean() > 0.999
    assert hdr_result.white.dtype == np.uint8 and hdr_result.white.max() <= 255  # shown as the first exposure


def test_one_exposure_decodes_exactly_like_before():
    a = _decode_at(Scene(), [1.0])
    b = decode(Scene())
    assert (a.valid == b.valid).all() and (a.proj_x == b.proj_x).all()


def test_exact_reads_stay_exact_next_to_an_objects_edge():
    """Smoothing for unreadable fine stripes only touches pixels that have them: it used to blur
    every pixel, pulling the box's edge toward the wall behind it."""
    s = Scene(box_albedo=0.05, wall_albedo=0.9, ambient=110, room_light=True)
    s.exposure_gain = 0.8
    r = decode(s)
    t = Scene(box_albedo=0.05, wall_albedo=0.9, ambient=110, room_light=True)
    err = np.abs(r.proj_x - t.true_x)[r.valid]
    assert (err > 1).sum() < 50  # was about 1,500
