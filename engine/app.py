import asyncio
import json
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import ValidationError

from engine.camera_device import CameraFactory, CameraSession, OpenCVCameraFactory
from engine.calibrate import CalibrationError, calibrate_exposure
from engine.camera_lock import Uvc, UvcUtil, locked_camera, recover_camera
from engine.cameras import CameraSettings, UsbAddress, usb_address
from engine.hardware import HardwareProbe, MacHardware
from engine.hub import Hub, OutputNotResponding
from engine.scan import block_coverage, projector_space_image
from engine.scan_runner import ScanError, capture_scan
from engine.messages import CameraSelectRequest, EditorHello, Hello, OutputHello, TestFrameRequest


DEFAULT_DATA_DIR = Path.home() / ".auto-mapper"


def create_app(
    hardware: HardwareProbe | None = None,
    data_dir: Path | None = None,
    camera_factory: CameraFactory | None = None,
    uvc_factory: Callable[[UsbAddress], Uvc] | None = None,
    settle_seconds: float = 0.5,
    scan_settle_seconds: float = 0.12,
    scan_drop_frames: int = 2,
    ack_timeout: float = 2.0,
) -> FastAPI:
    probe = hardware or MacHardware()
    settings = CameraSettings(data_dir or DEFAULT_DATA_DIR)
    session = CameraSession(camera_factory or OpenCVCameraFactory())
    make_uvc = uvc_factory or (lambda address: UvcUtil(address.location))
    data_path = Path(data_dir or DEFAULT_DATA_DIR)
    scan_dir = data_path / "scans" / "latest"
    scanning = asyncio.Lock()

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
        if scanning.locked():
            raise HTTPException(409, "Camera is busy scanning")
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

    @app.post("/api/scan", status_code=202)
    async def start_scan():
        hub: Hub = app.state.hub
        if not hub.status()["can_scan"]:
            raise HTTPException(409, "Rig is not ready to scan")
        selected = settings.selected(hub.hardware.cameras)
        address = usb_address(selected)
        if address is None:
            raise HTTPException(409, "Scanning needs a USB webcam with UVC controls")
        if scanning.locked():
            raise HTTPException(409, "A scan is already running")
        app.state.scan_task = asyncio.create_task(run_scan(hub, selected, address))
        return {"started": True}

    async def run_scan(hub: Hub, selected: str, address: UsbAddress) -> None:
        async with scanning:
            loop = asyncio.get_running_loop()
            cameras = hub.hardware.cameras
            res = hub.output_resolution
            await hub.broadcast({"type": "scan_started"})

            def call(coro):  # run an engine coroutine from the capture thread and wait for it
                return asyncio.run_coroutine_threadsafe(coro, loop).result()

            def capture():
                return capture_scan(
                    show=lambda p: call(hub.show_pattern(p, ack_timeout)),
                    read_frame=lambda: session.read(cameras, selected),
                    uvc=make_uvc(address),
                    data_dir=data_path,
                    width=res["width"],
                    height=res["height"],
                    calibration=settings.calibration(selected),
                    progress=lambda done, total: call(
                        hub.broadcast({"type": "scan_progress", "done": done, "total": total})
                    ),
                    settle_seconds=scan_settle_seconds,
                    drop_frames=scan_drop_frames,
                )

            try:
                started = time.monotonic()
                decoded, calibration = await asyncio.to_thread(capture)
                settings.save_calibration(selected, calibration)
                image, covered = await asyncio.to_thread(projector_space_image, decoded)
                coverage = block_coverage(covered)
                await asyncio.to_thread(save_scan, decoded, image, covered, coverage)
                await hub.broadcast({
                    "type": "scan_result",
                    "coverage": coverage,
                    "seconds": round(time.monotonic() - started, 1),
                    "bit_reliability": decoded.bit_reliability,
                    "image": f"/api/scan/latest.png?t={int(time.time() * 1000)}",
                })
            except (ScanError, CalibrationError, OutputNotResponding) as e:
                await hub.broadcast({"type": "scan_failed", "error": str(e)})
            except Exception as e:  # never leave the editor waiting on a dead scan
                await hub.broadcast({"type": "scan_failed", "error": f"Scan crashed: {e}"})
                raise
            finally:
                await asyncio.to_thread(session.close)
                await hub.send_to_output({"type": "show_test_frame", "kind": "black"})
                await hub.broadcast_status()

    def save_scan(decoded, image, covered, coverage) -> None:
        scan_dir.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(scan_dir / "scan.png"), image)
        np.savez_compressed(
            scan_dir / "map.npz", proj_x=decoded.proj_x.astype(np.int16), proj_y=decoded.proj_y.astype(np.int16),
            valid=decoded.valid, covered=covered,
        )
        (scan_dir / "meta.json").write_text(json.dumps({
            "width": decoded.width, "height": decoded.height, "coverage": coverage,
            "bit_reliability": decoded.bit_reliability,
        }, indent=2))

    @app.get("/api/scan/latest.png")
    async def latest_scan_image():
        path = scan_dir / "scan.png"
        if not path.exists():
            raise HTTPException(404, "No scan yet")
        return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})

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
                if ws is hub.output and msg.get("type") == "pattern_shown":
                    hub.pattern_shown(int(msg.get("seq", -1)))
                elif ws is hub.output and msg.get("type") == "hello":
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
