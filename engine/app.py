import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Callable

import cv2
from fastapi import FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from engine.camera_device import CameraFactory, CameraSession, OpenCVCameraFactory
from engine.calibrate import CalibrationError, calibrate_exposure
from engine.camera_lock import Uvc, UvcUtil, locked_camera, recover_camera
from engine.cameras import CameraSettings, UsbAddress, usb_address
from engine.hardware import HardwareProbe, MacHardware
from engine.hub import Hub
from engine.messages import CameraSelectRequest, EditorHello, Hello, OutputHello, TestFrameRequest


DEFAULT_DATA_DIR = Path.home() / ".auto-mapper"


def create_app(
    hardware: HardwareProbe | None = None,
    data_dir: Path | None = None,
    camera_factory: CameraFactory | None = None,
    uvc_factory: Callable[[UsbAddress], Uvc] | None = None,
    settle_seconds: float = 0.5,
) -> FastAPI:
    probe = hardware or MacHardware()
    settings = CameraSettings(data_dir or DEFAULT_DATA_DIR)
    session = CameraSession(camera_factory or OpenCVCameraFactory())
    make_uvc = uvc_factory or (lambda address: UvcUtil(address.location))
    data_path = Path(data_dir or DEFAULT_DATA_DIR)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.hub = Hub(await asyncio.to_thread(probe.probe), settings)
        # A scan killed mid-way leaves the webcam locked; put its settings back.
        # Assumes the selected camera is the one that was locked.
        selected = settings.selected(app.state.hub.hardware.cameras)
        address = usb_address(selected) if selected else None
        if address is not None:
            await asyncio.to_thread(recover_camera, make_uvc(address), data_path)
        try:
            yield
        finally:
            session.close()

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

    @app.post("/api/camera")
    async def select_camera(req: CameraSelectRequest):
        hub: Hub = app.state.hub
        if not any(c["unique_id"] == req.unique_id for c in hub.hardware.cameras):
            raise HTTPException(404, "Unknown camera")
        settings.select(req.unique_id)
        await hub.broadcast_status()
        return hub.status()

    @app.get("/api/camera/preview.jpg")
    async def camera_preview():
        hub: Hub = app.state.hub
        selected = settings.selected(hub.hardware.cameras)
        if selected is None:
            raise HTTPException(409, "No camera selected")
        frame = await asyncio.to_thread(session.read, hub.hardware.cameras, selected)
        ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return Response(jpg.tobytes(), media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.post("/api/camera/release")
    async def release_camera():
        await asyncio.to_thread(session.close)
        return {"ok": True}

    @app.post("/api/camera/calibrate")
    async def calibrate():
        hub: Hub = app.state.hub
        cameras = hub.hardware.cameras
        selected = settings.selected(cameras)
        address = usb_address(selected) if selected else None
        if address is None:
            raise HTTPException(409, "Calibration needs a USB webcam with UVC controls")
        if not await hub.send_to_output({"type": "show_test_frame", "kind": "white"}):
            raise HTTPException(409, "Output window is not connected")
        await asyncio.sleep(settle_seconds)

        def run() -> dict:
            uvc = make_uvc(address)
            with locked_camera(uvc, data_path):
                return calibrate_exposure(uvc, lambda: session.read(cameras, selected))

        try:
            result = await asyncio.to_thread(run)
        except CalibrationError as e:
            raise HTTPException(422, str(e))
        settings.save_calibration(selected, result)
        await hub.broadcast_status()
        return result

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
