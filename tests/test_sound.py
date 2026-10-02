"""#51: sound-reactive effects. The engine only relays settings and the output's meter."""

import json

import pytest

from engine.hardware import FakeHardware
from tests.helpers import AC410, LAPTOP, PROJECTOR, editor, engine, output

WALL = {"polygon": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "area": 2073600.0}


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410])


@pytest.fixture
def scanned(tmp_path):
    d = tmp_path / "scans" / "latest"
    d.mkdir(parents=True)
    (d / "meta.json").write_text(json.dumps({"width": 1920, "height": 1080, "surfaces": [WALL]}))
    return tmp_path


def test_sound_is_off_until_turned_on(rig, scanned):
    with engine(rig, data_dir=scanned) as client, output(client) as out:
        assert out.receive_json()["sound"] == {"enabled": False, "device": None}


def test_turning_sound_on_tells_the_output_which_input_to_use(rig, scanned):
    with engine(rig, data_dir=scanned) as client, output(client) as out:
        out.receive_json()
        r = client.post("/api/sound", json={"enabled": True, "device": "usb-mic-1"})
        assert r.json() == {"enabled": True, "device": "usb-mic-1"}
        assert out.receive_json()["sound"] == {"enabled": True, "device": "usb-mic-1"}

        client.post("/api/sound", json={"enabled": False})  # device kept for next time
        assert out.receive_json()["sound"] == {"enabled": False, "device": "usb-mic-1"}


def test_editors_see_the_outputs_sound_meter_and_errors(rig, scanned):
    with engine(rig, data_dir=scanned) as client, editor(client) as ed, output(client) as out:
        ed.receive_json(), ed.receive_json()  # status, scene
        out.receive_json()
        ed.receive_json()  # status: output connected

        out.send_json({"type": "output_stats", "fps": 60, "sound": {"level": 0.42, "error": None}})
        assert ed.receive_json()["output_sound"] == {"level": 0.42, "error": None}

        out.send_json({"type": "output_stats", "fps": 60, "sound": {"level": 0, "error": "Microphone blocked"}})
        assert ed.receive_json()["output_sound"] == {"level": 0, "error": "Microphone blocked"}


def test_editors_learn_when_video_sound_waits_for_a_click(rig, scanned):
    with engine(rig, data_dir=scanned) as client, editor(client) as ed, output(client) as out:
        ed.receive_json(), ed.receive_json()
        out.receive_json()
        ed.receive_json()

        out.send_json({"type": "output_stats", "fps": 60, "video_sound_blocked": True})
        assert ed.receive_json()["output_video_sound_blocked"] is True

        out.send_json({"type": "output_stats", "fps": 60, "video_sound_blocked": False})
        assert ed.receive_json()["output_video_sound_blocked"] is False
