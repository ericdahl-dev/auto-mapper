"""Shared test rig: fake hardware matching the real Mac + projector + AC410 setup."""

import tempfile
from contextlib import contextmanager

from fastapi.testclient import TestClient

from engine.app import create_app
from engine.camera_device import FakeCameraFactory

PROJECTOR = {"name": "AML TV", "width": 1920, "height": 1080, "main": False}
LAPTOP = {"name": "Color LCD", "width": 3456, "height": 2234, "main": True}

# Real AVFoundation metadata from the rig, in AVFoundation's (not OpenCV's) order.
OBS = {"name": "OBS Virtual Camera", "unique_id": "7626645E-4425-469E-9D8B-97E0FA59AC75", "device_type": "external"}
FACETIME = {"name": "FaceTime HD Camera", "unique_id": "3F45E80A-0176-46F7-B185-BB9E2C0E82E3", "device_type": "builtin"}
AC410 = {"name": "Webcam AC410", "unique_id": "0x2110000f1311306", "device_type": "external"}
IPHONE = {"name": "erictest Camera", "unique_id": "35AEA069-69C2-4301-8366-AA6B00000001", "device_type": "continuity"}
RIG_CAMERAS = [OBS, FACETIME, AC410, IPHONE]


@contextmanager
def engine(hardware, **kwargs):
    with tempfile.TemporaryDirectory() as tmp:
        kwargs.setdefault("data_dir", tmp)
        kwargs.setdefault("camera_factory", FakeCameraFactory())  # never a real camera in tests
        kwargs.setdefault("settle_seconds", 0)
        kwargs.setdefault("scan_settle_seconds", 0)
        kwargs.setdefault("scan_drop_frames", 0)
        with TestClient(create_app(hardware=hardware, **kwargs)) as client:
            yield client


@contextmanager
def editor(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello", "role": "editor"})
        yield ws


@contextmanager
def output(client, width=1920, height=1080):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello", "role": "output", "width": width, "height": height})
        yield ws
