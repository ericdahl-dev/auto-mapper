import pytest

from engine.camera_device import FakeCameraFactory
from engine.camera_lock import FakeUvc
from engine.hardware import FakeHardware
from tests.helpers import FACETIME, LAPTOP, PROJECTOR, RIG_CAMERAS, engine, output

DEFAULTS = {
    "auto-exposure-mode": "8", "exposure-time-abs": "160", "gain": "0",
    "auto-white-balance-temp": "true", "white-balance-temp": "6500",
    "auto-focus": "true", "focus-abs": "395",
}


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=RIG_CAMERAS)


def camera_responding_to(uvc, brightness_per_exposure):
    """Fake camera whose white-frame brightness follows the UVC exposure setting."""
    return FakeCameraFactory(brightness=lambda: min(255, int(uvc.values["exposure-time-abs"]) * brightness_per_exposure))


def test_calibrate_picks_brightest_unclipped_exposure_and_restores_camera(rig, tmp_path):
    uvc = FakeUvc(DEFAULTS)
    with engine(rig, data_dir=tmp_path, camera_factory=camera_responding_to(uvc, 2),
                uvc_factory=lambda address: uvc) as client, output(client) as out:
        resp = client.post("/api/camera/calibrate")
        shown = out.receive_json()

        assert resp.status_code == 200, resp.text
        assert shown == {"type": "show_test_frame", "kind": "white"}
        # 2 levels per exposure step: 124 -> 248 is the last value below clipping (250).
        assert resp.json()["exposure"] == 124
        assert uvc.values == DEFAULTS
        assert client.get("/api/status").json()["camera"]["calibration"]["exposure"] == 124


def test_calibrate_fails_loudly_when_brightness_ignores_exposure(rig, tmp_path):
    uvc = FakeUvc(DEFAULTS)
    with engine(rig, data_dir=tmp_path, camera_factory=FakeCameraFactory(brightness=lambda: 128),
                uvc_factory=lambda address: uvc) as client, output(client):
        resp = client.post("/api/camera/calibrate")

    assert resp.status_code == 422
    assert "did not respond to exposure" in resp.json()["detail"]
    assert uvc.values == DEFAULTS


def test_calibrate_needs_the_output_window(rig, tmp_path):
    uvc = FakeUvc(DEFAULTS)
    with engine(rig, data_dir=tmp_path, uvc_factory=lambda address: uvc) as client:
        resp = client.post("/api/camera/calibrate")

    assert resp.status_code == 409
    assert uvc.writes == []


def test_calibrate_needs_a_usb_webcam(rig, tmp_path):
    with engine(rig, data_dir=tmp_path, uvc_factory=lambda address: FakeUvc(DEFAULTS)) as client, output(client):
        client.post("/api/camera", json={"unique_id": FACETIME["unique_id"]})
        resp = client.post("/api/camera/calibrate")

    assert resp.status_code == 409
    assert "USB" in resp.json()["detail"]


def test_engine_start_restores_camera_left_locked_by_a_crash(rig, tmp_path):
    from engine.camera_lock import locked_camera

    uvc = FakeUvc(DEFAULTS)
    lock = locked_camera(uvc, tmp_path)
    lock.__enter__()  # killed mid-scan; keep a reference so GC does not run its finally
    assert uvc.values["auto-exposure-mode"] == "1"

    with engine(rig, data_dir=tmp_path, uvc_factory=lambda address: uvc):
        assert uvc.values == DEFAULTS


def test_dim_surface_raises_gain_once_exposure_is_maxed(rig, tmp_path):
    """A dark surface: even the longest exposure leaves the white frame dim, so use gain."""
    uvc = FakeUvc(DEFAULTS, limits={"exposure-time-abs": (1, 1000)})  # a camera that stops at 100 ms

    def brightness():
        # Dim even at the longest exposure: 1000 x 0.12 = 120.
        level = int(uvc.values["exposure-time-abs"]) * 0.12 * (1 + int(uvc.values["gain"]) * 0.25)
        return min(255, int(level))

    with engine(rig, data_dir=tmp_path, camera_factory=FakeCameraFactory(brightness=brightness),
                uvc_factory=lambda address: uvc) as client, output(client):
        result = client.post("/api/camera/calibrate").json()

    assert result["exposure"] == result["max_exposure"]  # all the exposure the camera allows first...
    assert result["gain"] > 0  # ...then gain
    assert result["p99"] >= 150  # bright enough to separate lit from unlit
    assert result["p99"] < 250  # but still not clipped
    assert uvc.values == DEFAULTS


