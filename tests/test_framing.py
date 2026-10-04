"""#149: how well the projection fills the camera frame, from a white and a black frame."""

import numpy as np

from engine.framing import measure_framing
from tests.synthetic import Scene


def white_and_black(scene: Scene):
    scene.pattern = {"kind": "white"}
    white = scene.frame()
    scene.pattern = {"kind": "black"}
    return white, scene.frame()


def test_measures_how_much_of_the_frame_the_projection_spans_and_outlines_it():
    # The synthetic projection's corners: (40,30) (290,45) (280,215) (35,200) in a 320x240 frame.
    f = measure_framing(*white_and_black(Scene(box=False)))
    assert abs(f.span - 255 / 320) < 0.03  # the wider of its width and height shares
    assert not f.cut_off
    xs, ys = zip(*f.outline)
    assert abs(min(xs) - 35 / 320) < 0.02 and abs(max(xs) - 290 / 320) < 0.02
    assert abs(min(ys) - 30 / 240) < 0.02 and abs(max(ys) - 215 / 240) < 0.02


def test_says_when_part_of_the_projection_is_outside_the_frame():
    white, black = white_and_black(Scene(box=False))
    f = measure_framing(white[60:, 60:], black[60:, 60:])  # camera turned: the top left falls off
    assert f.cut_off


def test_a_small_projection_spans_little_of_the_frame():
    white, black = white_and_black(Scene(box=False))
    pad = lambda img: np.pad(img, ((240, 240), (320, 320)) + ((0, 0),) * (img.ndim - 2))  # noqa: E731
    f = measure_framing(pad(white), pad(black))  # the same projection from three times as far
    assert abs(f.span - 255 / 960) < 0.02 and not f.cut_off


def test_the_editor_can_ask_how_the_projection_is_framed(tmp_path):
    import threading

    from engine.camera_device import FakeCameraFactory
    from engine.hardware import FakeHardware
    from tests.helpers import LAPTOP, RIG_CAMERAS, engine, output, play_output

    scene = Scene(proj_w=256, proj_h=144, box=False)
    hw = FakeHardware(displays=[LAPTOP, {"name": "AML TV", "width": 256, "height": 144, "main": False}],
                      cameras=RIG_CAMERAS)
    from engine.camera_lock import FakeUvc
    from tests.test_calibrate import DEFAULTS

    uvc = FakeUvc(DEFAULTS)
    with engine(hw, data_dir=tmp_path, camera_factory=FakeCameraFactory(frame=scene.frame),
                uvc_factory=lambda address: uvc) as client, \
            output(client, 256, 144) as out:
        result = {}
        t = threading.Thread(target=lambda: result.update(r=client.post("/api/camera/framing")))
        t.start()
        shown = play_output(out, scene)  # white, then black; the projector goes back to black after
        t.join(10)
    assert [p["kind"] for p in shown] == ["white", "black"]
    body = result["r"].json()
    assert abs(body["span"] - 255 / 320) < 0.03 and body["cut_off"] is False
    assert body["advice"] is None  # 80%: framed well enough
    assert uvc.values == DEFAULTS  # taken over like a scan, given back after


def test_a_camera_that_doesnt_see_the_projection_is_told_to_point_at_it():
    scene = Scene(box=False)
    scene.pattern = {"kind": "black"}
    black = scene.frame()
    f = measure_framing(black, black)  # nothing got brighter
    assert f.advice() == "The camera doesn't see the projection: point it at the lit area."
