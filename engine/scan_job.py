"""Runs scans: one at a time, cancelable, reporting each step to the editors.

A scan: lock the camera and capture the patterns in lockstep with the output window (scan_runner),
decode them into the scan image, measure coverage, detect surfaces, save the scan folder, and update
the show. Other work that touches the working scan (redetecting, saving or opening a project) holds
the job with `exclusive()`, so it never overlaps a scan.
"""

import asyncio
import logging
import threading
import time
from contextlib import asynccontextmanager
from typing import Protocol

from engine.calibrate import CalibrationError
from engine.cameras import CameraSettings
from engine.hub import OutputNotResponding
from engine.scan import apply_camera_mask, block_coverage, diagnose, projector_space_image
from engine.scan_folder import ScanFolder
from engine.scan_runner import ScanCanceled, ScanError, capture_scan
from engine.scan_camera import NotScannable, ScanCameras
from engine.still_camera import CaptureFailed
from engine.show import CurrentShow
from engine.surfaces import detect_surfaces

log = logging.getLogger(__name__)


class ScanBusy(RuntimeError):
    pass


class ScanNotRunning(RuntimeError):
    pass


class ScanHub(Protocol):
    """What a scan needs from the hub: the output window, and the editors to report to."""

    output_resolution: dict | None

    async def show_pattern(self, pattern: dict, timeout: float) -> None: ...
    async def send_to_output(self, msg: dict) -> None: ...
    async def broadcast(self, msg: dict) -> None: ...
    async def broadcast_show(self) -> None: ...
    async def broadcast_status(self) -> None: ...


def latest_image_url() -> str:
    """The scan image's URL, with a timestamp so browsers fetch the new one."""
    return f"/api/scan/latest.png?t={int(time.time() * 1000)}"


class ScanJob:
    def __init__(
        self,
        *,
        cameras: ScanCameras,
        settings: CameraSettings,
        latest: ScanFolder,
        show: CurrentShow,
        settle_seconds: float,
        ack_timeout: float,
    ):
        self.cameras, self.settings, self.latest, self.show = cameras, settings, latest, show
        self.settle_seconds, self.ack_timeout = settle_seconds, ack_timeout
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._cancel = threading.Event()  # read by the capture thread

    @property
    def busy(self) -> bool:
        """A scan is running, or other work holds the working scan."""
        return self._lock.locked() or (self._task is not None and not self._task.done())

    def start(self, hub: ScanHub, cameras: list[dict], selected: str) -> None:
        if self.busy:
            raise ScanBusy("A scan is already running")
        self._cancel.clear()
        # Claimed before the task starts, so a double click can't start two.
        self._task = asyncio.create_task(self._run(hub, cameras, selected))

    def cancel(self) -> None:
        if self._task is None or self._task.done():
            raise ScanNotRunning("No scan is running")
        self._cancel.set()

    async def wait(self) -> None:
        """Waits for the current scan to finish (for tests and shutdown)."""
        if self._task is not None:
            await self._task

    @asynccontextmanager
    async def exclusive(self):
        """Holds the working scan for other work; fails at once if a scan is running."""
        if self.busy:
            raise ScanBusy("A scan is running")
        async with self._lock:
            yield

    async def _run(self, hub: ScanHub, cameras: list[dict], selected: str) -> None:
        async with self._lock:
            loop = asyncio.get_running_loop()
            res = hub.output_resolution
            await hub.broadcast({"type": "scan_started"})

            def call(coro):  # run an engine coroutine from the capture thread and wait for it
                return asyncio.run_coroutine_threadsafe(coro, loop).result()

            scan_settings = self.settings.scan_settings(selected)  # read once: changes apply to the next scan

            def capture():
                show = lambda p: call(hub.show_pattern(p, self.ack_timeout))  # noqa: E731
                camera = self.cameras.open(cameras, selected, scan_settings)
                show({"kind": "white"})  # a still camera focuses on it as it's taken over
                with camera.taken_over():
                    return capture_scan(
                        show=show,
                        camera=camera,
                        width=res["width"],
                        height=res["height"],
                        calibration=self.settings.calibration(selected),
                        hdr=scan_settings.hdr,
                        progress=lambda done, total: call(
                            hub.broadcast({"type": "scan_progress", "done": done, "total": total})
                        ),
                        settle_seconds=self.settle_seconds,
                        canceled=self._cancel.is_set,
                    )

            try:
                started = time.monotonic()
                decoded, calibration = await asyncio.to_thread(capture)
                decoded = apply_camera_mask(decoded, scan_settings.mask)
                self.settings.save_calibration(selected, calibration)
                hole_fill = scan_settings.hole_fill
                image, covered = await asyncio.to_thread(projector_space_image, decoded, hole_fill)
                coverage = block_coverage(covered)
                surfaces = await asyncio.to_thread(detect_surfaces, decoded, (image, covered))
                summary = {
                    "width": decoded.width,
                    "height": decoded.height,
                    "coverage": coverage,
                    "seconds": round(time.monotonic() - started, 1),
                    "bit_reliability": decoded.bit_reliability,
                    "surfaces": surfaces,
                    "warnings": diagnose(decoded, coverage),
                }
                await asyncio.to_thread(self.latest.save, decoded, image, covered, summary)
                self.show.clear_history()  # a new scan: undo starts over (before the show is pushed)
                self.show.apply_detection(summary, undoable=False)  # keeps drawn/edited surfaces and effects
                await hub.broadcast({"type": "scan_result", **summary, "image": latest_image_url()})
            except ScanCanceled:
                await hub.broadcast({"type": "scan_canceled"})
            except (ScanError, CalibrationError, OutputNotResponding, CaptureFailed, NotScannable) as e:
                log.warning("scan failed: %s", e)
                await hub.broadcast({"type": "scan_failed", "error": str(e)})
            except Exception as e:  # never leave the editor waiting on a dead scan
                log.exception("scan crashed")
                await hub.broadcast({"type": "scan_failed", "error": f"Scan crashed: {e}"})
                raise
            finally:
                await asyncio.to_thread(self.cameras.release)
                await hub.send_to_output({"type": "show_test_frame", "kind": "black"})
                await hub.broadcast_show()  # back to the projected show
                await hub.broadcast_status()
