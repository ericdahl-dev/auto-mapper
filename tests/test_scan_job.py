"""#72: the scan job runs scans (one at a time, cancelable) without HTTP or WebSockets."""

import asyncio

import pytest

from engine.camera_device import CameraSession, FakeCameraFactory
from engine.camera_lock import FakeUvc
from engine.cameras import CameraSettings
from engine.hub import OutputNotResponding
from engine.scan_folder import ScanFolder
from engine.scan_camera import ScanCameras
from engine.scan_job import ScanBusy, ScanJob, ScanNotRunning
from engine.show import CurrentShow
from tests.helpers import AC410
from tests.synthetic import Scene

W, H = 256, 144
DEFAULTS = {
    "auto-exposure-mode": "8", "exposure-time-abs": "160", "gain": "0",
    "auto-white-balance-temp": "true", "white-balance-temp": "6500",
    "auto-focus": "true", "focus-abs": "395",
}


class FakeHub:
    """Plays the output window and the editors: draws each pattern onto the synthetic scene."""

    def __init__(self, scene: Scene, fail_after: int | None = None):
        self.scene, self.fail_after = scene, fail_after
        self.output_resolution = {"width": W, "height": H}
        self.sent: list[dict] = []  # broadcasts to editors
        self.to_output: list[dict] = []
        self.patterns = 0
        self.on_pattern = None  # hook: called after each pattern is shown

    async def show_pattern(self, pattern: dict, timeout: float) -> None:
        if self.fail_after is not None and self.patterns >= self.fail_after:
            raise OutputNotResponding("The output window stopped responding.")
        self.scene.pattern = pattern
        self.patterns += 1
        if self.on_pattern:
            self.on_pattern()

    async def broadcast(self, msg: dict) -> None:
        self.sent.append(msg)

    async def send_to_output(self, msg: dict) -> None:
        self.to_output.append(msg)

    async def broadcast_show(self) -> None:
        self.sent.append({"type": "show"})

    async def broadcast_status(self) -> None:
        self.sent.append({"type": "status"})

    def types(self) -> list[str]:
        return [m["type"] for m in self.sent]


@pytest.fixture
def rig(tmp_path):
    scene = Scene(proj_w=W, proj_h=H)
    uvc = FakeUvc(DEFAULTS)

    def frame():
        scene.exposure_gain = int(uvc.values["exposure-time-abs"]) / 200
        return scene.frame()

    latest = ScanFolder(tmp_path / "scans" / "latest")
    show = CurrentShow(latest)
    settings = CameraSettings(tmp_path)
    cameras = ScanCameras(
        session=CameraSession(FakeCameraFactory(frame=frame), (320, 240)),
        make_uvc=lambda address: uvc, make_still=lambda uid: None, settings=settings,
        data_dir=tmp_path, drop_frames=0, frames_per_pattern=1,
    )
    job = ScanJob(cameras=cameras, settings=settings, latest=latest, show=show, settle_seconds=0, ack_timeout=1)
    return scene, job, latest, show


def start(job, hub):
    job.start(hub, [AC410], AC410["unique_id"])


async def run(job, hub):
    start(job, hub)
    await job.wait()


def test_a_scan_saves_the_scan_updates_the_show_and_reports_each_step(rig):
    scene, job, latest, show = rig
    hub = FakeHub(scene)
    asyncio.run(run(job, hub))

    types = hub.types()
    assert types[0] == "scan_started" and "scan_progress" in types
    result = next(m for m in hub.sent if m["type"] == "scan_result")
    assert result["coverage"] > 0.5 and len(result["surfaces"]) >= 2 and result["image"].startswith("/api/scan/latest.png")
    assert latest.has_scan() and latest.meta()["surfaces"] == result["surfaces"]
    assert len(show.data["surfaces"]) == len(result["surfaces"])  # detection applied to the show
    assert hub.to_output[-1] == {"type": "show_test_frame", "kind": "black"}  # projector blanked after
    assert types[-2:] == ["show", "status"]  # back to the projected show, status refreshed
    assert not job.busy


def test_only_one_scan_at_a_time_and_nothing_else_holds_the_scan_meanwhile(rig):
    scene, job, latest, show = rig

    async def go():
        hub = FakeHub(scene)
        start(job, hub)
        assert job.busy
        with pytest.raises(ScanBusy):
            start(job, hub)
        with pytest.raises(ScanBusy):
            async with job.exclusive():  # e.g. redetect or opening a project
                pass
        await job.wait()
        async with job.exclusive():  # free again
            assert job.busy
        assert not job.busy

    asyncio.run(go())


def test_a_scan_can_be_canceled_and_leaves_the_saved_scan_alone(rig):
    scene, job, latest, show = rig
    hub = FakeHub(scene)
    hub.on_pattern = lambda: job.cancel() if hub.patterns == 5 else None
    asyncio.run(run(job, hub))
    assert "scan_canceled" in hub.types() and "scan_result" not in hub.types()
    assert not latest.has_scan()
    with pytest.raises(ScanNotRunning):
        job.cancel()


def test_a_failing_output_window_fails_the_scan_with_its_message_and_still_cleans_up(rig):
    scene, job, latest, show = rig
    hub = FakeHub(scene, fail_after=3)
    asyncio.run(run(job, hub))
    failed = next(m for m in hub.sent if m["type"] == "scan_failed")
    assert "stopped responding" in failed["error"]
    assert hub.to_output[-1] == {"type": "show_test_frame", "kind": "black"}
    assert not job.busy


def test_a_scan_uses_the_settings_it_started_with(rig):
    """Settings changed while a scan runs apply to the next one (#144): here a mask drawn mid-scan
    that would leave only a corner of the image."""
    scene, job, latest, show = rig
    hub = FakeHub(scene)
    corner = [[[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]]]
    hub.on_pattern = lambda: job.settings.save_scan_settings(AC410["unique_id"], {"mask": corner})
    asyncio.run(run(job, hub))
    result = next(m for m in hub.sent if m["type"] == "scan_result")
    assert result["coverage"] > 0.5
