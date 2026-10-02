"""Tracks connected editors and the output window, and pushes status to editors."""

import asyncio
import itertools

from fastapi import WebSocket

from engine.cameras import CameraSettings
from engine.hardware import HardwareSnapshot
from engine.scene import SceneStore


class OutputNotResponding(Exception):
    pass


NOT_RESPONDING = (
    "The output window stopped responding. Keep it visible and fullscreen on the projector "
    "(a minimized or hidden window stops drawing), then scan again."
)
CLOSED = "The output window closed during the scan. Reopen it fullscreen on the projector and scan again."
NOT_CONNECTED = "The output window is not connected. Open it fullscreen on the projector and scan again."


class Hub:
    def __init__(self, hardware: HardwareSnapshot, settings: CameraSettings, scene: SceneStore):
        self.settings = settings
        self.hardware = hardware
        self.scene = scene
        self.projects = None  # set by the app; status reports the open project
        self.editors: set[WebSocket] = set()
        self.output: WebSocket | None = None
        self.output_resolution: dict | None = None
        self.output_fps: float | None = None
        self.output_sound: dict | None = None  # the output's sound meter: {"level", "error"}
        self.output_video_sound_blocked = False  # a video should be heard but waits for a click
        self._seq = itertools.count(1)
        self._acks: dict[int, asyncio.Future] = {}

    @property
    def hardware(self) -> HardwareSnapshot:
        return self._hardware

    @hardware.setter
    def hardware(self, snapshot: HardwareSnapshot) -> None:
        snapshot.chosen = self.settings.projector()  # every probe honors the saved choice
        self._hardware = snapshot

    def status(self) -> dict:
        return {
            "type": "status",
            "hardware": self.hardware.to_dict(),
            "output_connected": self.output is not None,
            "output_resolution": self.output_resolution,
            "output_fps": self.output_fps,
            "output_sound": self.output_sound,
            "output_video_sound_blocked": self.output_video_sound_blocked,
            "camera": self._camera_status(),
            "project": self.projects.active() if self.projects else None,
            "can_scan": self._output_fills_projector()
            and not self.hardware.issues
            and self.settings.selected(self.hardware.cameras) is not None,
        }

    def _camera_status(self) -> dict:
        selected = self.settings.selected(self.hardware.cameras)
        return {"selected": selected, "calibration": self.settings.calibration(selected)}

    def _output_fills_projector(self) -> bool:
        # Patterns are generated at projector resolution, so the output window must be
        # fullscreen on the projector or the scan decodes garbage.
        projector = self.hardware.projector
        return (
            self.output_resolution is not None
            and projector is not None
            and self.output_resolution == {"width": projector["width"], "height": projector["height"]}
        )

    async def add_editor(self, ws: WebSocket) -> None:
        self.editors.add(ws)
        await self._send(ws, self.status())
        if (scene := self.scene.message()) is not None:
            await self._send(ws, scene)

    async def set_output(self, ws: WebSocket, width: int, height: int) -> None:
        # A newer output window replaces the old one; only one owns the projector.
        first_hello = ws is not self.output
        self.output = ws
        self.output_resolution = {"width": width, "height": height}
        if first_hello and (scene := self.scene.message()) is not None:
            await self._send(ws, scene)  # a reconnecting output shows the scene straight away
        await self.broadcast_status()

    async def remove(self, ws: WebSocket) -> None:
        self.editors.discard(ws)
        if ws is self.output:
            self.output = None
            self.output_resolution = None
            self.output_fps = None
            self.output_sound = None
            self.output_video_sound_blocked = False
            # Don't make a scan wait out its timeout for a window that is gone.
            for fut in self._acks.values():
                if not fut.done():
                    fut.set_exception(OutputNotResponding(CLOSED))
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

    async def broadcast_scene(self) -> None:
        if (scene := self.scene.message()) is None:
            return
        await self.send_to_output(scene)
        await self.broadcast(scene)

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
            await ws.send_json(msg)
            return True
        except Exception:
            return False
