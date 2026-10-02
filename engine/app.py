import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Callable

import cv2
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError

from engine.camera_device import CAPTURE_SIZE, CameraFactory, CameraSession, OpenCVCameraFactory
from engine.calibrate import CalibrationError, calibrate_exposure
from engine.camera_lock import Uvc, UvcUtil, locked_camera, recover_camera
from engine.cameras import CameraSettings, UsbAddress, usb_address
from engine.hardware import HardwareProbe, MacHardware
from engine.hub import Hub
from engine import media
from engine.scan_folder import ScanFolder
from engine.scan_job import ScanBusy, ScanJob, ScanNotRunning, latest_image_url
from engine.projects import ProjectStore, UnknownProject
from engine.scene import SceneStore, UnknownSurface
from engine.messages import (
    ApplyEffectRequest,
    CameraSelectRequest,
    ProjectorSelectRequest,
    EditorHello,
    Hello,
    MergeRequest,
    NewSurfaceRequest,
    OutputHello,
    PresentationRequest,
    SoundRequest,
    ProjectSaveRequest,
    SelectRequest,
    SurfaceUpdate,
    TestFrameRequest,
)


DEFAULT_DATA_DIR = Path.home() / ".auto-mapper"
log = logging.getLogger("auto-mapper")
PREVIEW_WIDTH = 1280


