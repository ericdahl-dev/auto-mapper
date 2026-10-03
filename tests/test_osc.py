"""#55: OSC (UDP) control, a thin adapter over the engine's own actions. Off by default."""

import socket
import struct
import time

import pytest

from engine.hardware import FakeHardware
from engine.osc import parse_packet
from tests.helpers import AC410, LAPTOP, PROJECTOR, engine, write_scan

WALL = {"polygon": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "area": 2073600.0}
BOX = {"polygon": [[1200, 800], [1400, 800], [1400, 1000], [1200, 1000]], "area": 40000.0}


def _pad(b: bytes) -> bytes:
    return b + b"\0" * (4 - len(b) % 4)


def osc(address: str, *args) -> bytes:
    tags, data = ",", b""
    for a in args:
        if isinstance(a, bool):
            tags += "T" if a else "F"
        elif isinstance(a, int):
            tags, data = tags + "i", data + struct.pack(">i", a)
        elif isinstance(a, float):
            tags, data = tags + "f", data + struct.pack(">f", a)
        else:
            tags, data = tags + "s", data + _pad(a.encode())
    return _pad(address.encode()) + _pad(tags.encode()) + data


def bundle(*messages: bytes) -> bytes:
    out = _pad(b"#bundle") + struct.pack(">Q", 1)
    for m in messages:
        out += struct.pack(">i", len(m)) + m
    return out


def test_osc_packets_parse_to_address_and_arguments():
    assert parse_packet(osc("/surface/2/param/zoom", 1.5)) == [("/surface/2/param/zoom", [1.5])]
    assert parse_packet(osc("/project/open", "porch", 3, True)) == [("/project/open", ["porch", 3, True])]
    assert parse_packet(bundle(osc("/play"), osc("/blackout", 0))) == [("/play", []), ("/blackout", [0])]
    assert parse_packet(b"garbage") == []


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410])


@pytest.fixture
def scanned(tmp_path):
    write_scan(tmp_path, [WALL, BOX], 1920, 1080)
    return tmp_path


def send(port: int, packet: bytes) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.sendto(packet, ("127.0.0.1", port))


def eventually(fn, timeout=2.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if fn():
            return True
        time.sleep(0.01)
    return False


def listening(client) -> int:
    assert client.post("/api/osc", json={"enabled": True, "port": 0}).status_code == 200  # 0: any free port
    port = client.get("/api/osc").json()["listening"]
    assert port
    return port


def surface(client, sid):
    return next(s for s in client.get("/api/show").json()["surfaces"] if s["id"] == sid)


def test_osc_is_off_until_turned_on(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert client.get("/api/osc").json() == {"enabled": False, "port": 9000, "listening": None}


def test_osc_drives_play_blackout_and_scenes(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        port = listening(client)
        send(port, osc("/play"))
        assert eventually(lambda: client.get("/api/presentation").json()["mode"] == "play")
        send(port, osc("/blackout", 1))
        assert eventually(lambda: client.get("/api/presentation").json()["blackout"] is True)
        send(port, osc("/blackout"))  # no argument: toggle
        assert eventually(lambda: client.get("/api/presentation").json()["blackout"] is False)
        client.post("/api/show/scenes", json={"name": "Night"})
        send(port, osc("/scene/open", "Scene 1"))
        assert eventually(lambda: client.get("/api/show").json()["scene"] == 1)
        send(port, osc("/scene/next"))
        assert eventually(lambda: client.get("/api/show").json()["scene"] == 2)


def test_osc_sets_effects_and_settings_clamped_to_their_range(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        port = listening(client)
        send(port, osc("/surface/2/effect", "media"))
        assert eventually(lambda: surface(client, 2)["effect"] == "media")
        send(port, osc("/surface/2/param/zoom", 50.0))  # media zoom goes up to 10
        assert eventually(lambda: surface(client, 2)["params"].get("zoom") == 10)
        send(port, osc("/surface/2/param/fit", "contain"))
        assert eventually(lambda: surface(client, 2)["params"].get("fit") == "contain")
        send(port, osc("/surface/2/param/fit", "sideways"))  # not an option: ignored
        send(port, osc("/surface/2/param/nope", 1.0))  # not a setting: ignored
        send(port, osc("/surface/9/param/zoom", 1.0))  # no such surface: ignored
        send(port, osc("/surface/2/param/zoom", 2))  # ints are numbers too
        assert eventually(lambda: surface(client, 2)["params"].get("zoom") == 2)
        assert surface(client, 2)["params"]["fit"] == "contain" and "nope" not in surface(client, 2)["params"]


def test_osc_opens_a_project_by_name_or_slug(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        client.post("/api/projects", json={"name": "Front Porch"})
        port = listening(client)
        client.post("/api/presentation", json={"mode": "edit"})
        send(port, osc("/project/open", "Front Porch"))
        assert eventually(lambda: client.get("/api/presentation").json()["mode"] == "play")  # opening plays


def test_turning_osc_off_closes_the_port(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        listening(client)
        client.post("/api/osc", json={"enabled": False})
        assert client.get("/api/osc").json()["listening"] is None
