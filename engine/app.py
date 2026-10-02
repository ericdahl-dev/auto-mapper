import asyncio
import json
import logging
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import ValidationError

from engine.camera_device import CAPTURE_SIZE, CameraFactory, CameraSession, OpenCVCameraFactory
from engine.calibrate import CalibrationError, calibrate_exposure
from engine.camera_lock import Uvc, UvcUtil, locked_camera, recover_camera
from engine.cameras import CameraSettings, UsbAddress, usb_address
from engine.files import write_text_atomic
from engine.hardware import HardwareProbe, MacHardware
from engine.hub import Hub, OutputNotResponding
from engine import media
from engine.scan import DecodeResult, block_coverage, diagnose, projector_space_image
from engine.scan_runner import ScanCancelled, ScanError, capture_scan
from engine.projects import ProjectStore, UnknownProject
from engine.scene import SceneStore, UnknownSurface
from engine.surfaces import detect_surfaces
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
    scan_dir = data_path / "scans" / "latest"
    scanning = asyncio.Lock()
    cancel_scan = threading.Event()  # set by POST /api/scan/cancel, read by the capture thread

    def scan_busy() -> bool:
        task = getattr(app, "state", None) and getattr(app.state, "scan_task", None)
        return scanning.locked() or (task is not None and not task.done())
    scene = SceneStore(scan_dir)
    projects = ProjectStore(data_path, scan_dir, scene)

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
        if scan_busy():
            raise HTTPException(409, "Camera is busy scanning")
        frame = await asyncio.to_thread(session.read, hub.hardware.cameras, selected)
        if frame.shape[1] > PREVIEW_WIDTH:  # 4K frames are slow to encode and to send
            scale = PREVIEW_WIDTH / frame.shape[1]
            frame = cv2.resize(frame, (PREVIEW_WIDTH, round(frame.shape[0] * scale)), interpolation=cv2.INTER_AREA)
        ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return Response(jpg.tobytes(), media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.post("/api/camera/release")
    async def release_camera():
        if scan_busy():
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
        if scan_busy():
            raise HTTPException(409, "A scan is already running")
        cancel_scan.clear()
        # Claim the scan before the task starts, so a double click can't start two.
        app.state.scan_task = asyncio.create_task(run_scan(hub, selected, address))
        return {"started": True}

    @app.post("/api/scan/cancel")
    async def cancel():
        if not scan_busy():
            raise HTTPException(409, "No scan is running")
        cancel_scan.set()
        return {"cancelling": True}

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
                    cancelled=cancel_scan.is_set,
                    frames_per_pattern=scan_frames_per_pattern,
                )

            try:
                started = time.monotonic()
                decoded, calibration = await asyncio.to_thread(capture)
                settings.save_calibration(selected, calibration)
                image, covered = await asyncio.to_thread(projector_space_image, decoded)
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
                await asyncio.to_thread(save_scan, decoded, image, covered, summary)
                scene.apply_detection(summary)  # keeps drawn/edited surfaces and carries effects
                await hub.broadcast({"type": "scan_result", **summary, "image": latest_image_url()})
            except ScanCancelled:
                await hub.broadcast({"type": "scan_cancelled"})
            except (ScanError, CalibrationError, OutputNotResponding) as e:
                log.warning("scan failed: %s", e)
                await hub.broadcast({"type": "scan_failed", "error": str(e)})
            except Exception as e:  # never leave the editor waiting on a dead scan
                log.exception("scan crashed")
                await hub.broadcast({"type": "scan_failed", "error": f"Scan crashed: {e}"})
                raise
            finally:
                await asyncio.to_thread(session.close)
                await hub.send_to_output({"type": "show_test_frame", "kind": "black"})
                await hub.broadcast_scene()  # back to the projected scene
                await hub.broadcast_status()

    def save_scan(decoded, image, covered, summary: dict) -> None:
        scan_dir.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(scan_dir / "scan.png"), image)
        cv2.imwrite(str(scan_dir / "mask.png"), covered.astype(np.uint8) * 255)
        np.savez_compressed(
            scan_dir / "map.npz", proj_x=decoded.proj_x.astype(np.int16), proj_y=decoded.proj_y.astype(np.int16),
            valid=decoded.valid, covered=covered,
        )
        write_text_atomic(scan_dir / "meta.json", json.dumps(summary, indent=2))

    def latest_image_url() -> str:
        return f"/api/scan/latest.png?t={int(time.time() * 1000)}"

    @app.get("/api/scan/latest")
    async def latest_scan():
        meta = scan_dir / "meta.json"
        if not meta.exists():
            raise HTTPException(404, "No scan yet")
        return {**json.loads(meta.read_text()), "image": latest_image_url()}

    @app.get("/api/scan/latest-mask.png")
    async def latest_scan_mask():
        path = scan_dir / "mask.png"
        if not path.exists():
            raise HTTPException(404, "No scan yet")
        return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})

    @app.get("/api/scan/latest.png")
    async def latest_scan_image():
        path = scan_dir / "scan.png"
        if not path.exists():
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
        await app.state.hub.broadcast_scene()
        return scene.public()

    @app.post("/api/scene/apply")
    async def apply_effect(req: ApplyEffectRequest):
        try:
            scene.apply_effect(req.from_id, req.to)
        except UnknownSurface:
            raise HTTPException(404, "Unknown surface")
        await app.state.hub.broadcast_scene()
        return scene.public()

    @app.post("/api/scene/surfaces")
    async def add_surface(req: NewSurfaceRequest):
        if scene.scene is None:
            raise HTTPException(404, "No scan yet")
        scene.add_manual(req.polygon, req.name)
        await app.state.hub.broadcast_scene()
        return scene.public()

    @app.post("/api/scene/redetect")
    async def redetect():
        if scene.scene is None or not (scan_dir / "map.npz").exists():
            raise HTTPException(404, "No scan yet")
        if scan_busy():
            raise HTTPException(409, "A scan is running")
        async with scanning:  # hold scans/latest so a scan can't start halfway through
            summary = await asyncio.to_thread(detect_saved_scan)
            scene.apply_detection(summary)
        await app.state.hub.broadcast_scene()
        await app.state.hub.broadcast({"type": "scan_reload"})
        return scene.public()

    def detect_saved_scan() -> dict:
        """Runs surface detection again on the saved scan, e.g. after detection improvements."""
        m = np.load(scan_dir / "map.npz")
        meta = json.loads((scan_dir / "meta.json").read_text())
        decoded = DecodeResult(
            proj_x=m["proj_x"].astype(np.int32), proj_y=m["proj_y"].astype(np.int32), valid=m["valid"],
            white=None, black=None, bit_reliability={}, width=meta["width"], height=meta["height"],
        )
        image = cv2.imread(str(scan_dir / "scan.png"))
        meta["surfaces"] = detect_surfaces(decoded, (image, m["covered"]))
        write_text_atomic(scan_dir / "meta.json", json.dumps(meta, indent=2))
        return meta

    @app.delete("/api/scene/surfaces/{surface_id}")
    async def delete_surface(surface_id: int):
        try:
            scene.delete(surface_id)
        except UnknownSurface:
            raise HTTPException(404, "Unknown surface")
        await app.state.hub.broadcast_scene()
        return scene.public()

    @app.post("/api/scene/merge")
    async def merge_surfaces(req: MergeRequest):
        try:
            scene.merge(req.ids)
        except UnknownSurface:
            raise HTTPException(404, "Unknown surface")
        await app.state.hub.broadcast_scene()
        return scene.public()

    @app.post("/api/scene/select")
    async def select_surface(req: SelectRequest):
        try:
            scene.select(req.id)
        except UnknownSurface:
            raise HTTPException(404, "Unknown surface")
        await app.state.hub.broadcast_scene()
        return scene.public()

    @app.post("/api/presentation")
    async def set_presentation(req: PresentationRequest):
        scene.present(req.mode, req.blackout)
        await app.state.hub.broadcast_scene()
        return scene.presentation

    @app.post("/api/sound")
    async def set_sound(req: SoundRequest):
        scene.set_sound(req.enabled, req.device)
        await app.state.hub.broadcast_scene()
        return scene.sound

    @app.post("/api/presentation/blackout/toggle")
    async def toggle_blackout():
        scene.present(blackout=not scene.presentation["blackout"])
        await app.state.hub.broadcast_scene()
        return scene.presentation

    @app.post("/api/media")
    async def upload_media(name: str, request: Request):
        """The request body is the file itself; `name` is its original filename."""
        try:
            return await media.store(scan_dir / "media", name, request.stream())
        except media.MediaError as e:
            raise HTTPException(e.status, str(e))

    @app.get("/api/media/{name}")
    async def get_media(name: str):
        found = media.lookup(scan_dir / "media", name)
        if found is None:
            raise HTTPException(404, "Unknown media")
        path, content_type = found
        return FileResponse(path, media_type=content_type)  # serves Range requests, which video needs

    @app.get("/api/projects")
    async def list_projects():
        return projects.list()

    @app.post("/api/projects")
    async def save_project(req: ProjectSaveRequest):
        if scan_busy():
            raise HTTPException(409, "A scan is running: save after it finishes")
        try:
            async with scanning:  # copy a complete scan, never one being written
                info = await asyncio.to_thread(projects.save, req.name)
        except UnknownProject as e:
            raise HTTPException(409, str(e))
        await app.state.hub.broadcast_status()
        return info

    @app.post("/api/projects/{slug}/open")
    async def open_project(slug: str):
        if scan_busy():
            raise HTTPException(409, "A scan is running")
        try:
            async with scanning:  # replacing scans/latest: keep a scan from starting meanwhile
                info = await asyncio.to_thread(projects.open, slug)
        except UnknownProject:
            raise HTTPException(404, "Unknown project")
        scene.present(mode="play", blackout=False)  # an opened project is ready to show
        hub: Hub = app.state.hub
        await hub.broadcast_scene()
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
