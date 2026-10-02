"""Tracks connected editors and the output window, and pushes status to editors."""

import asyncio
import itertools

from fastapi import WebSocket

from engine.cameras import CameraSettings
from engine.hardware import HardwareSnapshot


class OutputNotResponding(Exception):
    pass


class Hub:
    def __init__(self, hardware: HardwareSnapshot, settings: CameraSettings):
        self.hardware = hardware
        self.settings = settings
        self.editors: set[WebSocket] = set()
        self.output: WebSocket | None = None
        self.output_resolution: dict | None = None
        self._seq = itertools.count(1)
        self._acks: dict[int, asyncio.Future] = {}

    def status(self) -> dict:
        return {
            "type": "status",
            "hardware": self.hardware.to_dict(),
            "output_connected": self.output is not None,
            "output_resolution": self.output_resolution,
            "camera": self._camera_status(),
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

    async def set_output(self, ws: WebSocket, width: int, height: int) -> None:
        # A newer output window replaces the old one; only one owns the projector.
        self.output = ws
        self.output_resolution = {"width": width, "height": height}
        await self.broadcast_status()

    async def remove(self, ws: WebSocket) -> None:
        self.editors.discard(ws)
        if ws is self.output:
            self.output = None
            self.output_resolution = None
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
                raise OutputNotResponding("Output window is not connected")
            await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            raise OutputNotResponding("Output window did not confirm the pattern in time") from None
        finally:
            self._acks.pop(seq, None)

    def pattern_shown(self, seq: int) -> None:
        fut = self._acks.get(seq)
        if fut is not None and not fut.done():
            fut.set_result(None)

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
