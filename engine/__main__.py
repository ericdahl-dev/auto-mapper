import uvicorn

from engine.app import create_app

if __name__ == "__main__":
    # No auto-reload: a reloaded worker process could not read the webcam (AVFoundation)
    # until the engine was fully restarted. Restart `make dev` after engine changes.
    uvicorn.run(create_app(), host="127.0.0.1", port=8765)
