"""#52: the playlist plays the scenes in order in Play mode, each for its duration."""

import time

import pytest

from engine.hardware import FakeHardware
from tests.helpers import AC410, LAPTOP, PROJECTOR, engine, write_scan

WALL = {"polygon": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "area": 2073600.0}


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410])


@pytest.fixture
def scanned(tmp_path):
    write_scan(tmp_path, [WALL], 1920, 1080)
    return tmp_path


def current(client):
    return client.get("/api/show").json()["scene"]


def three_scenes(client, seconds=0.3):
    client.post("/api/show/scenes", json={"name": "B"})
    client.post("/api/show/scenes", json={"name": "C"})
    for sid in (1, 2, 3):
        client.patch(f"/api/show/scenes/{sid}", json={"duration": seconds})
    client.post("/api/show/scenes/1/open")


def wait_for(fn, timeout=3.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if fn():
            return True
        time.sleep(0.02)
    return False


def test_the_playlist_has_crossfade_and_loop_settings(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        assert client.get("/api/show").json()["playlist"] == {"crossfade": 1.0, "loop": True}
        client.post("/api/show/playlist", json={"crossfade": 2.5, "loop": False})
        assert client.get("/api/show").json()["playlist"] == {"crossfade": 2.5, "loop": False}
        assert client.post("/api/show/playlist", json={"crossfade": -1}).status_code == 422


def test_play_mode_moves_on_after_each_scenes_duration_and_loops(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        three_scenes(client)
        time.sleep(0.5)
        assert current(client) == 1  # edit mode: stays put
        client.post("/api/presentation", json={"mode": "play"})
        assert wait_for(lambda: current(client) == 2)
        assert wait_for(lambda: current(client) == 3)
        assert wait_for(lambda: current(client) == 1)  # loops


def test_without_loop_it_stops_on_the_last_scene(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        three_scenes(client, seconds=0.15)
        client.post("/api/show/playlist", json={"loop": False})
        client.post("/api/presentation", json={"mode": "play"})
        assert wait_for(lambda: current(client) == 3)
        time.sleep(0.5)
        assert current(client) == 3


def test_next_and_previous_step_through_by_hand(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        three_scenes(client, seconds=60)
        client.post("/api/show/scenes/next")
        assert current(client) == 2
        client.post("/api/show/scenes/previous")
        client.post("/api/show/scenes/previous")
        assert current(client) == 3  # wraps around
        client.post("/api/show/playlist", json={"loop": False})
        client.post("/api/show/scenes/next")
        assert current(client) == 3  # no loop: stays at the end


def test_a_scene_opened_by_hand_gets_its_full_duration(rig, scanned):
    with engine(rig, data_dir=scanned) as client:
        three_scenes(client, seconds=0.6)
        client.post("/api/presentation", json={"mode": "play"})
        time.sleep(0.4)
        client.post("/api/show/scenes/3/open")
        time.sleep(0.4)  # 0.8 s since play started, but only 0.4 s since scene 3 opened
        assert current(client) == 3
        assert wait_for(lambda: current(client) == 1)
