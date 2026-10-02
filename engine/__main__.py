import uvicorn

if __name__ == "__main__":
    # reload: the engine restarts itself when its code changes.
    uvicorn.run("engine.app:create_app", factory=True, host="127.0.0.1", port=8765, reload=True, reload_dirs=["engine"])