def test_longer_exposure_is_used_before_any_gain(rig, tmp_path):
    """Long exposure brightens without the noise gain adds (measured on the rig: 100 ms at
    gain 0 matched 33 ms at gain 15)."""
    uvc = FakeUvc(DEFAULTS)

    def brightness():
        level = int(uvc.values["exposure-time-abs"]) * 0.3 * (1 + int(uvc.values["gain"]) * 0.25)
        return min(255, int(level))

    with engine(rig, data_dir=tmp_path, camera_factory=FakeCameraFactory(brightness=brightness),
                uvc_factory=lambda address: uvc) as client, output(client):
        result = client.post("/api/camera/calibrate").json()

    assert result["gain"] == 0
    assert 800 <= result["exposure"] <= 840  # clips at ~833 (0.3 x 833 = 250)


def test_a_dim_room_uses_longer_exposures_the_camera_allows_before_gain(rig, tmp_path):
    """More light from exposure (no added noise) where the camera allows it: the AC410 had been
    capped at 100 ms and turned to gain in a dim room."""
    uvc = FakeUvc(DEFAULTS, limits={"exposure-time-abs": (1, 3000)})

    def brightness():
        level = int(uvc.values["exposure-time-abs"]) * 0.12 * (1 + int(uvc.values["gain"]) * 0.25)
        return min(255, int(level))

    with engine(rig, data_dir=tmp_path, camera_factory=FakeCameraFactory(brightness=brightness),
                uvc_factory=lambda address: uvc) as client, output(client):
        result = client.post("/api/camera/calibrate").json()

    assert result["gain"] == 0
    assert 1000 < result["exposure"] <= 2083  # 0.12 x 2083 = 250: just under clipping, past the old 1000 cap
    assert result["max_exposure"] == 3000  # remembered: HDR uses it too
    assert uvc.values == DEFAULTS


def test_a_camera_that_refuses_long_exposures_keeps_the_100_ms_limit(rig, tmp_path):
    uvc = FakeUvc(DEFAULTS, limits={"exposure-time-abs": (1, 1000)})

    def brightness():
        level = int(uvc.values["exposure-time-abs"]) * 0.12 * (1 + int(uvc.values["gain"]) * 0.25)
        return min(255, int(level))

    with engine(rig, data_dir=tmp_path, camera_factory=FakeCameraFactory(brightness=brightness),
                uvc_factory=lambda address: uvc) as client, output(client):
        result = client.post("/api/camera/calibrate").json()

    assert result["exposure"] == 1000 and result["gain"] > 0 and result["max_exposure"] == 1000


def test_calibration_says_when_the_camera_is_at_its_light_limit():
    """The engine decides "at its light limit" (longest exposure and most gain, still too dim), so the
    editor doesn't keep its own copy of each camera's limits (#142)."""
    import numpy as np

    from engine.calibrate import calibrate_exposure

    def run(per_exposure):
        uvc = FakeUvc(DEFAULTS, limits={"exposure-time-abs": (1, 1000)})

        def read():
            level = int(uvc.values["exposure-time-abs"]) * per_exposure * (1 + int(uvc.values["gain"]) * 0.05)
            return np.full((4, 4), min(255, int(level)), np.uint8)

        return calibrate_exposure(uvc, read)

    assert run(0.05)["at_light_limit"] is True  # 50 at 100 ms, ~87 with all the gain: too dim
    assert run(0.12)["at_light_limit"] is False  # reaches the target with some gain
    assert run(1.0)["at_light_limit"] is False  # bright: a shorter exposure, no gain
