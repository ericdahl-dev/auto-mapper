"""#51: sound-reactive effects. The engine only relays settings and the output's meter."""


import pytest

from engine.hardware import FakeHardware
from tests.helpers import AC410, editor, engine, LAPTOP, output, PROJECTOR, write_scan

WALL = {"polygon": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], "area": 2073600.0}


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410])


@pytest.fixture
def scanned(tmp_path):
    write_scan(tmp_path, [WALL], 1920, 1080)
    return tmp_path


def test_sound_is_off_until_turned_on(rig, scanned):
    with engine(rig, data_dir=scanned) as client, output(client) as out:
        assert out.receive_json()["sound"] == {"enabled": False, "device": None, "source": "mic", "output": None, "delay": 0}


def test_turning_sound_on_tells_the_output_which_input_to_use(rig, scanned):
    with engine(rig, data_dir=scanned) as client, output(client) as out:
        out.receive_json()
        r = client.post("/api/sound", json={"enabled": True, "device": "usb-mic-1"})
        assert r.json() == {"enabled": True, "device": "usb-mic-1", "source": "mic", "output": None, "delay": 0}
        assert out.receive_json()["sound"] == {"enabled": True, "device": "usb-mic-1", "source": "mic", "output": None, "delay": 0}

        client.post("/api/sound", json={"enabled": False})  # device kept for next time
        assert out.receive_json()["sound"] == {"enabled": False, "device": "usb-mic-1", "source": "mic", "output": None, "delay": 0}


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


def test_effects_can_react_to_the_video_sound_instead_of_the_mic(rig, scanned):
    with engine(rig, data_dir=scanned) as client, output(client) as out:
        assert out.receive_json()["sound"]["source"] == "mic"
        client.post("/api/sound", json={"enabled": True, "source": "video"})
        assert out.receive_json()["sound"] == {"enabled": True, "device": None, "source": "video", "output": None, "delay": 0}
        assert client.post("/api/sound", json={"source": "radio"}).status_code == 422


def test_sound_can_go_to_a_chosen_output_device(rig, scanned):
    with engine(rig, data_dir=scanned) as client, output(client) as out:
        assert out.receive_json()["sound"]["output"] is None  # the system default
        client.post("/api/sound", json={"output": "hdmi-device-id"})
        assert out.receive_json()["sound"]["output"] == "hdmi-device-id"
        client.post("/api/sound", json={"output": ""})  # back to the system default
        assert out.receive_json()["sound"]["output"] is None


def test_editors_see_sound_output_errors(rig, scanned):
    with engine(rig, data_dir=scanned) as client, editor(client) as ed, output(client) as out:
        ed.receive_json(), ed.receive_json()
        out.receive_json()
        ed.receive_json()
        out.send_json({"type": "output_stats", "fps": 60, "sound_output_error": "That sound output is not available."})
        assert ed.receive_json()["output_sound_output_error"] == "That sound output is not available."


def test_a_sound_delay_lines_video_sound_up_with_the_projectors_late_picture(tmp_path):
    hw = FakeHardware(displays=[LAPTOP], cameras=[AC410])
    with engine(hw, data_dir=tmp_path) as client:
        assert client.get("/api/show").status_code in (200, 404)
        assert client.post("/api/sound", json={"delay": 120}).json()["delay"] == 120
        assert client.post("/api/sound", json={"delay": 501}).status_code == 422
        assert client.post("/api/sound", json={"delay": -180}).json()["delay"] == -180  # sound early: late speakers
        assert client.post("/api/sound", json={"delay": -501}).status_code == 422
        client.post("/api/sound", json={"delay": 120})
    with engine(hw, data_dir=tmp_path) as client:  # the projector's lag doesn't change: kept in settings
        assert client.post("/api/sound", json={}).json()["delay"] == 120


def test_editors_see_how_many_channels_the_sound_output_has(rig, scanned):
    with engine(rig, data_dir=scanned) as client, editor(client) as ed, output(client) as out:
        ed.receive_json(), ed.receive_json()
        out.receive_json()
        ed.receive_json()
        out.send_json({"type": "output_stats", "fps": 60, "sound_channels": 8})
        assert ed.receive_json()["output_sound_channels"] == 8
        out.send_json({"type": "output_stats", "sound_channels": 4000})  # nonsense is refused, not stored
        out.send_json({"type": "output_stats", "fps": 30})
        assert ed.receive_json()["output_sound_channels"] == 8
