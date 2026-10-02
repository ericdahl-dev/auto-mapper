import cv2
import numpy as np
import pytest

from engine.camera_device import FakeCameraFactory
from engine.hardware import FakeHardware
from tests.helpers import FACETIME, LAPTOP, PROJECTOR, RIG_CAMERAS, editor, engine, output


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=RIG_CAMERAS)


def test_selected_camera_defaults_to_usb_webcam_not_builtin_or_virtual(rig, tmp_path):
    with engine(rig, data_dir=tmp_path) as client:
        status = client.get("/api/status").json()

    assert status["camera"]["selected"] == "0x2110000f1311306"


def test_no_usb_webcam_means_no_default_camera(tmp_path):
    hw = FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[FACETIME])
    with engine(hw, data_dir=tmp_path) as client:
        status = client.get("/api/status").json()

    assert status["camera"]["selected"] is None


def test_selecting_a_camera_is_pushed_and_remembered(rig, tmp_path):
    with engine(rig, data_dir=tmp_path) as client, editor(client) as ed:
        ed.receive_json()

        resp = client.post("/api/camera", json={"unique_id": FACETIME["unique_id"]})

        assert resp.status_code == 200
        assert ed.receive_json()["camera"]["selected"] == FACETIME["unique_id"]

    with engine(rig, data_dir=tmp_path) as client:
        assert client.get("/api/status").json()["camera"]["selected"] == FACETIME["unique_id"]


def test_selecting_an_unknown_camera_is_rejected(rig, tmp_path):
    with engine(rig, data_dir=tmp_path) as client:
        resp = client.post("/api/camera", json={"unique_id": "nope"})

    assert resp.status_code == 404


def test_preview_opens_only_the_selected_camera(rig, tmp_path):
    cams = FakeCameraFactory(width=640, height=360)
    with engine(rig, data_dir=tmp_path, camera_factory=cams) as client:
        resp = client.get("/api/camera/preview.jpg")

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    frame = cv2.imdecode(np.frombuffer(resp.content, np.uint8), cv2.IMREAD_COLOR)
    assert frame.shape == (360, 640, 3)
    assert cams.opened == [0]  # AC410 is first when sorted by uniqueID


def test_switching_camera_closes_the_previous_one(rig, tmp_path):
    cams = FakeCameraFactory()
    with engine(rig, data_dir=tmp_path, camera_factory=cams) as client:
        client.get("/api/camera/preview.jpg")
        client.post("/api/camera", json={"unique_id": FACETIME["unique_id"]})
        client.get("/api/camera/preview.jpg")

        assert cams.opened == [0, 2]
        assert cams.open_now == [2]

    assert cams.open_now == []  # released on shutdown


def test_preview_without_a_camera_is_unavailable(tmp_path):
    hw = FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[])
    with engine(hw, data_dir=tmp_path, camera_factory=FakeCameraFactory()) as client:
        resp = client.get("/api/camera/preview.jpg")

    assert resp.status_code == 409


def test_releasing_the_camera_closes_it(rig, tmp_path):
    cams = FakeCameraFactory()
    with engine(rig, data_dir=tmp_path, camera_factory=cams) as client:
        client.get("/api/camera/preview.jpg")
        resp = client.post("/api/camera/release")

        assert resp.status_code == 200
        assert cams.open_now == []


def test_scan_needs_a_selected_camera(tmp_path):
    hw = FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[FACETIME])
    with engine(hw, data_dir=tmp_path) as client, output(client):
        assert client.get("/api/status").json()["can_scan"] is False

        client.post("/api/camera", json={"unique_id": FACETIME["unique_id"]})

        assert client.get("/api/status").json()["can_scan"] is True


def test_camera_is_opened_at_full_4k_resolution(rig, tmp_path):
    cams = FakeCameraFactory()
    with engine(rig, data_dir=tmp_path, camera_factory=cams) as client:
        client.get("/api/camera/preview.jpg")

    assert cams.requested_sizes == [(3840, 2160)]


def test_preview_is_downscaled_so_4k_frames_stay_snappy(rig, tmp_path):
    cams = FakeCameraFactory(width=3840, height=2160)
    with engine(rig, data_dir=tmp_path, camera_factory=cams) as client:
        resp = client.get("/api/camera/preview.jpg")

    frame = cv2.imdecode(np.frombuffer(resp.content, np.uint8), cv2.IMREAD_COLOR)
    assert frame.shape == (720, 1280, 3)


def test_capture_size_can_be_overridden(rig, tmp_path):
    cams = FakeCameraFactory()
    with engine(rig, data_dir=tmp_path, camera_factory=cams, capture_size=(1920, 1080)) as client:
        client.get("/api/camera/preview.jpg")

    assert cams.requested_sizes == [(1920, 1080)]
