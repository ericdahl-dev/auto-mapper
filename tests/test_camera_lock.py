import pytest

from engine.camera_lock import FakeUvc, locked_camera, recover_camera

AC410_DEFAULTS = {
    "auto-exposure-mode": "8", "exposure-time-abs": "160", "gain": "0",
    "auto-white-balance-temp": "true", "white-balance-temp": "6500",
    "auto-focus": "true", "focus-abs": "395",
}


def test_lock_turns_autos_off_before_manual_values_and_restore_reverses(tmp_path):
    uvc = FakeUvc(AC410_DEFAULTS)

    with locked_camera(uvc, tmp_path):
        assert uvc.values["auto-exposure-mode"] == "1"
        assert uvc.values["auto-white-balance-temp"] == "false"
        assert uvc.values["auto-focus"] == "false"
        uvc.set("exposure-time-abs", "40")  # e.g. calibration

    assert uvc.values == AC410_DEFAULTS
    names = [name for name, _ in uvc.writes]
    # Autos go off first on lock, and back on last on restore, so manual values stick.
    assert names[:3] == ["auto-exposure-mode", "auto-white-balance-temp", "auto-focus"]
    assert names[-3:] == ["auto-exposure-mode", "auto-white-balance-temp", "auto-focus"]


def test_restore_runs_even_when_the_scan_fails(tmp_path):
    uvc = FakeUvc(AC410_DEFAULTS)

    with pytest.raises(RuntimeError), locked_camera(uvc, tmp_path):
        uvc.set("exposure-time-abs", "40")
        raise RuntimeError("scan blew up")

    assert uvc.values == AC410_DEFAULTS


def test_settings_survive_an_engine_crash_mid_scan(tmp_path):
    uvc = FakeUvc(AC410_DEFAULTS)
    lock = locked_camera(uvc, tmp_path)
    lock.__enter__()  # engine killed here: the finally never runs
    uvc.set("exposure-time-abs", "40")

    restarted = FakeUvc(uvc.values)
    recovered = recover_camera(restarted, tmp_path)

    assert recovered is True
    assert restarted.values == AC410_DEFAULTS
    assert recover_camera(restarted, tmp_path) is False  # nothing left to recover