def create_app(
    hardware: HardwareProbe | None = None,
    data_dir: Path | None = None,
    camera_factory: CameraFactory | None = None,
    uvc_factory: Callable[[UsbAddress], Uvc] | None = None,
    settle_seconds: float = 0.5,
    # At 4K the AC410 delivers ~20 fps and buffers frames; less than this captured stale
    # patterns (coverage 0.61 vs 0.88 with these values, same scene).
    scan_settle_seconds: float = 0.2,
    scan_drop_frames: int = 5,
    scan_frames_per_pattern: int = 3,  # quality over speed: average out sensor noise
    ack_timeout: float = 2.0,
    capture_size: tuple[int, int] = CAPTURE_SIZE,
) -> FastAPI:
    probe = hardware or MacHardware()
    settings = CameraSettings(data_dir or DEFAULT_DATA_DIR)
    session = CameraSession(camera_factory or OpenCVCameraFactory(), capture_size)
    make_uvc = uvc_factory or (lambda address: UvcUtil(address.location))
    data_path = Path(data_dir or DEFAULT_DATA_DIR)
    latest = ScanFolder(data_path / "scans" / "latest")  # the working scan and its show
    scene = SceneStore(latest)
    projects = ProjectStore(data_path, latest, scene)
    job = ScanJob(  # one scan at a time; other work on the working scan holds it with job.exclusive()
        session=session, settings=settings, latest=latest, scene=scene, make_uvc=make_uvc, data_dir=data_path,
        settle_seconds=scan_settle_seconds, drop_frames=scan_drop_frames,
        frames_per_pattern=scan_frames_per_pattern, ack_timeout=ack_timeout,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.hub = Hub(await asyncio.to_thread(probe.probe), settings, scene)
        app.state.hub.projects = projects
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

    @app.exception_handler(ScanBusy)
    async def scan_busy(_request: Request, exc: ScanBusy):  # e.g. a scan started just as other work began
        return JSONResponse({"detail": str(exc)}, status_code=409)

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

    @app.post("/api/projector")
    async def select_projector(req: ProjectorSelectRequest):
        hub: Hub = app.state.hub
        display = next((d for d in hub.hardware.to_dict()["displays"] if d["key"] == req.key), None)
        if display is None:
            raise HTTPException(404, "Unknown display")
        settings.select_projector(display)
        hub.hardware = hub.hardware  # re-apply the saved choice
        await hub.broadcast_status()
        return hub.status()

    @app.get("/api/camera/preview.jpg")
    async def camera_preview():
        hub: Hub = app.state.hub
        selected = settings.selected(hub.hardware.cameras)
        if selected is None:
            raise HTTPException(409, "No camera selected")
        if job.busy:
            raise HTTPException(409, "Camera is busy scanning")
        frame = await asyncio.to_thread(session.read, hub.hardware.cameras, selected)
        if frame.shape[1] > PREVIEW_WIDTH:  # 4K frames are slow to encode and to send
            scale = PREVIEW_WIDTH / frame.shape[1]
            frame = cv2.resize(frame, (PREVIEW_WIDTH, round(frame.shape[0] * scale)), interpolation=cv2.INTER_AREA)
        ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return Response(jpg.tobytes(), media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.post("/api/camera/release")
    async def release_camera():
        if job.busy:
            raise HTTPException(409, "Camera is busy scanning")
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
        try:
            job.start(hub, hub.hardware.cameras, selected, address)
        except ScanBusy:
            raise HTTPException(409, "A scan is already running")
        return {"started": True}

    @app.post("/api/scan/cancel")
    async def cancel():
        try:
            job.cancel()
        except ScanNotRunning:
            raise HTTPException(409, "No scan is running")
        return {"canceling": True}

    @app.get("/api/scan/latest")
    async def latest_scan():
        meta = latest.meta()
        if meta is None:
            raise HTTPException(404, "No scan yet")
        return {**meta, "image": latest_image_url()}

    @app.get("/api/scan/latest-mask.png")
    async def latest_scan_mask():
        path = latest.mask_path()
        if path is None:
            raise HTTPException(404, "No scan yet")
        return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})

    @app.get("/api/scan/latest.png")
    async def latest_scan_image():
        path = latest.image_path()
        if path is None:
            raise HTTPException(404, "No scan yet")
        return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})

    @app.get("/api/scene")
    async def get_scene():
        if scene.scene is None:
            raise HTTPException(404, "No scan yet")
        return scene.public()

    @app.patch("/api/scene/surfaces/{surface_id}")
    async def update_surface(surface_id: int, req: SurfaceUpdate):
        try:
            scene.update(surface_id, req.effect, req.params, req.polygon, req.name, req.bezier)
        except UnknownSurface:
            raise HTTPException(404, "Unknown surface")
        return scene.public()

    @app.post("/api/scene/apply")
    async def apply_effect(req: ApplyEffectRequest):
        try:
            scene.apply_effect(req.from_id, req.to)
        except UnknownSurface:
            raise HTTPException(404, "Unknown surface")
        return scene.public()

    @app.post("/api/scene/surfaces")
    async def add_surface(req: NewSurfaceRequest):
        if scene.scene is None:
            raise HTTPException(404, "No scan yet")
        scene.add_manual(req.polygon, req.name)
        return scene.public()

    @app.post("/api/scene/redetect")
    async def redetect():
        if scene.scene is None or not latest.can_redetect():
            raise HTTPException(404, "No scan yet")
        if job.busy:
            raise HTTPException(409, "A scan is running")
        async with job.exclusive():  # a scan can't start halfway through
            summary = await asyncio.to_thread(latest.redetect)
            scene.apply_detection(summary)
        await app.state.hub.broadcast({"type": "scan_reload"})
        return scene.public()

    @app.delete("/api/scene/surfaces/{surface_id}")
    async def delete_surface(surface_id: int):
        try:
            scene.delete(surface_id)
        except UnknownSurface:
            raise HTTPException(404, "Unknown surface")
        return scene.public()

    @app.post("/api/scene/merge")
    async def merge_surfaces(req: MergeRequest):
        try:
            scene.merge(req.ids)
        except UnknownSurface:
            raise HTTPException(404, "Unknown surface")
        return scene.public()

    @app.post("/api/scene/select")
    async def select_surface(req: SelectRequest):
        try:
            scene.select(req.id)
        except UnknownSurface:
            raise HTTPException(404, "Unknown surface")
        return scene.public()

    @app.post("/api/presentation")
    async def set_presentation(req: PresentationRequest):
        scene.present(req.mode, req.blackout)
        return scene.presentation

    @app.post("/api/sound")
    async def set_sound(req: SoundRequest):
        scene.set_sound(req.enabled, req.device, req.source, req.output)
        return scene.sound

    @app.post("/api/presentation/blackout/toggle")
    async def toggle_blackout():
        scene.present(blackout=not scene.presentation["blackout"])
        return scene.presentation

    @app.post("/api/media")
    async def upload_media(name: str, request: Request):
        """The request body is the file itself; `name` is its original filename."""
        try:
            return await media.store(latest.media_dir, name, request.stream())
        except media.MediaError as e:
            raise HTTPException(e.status, str(e))

    @app.get("/api/media/{name}")
    async def get_media(name: str):
        found = media.lookup(latest.media_dir, name)
        if found is None:
            raise HTTPException(404, "Unknown media")
        path, content_type = found
        return FileResponse(path, media_type=content_type)  # serves Range requests, which video needs

    @app.get("/api/projects")
    async def list_projects():
        return projects.list()

    @app.post("/api/projects")
    async def save_project(req: ProjectSaveRequest):
        if job.busy:
            raise HTTPException(409, "A scan is running: save after it finishes")
        try:
            async with job.exclusive():  # copy a complete scan, never one being written
                info = await asyncio.to_thread(projects.save, req.name)
        except UnknownProject as e:
            raise HTTPException(409, str(e))
        await app.state.hub.broadcast_status()
        return info

    @app.post("/api/projects/{slug}/open")
    async def open_project(slug: str):
        if job.busy:
            raise HTTPException(409, "A scan is running")
        try:
            async with job.exclusive():  # replacing the working scan: no scan meanwhile
                info = await asyncio.to_thread(projects.open, slug)
        except UnknownProject:
            raise HTTPException(404, "Unknown project")
        hub: Hub = app.state.hub
        await hub.broadcast({"type": "scan_reload"})  # editors refetch the scan image and summary
        await hub.broadcast_status()
        return info

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
                elif ws is hub.output and msg.get("type") == "output_stats":
                    fps = msg.get("fps")
                    if isinstance(fps, (int, float)):
                        hub.output_fps = round(float(fps), 1)
                    if "sound_output_error" in msg:
                        error = msg.get("sound_output_error")
                        hub.output_sound_output_error = str(error)[:200] if error else None
                    if isinstance(msg.get("video_sound_blocked"), bool):
                        hub.output_video_sound_blocked = msg["video_sound_blocked"]
                    sound = msg.get("sound")
                    if isinstance(sound, dict):
                        level, error = sound.get("level"), sound.get("error")
                        hub.output_sound = {
                            "level": round(min(1.0, max(0.0, float(level))), 3) if isinstance(level, (int, float)) else 0,
                            "error": str(error)[:200] if error else None,
                        }
                    await hub.broadcast_status()
                elif ws is hub.output and msg.get("type") == "effect_error":
                    await hub.broadcast({k: msg.get(k) for k in ("type", "surface", "effect", "log")})
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
