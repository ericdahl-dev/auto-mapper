"""Tracks connected editors and the output window, and pushes status to editors."""

from fastapi import WebSocket

from engine.hardware import HardwareSnapshot


class Hub:
    def __init__(self, hardware: HardwareSnapshot):
        self.hardware = hardware
        self.editors: set[WebSocket] = set()
        self.output: WebSocket | None = None
        self.output_resolution: dict | None = None

    def status(self) -> dict:
        return {
            "type": "status",
            "hardware": self.hardware.to_dict(),
            "output_connected": self.output is not None,
            "output_resolution": self.output_resolution,
            "can_scan": self._output_fills_projector() and not self.hardware.issues,
        }

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
