"""#66: which exposures an HDR scan captures, relative to the calibrated one."""

from engine.scan_runner import hdr_exposures


def test_off_is_just_the_calibrated_exposure():
    assert hdr_exposures(200, 1) == [200]


def test_hdr_adds_longer_exposures_for_dark_surfaces():
    # Calibration already keeps bright areas just under clipping, so the extra ones are longer.
    assert hdr_exposures(100, 2) == [100, 400]
    assert hdr_exposures(100, 3) == [100, 300, 900]


def test_longer_exposures_stop_at_the_camera_limit_and_never_repeat():
    assert hdr_exposures(400, 3) == [400, 1000]
    assert hdr_exposures(1000, 3) == [1000]  # already at the limit: a plain scan
