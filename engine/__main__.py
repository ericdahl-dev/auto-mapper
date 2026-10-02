import os

import uvicorn

from engine.app import create_app

if __name__ == "__main__":
    # No auto-reload: a reloaded worker process could not read the webcam (AVFoundation)
    # until the engine was fully restarted. Restart `make dev` after engine changes.
    # AUTO_MAPPER_CAPTURE=1920x1080 overrides the camera capture size (default: 4K).
    size = os.environ.get("AUTO_MAPPER_CAPTURE")
    kwargs = {"capture_size": tuple(int(v) for v in size.lower().split("x"))} if size else {}
    # Scan timing overrides, for tuning a camera: frames dropped and seconds waited per pattern.
    if drop := os.environ.get("AUTO_MAPPER_SCAN_DROP"):
        kwargs["scan_drop_frames"] = int(drop)
    if settle := os.environ.get("AUTO_MAPPER_SCAN_SETTLE"):
        kwargs["scan_settle_seconds"] = float(settle)
    uvicorn.run(create_app(**kwargs), host="127.0.0.1", port=8765)
