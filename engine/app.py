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
from engine.show import CurrentShow, LastScene, NothingToUndo, UnknownScene, UnknownSurface
from engine.messages import (
    AlignmentRequest,
    ApplyEffectRequest,
    CameraSelectRequest,
    EditorHello,
    EffectErrorReport,
    Hello,
    MergeRequest,
    NewSceneRequest,
    NewSurfaceRequest,
    OutputHello,
    OutputMessage,
    OutputStats,
    PatternShown,
    PresentationRequest,
    ProjectorSelectRequest,
    ProjectSaveRequest,
    SceneOrder,
    SceneUpdate,
    SelectRequest,
    SoundRequest,
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
    # patterns (coverage 0.61 vs 0.88 with these values, same space).
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
    show = CurrentShow(latest)
    projects = ProjectStore(data_path, latest, show)
    job = ScanJob(  # one scan at a time; other work on the working scan holds it with job.exclusive()
        session=session, settings=settings, latest=latest, show=show, make_uvc=make_uvc, data_dir=data_path,
        settle_seconds=scan_settle_seconds, drop_frames=scan_drop_frames,
        frames_per_pattern=scan_frames_per_pattern, ack_timeout=ack_timeout,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.hub = Hub(await asyncio.to_thread(probe.probe), settings, show)
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

    @app.get("/api/show")
    async def get_show():
        if show.data is None:
            raise HTTPException(404, "No scan yet")
        return show.public()

    @app.patch("/api/show/surfaces/{surface_id}")
    async def update_surface(surface_id: int, req: SurfaceUpdate):
        try:
            show.update(surface_id, req.effect, req.params, req.polygon, req.name, req.bezier, req.edge, req.gesture)
        except UnknownSurface:
            raise HTTPException(404, "Unknown surface")
        return show.public()

    @app.post("/api/show/apply")
    async def apply_effect(req: ApplyEffectRequest):
        try:
            show.apply_effect(req.from_id, req.to)
        except UnknownSurface:
            raise HTTPException(404, "Unknown surface")
        return show.public()

    @app.post("/api/show/surfaces")
    async def add_surface(req: NewSurfaceRequest):
        if show.data is None:
            raise HTTPException(404, "No scan yet")
        show.add_manual(req.polygon, req.name)
        return show.public()

    @app.post("/api/show/redetect")
    async def redetect():
        if show.data is None or not latest.can_redetect():
            raise HTTPException(404, "No scan yet")
        if job.busy:
            raise HTTPException(409, "A scan is running")
        async with job.exclusive():  # a scan can't start halfway through
            summary = await asyncio.to_thread(latest.redetect)
            show.apply_detection(summary)
        await app.state.hub.broadcast({"type": "scan_reload"})
        return show.public()

    @app.delete("/api/show/surfaces/{surface_id}")
    async def delete_surface(surface_id: int):
        try:
            show.delete(surface_id)
        except UnknownSurface:
            raise HTTPException(404, "Unknown surface")
        return show.public()

    @app.post("/api/show/merge")
    async def merge_surfaces(req: MergeRequest):
        try:
            show.merge(req.ids)
        except UnknownSurface:
            raise HTTPException(404, "Unknown surface")
        return show.public()

    @app.post("/api/show/select")
    async def select_surface(req: SelectRequest):
        try:
            show.select(req.id)
        except UnknownSurface:
            raise HTTPException(404, "Unknown surface")
        return show.public()

    @app.post("/api/presentation")
    async def set_presentation(req: PresentationRequest):
        show.present(req.mode, req.blackout)
        return show.presentation

    @app.post("/api/show/scenes")
    async def add_scene(req: NewSceneRequest):
        if show.data is None:
            raise HTTPException(404, "No scan yet")
        try:
            show.add_scene(req.name, req.duplicate)
        except UnknownScene:
            raise HTTPException(404, "Unknown scene")
        return show.public()

    @app.post("/api/show/scenes/order")
    async def order_scenes(req: SceneOrder):
        if show.data is None:
            raise HTTPException(404, "No scan yet")
        try:
            show.order_scenes(req.ids)
        except ValueError as e:
            raise HTTPException(422, str(e))
        return show.public()

    @app.patch("/api/show/scenes/{scene_id}")
    async def update_scene(scene_id: int, req: SceneUpdate):
        try:
            show.update_scene(scene_id, req.name, req.duration)
        except UnknownScene:
            raise HTTPException(404, "Unknown scene")
        return show.public()

    @app.post("/api/show/scenes/{scene_id}/open")
    async def open_scene(scene_id: int):
        try:
            show.open_scene(scene_id)
        except UnknownScene:
            raise HTTPException(404, "Unknown scene")
        return show.public()

    @app.delete("/api/show/scenes/{scene_id}")
    async def delete_scene(scene_id: int):
        try:
            show.delete_scene(scene_id)
        except UnknownScene:
            raise HTTPException(404, "Unknown scene")
        except LastScene:
            raise HTTPException(409, "A show needs at least one scene")
        return show.public()

    @app.post("/api/show/undo")
    async def undo():
        try:
            show.undo()
        except NothingToUndo:
            raise HTTPException(409, "Nothing to undo")
        return show.public()

    @app.post("/api/show/redo")
    async def redo():
        try:
            show.redo()
        except NothingToUndo:
            raise HTTPException(409, "Nothing to redo")
        return show.public()

    @app.post("/api/show/alignment")
    async def set_alignment(req: AlignmentRequest):
        if show.data is None:
            raise HTTPException(404, "No scan yet")
        show.set_alignment(req.corners, req.brightness, req.gesture)
        return show.alignment()

    @app.post("/api/show/alignment/reset")
    async def reset_alignment():
        if show.data is None:
            raise HTTPException(404, "No scan yet")
        show.reset_alignment()
        return show.alignment()

    @app.post("/api/sound")
    async def set_sound(req: SoundRequest):
        show.set_sound(req.enabled, req.device, req.source, req.output)
        return show.sound

    @app.post("/api/presentation/blackout/toggle")
    async def toggle_blackout():
        show.present(blackout=not show.presentation["blackout"])
        return show.presentation

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
                raw = await ws.receive_json()
                if ws is not hub.output:
                    continue  # editors only listen
                try:
                    msg = OutputMessage.validate_python(raw)
                except ValidationError as e:
                    log.warning("ignoring malformed message from the output window: %s", e.errors()[:1])
                    continue
                if isinstance(msg, PatternShown):
                    hub.pattern_shown(msg.seq)
                elif isinstance(msg, OutputStats):
                    if msg.fps is not None:
                        hub.output_fps = round(msg.fps, 1)
                    if "sound_output_error" in msg.model_fields_set:
                        hub.output_sound_output_error = (msg.sound_output_error or "")[:200] or None
                    if msg.video_sound_blocked is not None:
                        hub.output_video_sound_blocked = msg.video_sound_blocked
                    if msg.sound is not None:
                        hub.output_sound = {
                            "level": round(min(1.0, max(0.0, msg.sound.level)), 3),
                            "error": (msg.sound.error or "")[:200] or None,
                        }
                    await hub.broadcast_status()
                elif isinstance(msg, EffectErrorReport):
                    await hub.broadcast(msg.model_dump())
                else:  # the output window re-sends hello when resized (e.g. going fullscreen)
                    await hub.set_output(ws, msg.width, msg.height)
        except WebSocketDisconnect:
            pass
        finally:
            await hub.remove(ws)

    return app
