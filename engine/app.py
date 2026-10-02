import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from engine.hardware import HardwareProbe, MacHardware
from engine.hub import Hub
from engine.messages import EditorHello, Hello, OutputHello, TestFrameRequest


def create_app(hardware: HardwareProbe | None = None) -> FastAPI:
    probe = hardware or MacHardware()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.hub = Hub(await asyncio.to_thread(probe.probe))
        yield

    app = FastAPI(title="auto-mapper engine", lifespan=lifespan)

    @app.get("/api/status")
    async def status():
        return app.state.hub.status()

    @app.post("/api/hardware/refresh")
    async def refresh_hardware():
        hub: Hub = app.state.hub
        hub.hardware = await asyncio.to_thread(probe.probe)
        await hub.broadcast_status()
        return hub.status()

    @app.post("/api/test-frame")
    async def test_frame(req: TestFrameRequest):
        sent = await app.state.hub.send_to_output({"type": "show_test_frame", "kind": req.kind})
        if not sent:
            raise HTTPException(409, "Output window is not connected")
        return {"ok": True}

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        hub: Hub = app.state.hub
        await ws.accept()
        try:
            hello = Hello.validate_python(await ws.receive_json())
        except (ValidationError, ValueError):
            await ws.close(code=1008, reason="expected hello")
            return
        if isinstance(hello, EditorHello):
            await hub.add_editor(ws)
        else:
            await hub.set_output(ws, hello.width, hello.height)
        try:
            while True:
                msg = await ws.receive_json()
                if ws is hub.output and msg.get("type") == "hello":
                    # The output window re-sends hello when resized (e.g. going fullscreen).
                    try:
                        again = OutputHello.model_validate(msg)
                    except ValidationError:
                        continue
                    await hub.set_output(ws, again.width, again.height)
        except WebSocketDisconnect:
            pass
        finally:
            await hub.remove(ws)

    return app
