"""#66: which camera settings an HDR scan captures, relative to the calibrated one."""

from engine.scan_runner import hdr_captures


def cal(exposure, gain=0):
    return {"exposure": exposure, "gain": gain}


def test_off_is_just_the_calibrated_setting():
    assert hdr_captures(cal(200), 1) == [(200, 0)]


def test_hdr_adds_longer_exposures_for_dark_surfaces():
    assert hdr_captures(cal(100), 2) == [(100, 0), (400, 0)]
    assert hdr_captures(cal(100), 3) == [(100, 0), (300, 0), (900, 0)]


def test_past_the_longest_exposure_it_brightens_with_gain():
    # A dim room calibrates at the longest exposure: extra captures raise gain instead (15 ~ x3).
    assert hdr_captures(cal(1000), 2) == [(1000, 0), (1000, 15)]
    assert hdr_captures(cal(1000), 3) == [(1000, 0), (1000, 15)]  # capped, never repeated
    assert hdr_captures(cal(400), 3) == [(400, 0), (1000, 2), (1000, 15)]


def test_gain_already_in_use_is_kept_and_capped():
    assert hdr_captures(cal(1000, 10), 2) == [(1000, 10), (1000, 15)]
    assert hdr_captures(cal(1000, 15), 2) == [(1000, 15)]


def test_hdr_uses_the_longest_exposure_this_camera_allows():
    assert hdr_captures({"exposure": 1000, "gain": 0, "max_exposure": 3000}, 2) == [(1000, 0), (3000, 4)]
