"""Tracks connected editors and the output window, and pushes status to editors."""

import asyncio
import itertools
import logging

from fastapi import WebSocket
from pydantic import ValidationError

from engine.cameras import CameraSettings
from engine.hardware import HardwareSnapshot
from engine.messages import EngineMessage, OutputStats
from engine.output_window import OutputWindow
from engine.show import CurrentShow
from engine.still_camera import FLAT_BATTERY, LOW_BATTERY


log = logging.getLogger(__name__)



def _battery_state(level: int | None) -> str | None:
    """'ok', 'low' (warn) or 'flat' (no scans); None before a still camera has reported one."""
    if level is None:
        return None
    return "flat" if level <= FLAT_BATTERY else "low" if level <= LOW_BATTERY else "ok"

class OutputNotResponding(Exception):
    pass


NOT_RESPONDING = (
    "The output window stopped responding. Keep it visible and fullscreen on the projector "
    "(a minimized or hidden window stops drawing), then scan again."
)
CLOSED = "The output window closed during the scan. Reopen it fullscreen on the projector and scan again."
NOT_CONNECTED = "The output window is not connected. Open it fullscreen on the projector and scan again."


class Hub:
    def __init__(self, hardware: HardwareSnapshot, settings: CameraSettings, show: CurrentShow):
        self.settings = settings
        self.hardware = hardware
        self.show = show
        self.projects = None  # set by the app; status reports the open project
        self.editors: set[WebSocket] = set()
        self.output_window = OutputWindow()  # what the engine knows of the output window
        self.still_battery: int | None = None  # a still camera's last battery reading, taken when it's used
        self._seq = itertools.count(1)
        self._acks: dict[int, asyncio.Future] = {}
        # Every change to the show is announced to editors and the output window from here.
        self._loop = asyncio.get_running_loop()
        self._show_queued = False
        show.subscribe(self._show_changed)

    @property
    def hardware(self) -> HardwareSnapshot:
        return self._hardware

    @hardware.setter
    def hardware(self, snapshot: HardwareSnapshot) -> None:
        self._hardware = snapshot
        self.apply_projector_choice()  # every probe honors the saved choice

    def apply_projector_choice(self) -> None:
        """Uses the projector saved in settings (after it's chosen, or a new probe)."""
        self._hardware.chosen = self.settings.projector()

    @property
    def output(self) -> WebSocket | None:
        return self.output_window.ws

    @property
    def output_resolution(self) -> dict | None:
        return self.output_window.resolution

    def status(self) -> dict:
        return {
            "type": "status",
            "hardware": self.hardware.to_dict(),
            **self.output_window.status(),
            "camera": self._camera_status(),
            "project": self.projects.active() if self.projects else None,
            "unsaved": self.projects.unsaved() if self.projects else False,
            "can_scan": self.scan_blocker() is None,
            "scan_blocker": self.scan_blocker(),
        }

    def scan_blocker(self) -> str | None:
        """Why a scan can't run now, in the editor's words; None when it can."""
        hw, out = self.hardware, self.output_resolution
        projector = hw.projector
        if "no_projector" in hw.issues or projector is None:
            return "No projector: connect it as an extended display"
        if "no_camera" in hw.issues:
            return "No camera: plug in the webcam"
        if out is None:
            return "Open the output window (Hardware) and make it fullscreen on the projector"
        if not self._output_fills_projector():
            size = f"{projector['width']}×{projector['height']}"
            return f"Output window must be {size}: make it fullscreen on the projector"
        if self.settings.selected(hw.cameras) is None:
            return "Choose the camera that scans (Hardware)"
        if self.still_battery is not None and self.still_battery <= FLAT_BATTERY:
            return f"The camera battery is at {self.still_battery}%: charge or swap it before scanning"
        return None

    def _camera_status(self) -> dict:
        selected = self.settings.selected(self.hardware.cameras)
        calibration = self.settings.calibration(selected)
        return {
            "selected": selected,
            "calibration": calibration,
            "at_light_limit": bool(calibration and calibration.get("at_light_limit")),
            "battery": self.still_battery,
            "battery_state": _battery_state(self.still_battery),
        }

    def _output_fills_projector(self) -> bool:
        return self.output_window.fills(self.hardware.projector)

    async def add_editor(self, ws: WebSocket) -> None:
        self.editors.add(ws)
        await self._send(ws, self.status())
        if (show := self.show.message()) is not None:
            await self._send(ws, show)

    async def set_output(self, ws: WebSocket, width: int, height: int) -> None:
        if self.output_window.hello(ws, width, height) and (show := self.show.message()) is not None:
            await self._send(ws, show)  # a reconnecting output shows the show straight away
        await self.broadcast_status()

    async def remove(self, ws: WebSocket) -> None:
        self.editors.discard(ws)
        if self.output_window.gone(ws):
            # Don't make a scan wait out its timeout for a window that is gone.
            for fut in self._acks.values():
                if not fut.done():
                    fut.set_exception(OutputNotResponding(CLOSED))
            await self.broadcast_status()

    async def output_stats(self, msg: OutputStats) -> None:
        self.output_window.stats(msg)
        await self.broadcast_status()

    async def send_to_output(self, msg: dict) -> bool:
        if self.output is None:
            return False
        return await self._send(self.output, msg)

    async def show_pattern(self, pattern: dict, timeout: float) -> None:
        """Shows a pattern on the output and waits until the output says it is on screen."""
        seq = next(self._seq)
        fut = asyncio.get_running_loop().create_future()
        self._acks[seq] = fut
        try:
            if not await self.send_to_output({"type": "show_pattern", "seq": seq, "pattern": pattern}):
                raise OutputNotResponding(NOT_CONNECTED)
            await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            raise OutputNotResponding(NOT_RESPONDING) from None
        finally:
            self._acks.pop(seq, None)

    def pattern_shown(self, seq: int) -> None:
        fut = self._acks.get(seq)
        if fut is not None and not fut.done():
            fut.set_result(None)

    def _show_changed(self) -> None:
        """The show changed (possibly on a worker thread): send it once, soon, on the event loop.
        Several changes in a row coalesce into one message."""
        if self._show_queued:
            return
        self._show_queued = True
        self._loop.call_soon_threadsafe(self._send_show_soon)

    def _send_show_soon(self) -> None:
        self._show_queued = False
        asyncio.ensure_future(self.broadcast_show())

    async def broadcast_show(self) -> None:
        if (show := self.show.message()) is None:
            show = {"type": "show_cleared"}  # e.g. a new project: drop the old show everywhere
        await self.send_to_output(show)
        await self.broadcast(show)
        await self.broadcast_status()  # "unsaved changes" follows every edit

    async def broadcast(self, msg: dict) -> None:
        for ws in list(self.editors):
            if not await self._send(ws, msg):
                self.editors.discard(ws)

    async def broadcast_status(self) -> None:
        msg = self.status()
        for ws in list(self.editors):
            if not await self._send(ws, msg):
                self.editors.discard(ws)

    async def _send(self, ws: WebSocket, msg: dict) -> bool:
        try:
            EngineMessage.validate_python(msg)
        except ValidationError as e:  # an engine bug; the contract test (test_message_contract) catches it
            log.error("engine message %r doesn't match its model: %s", msg.get("type"), e.errors()[:2])
        try:
            await ws.send_json(msg)
            return True
        except Exception:
            return False
