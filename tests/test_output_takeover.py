"""#159: a second output window, e.g. one left open on the laptop, silently took over the projector."""

from engine.hardware import FakeHardware
from tests.helpers import LAPTOP, PROJECTOR, RIG_CAMERAS, engine, output


def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=RIG_CAMERAS)


def test_the_replaced_output_window_is_told(tmp_path):
    with engine(rig(), data_dir=tmp_path) as client, output(client) as first:
        with output(client, 3456, 2034):
            while (msg := first.receive_json())["type"] != "output_replaced":
                pass
        assert msg == {"type": "output_replaced"}


def test_scan_says_which_display_the_output_window_seems_to_be_on(tmp_path):
    with engine(rig(), data_dir=tmp_path) as client, output(client, 3456, 2034):
        blocker = client.get("/api/status").json()["scan_blocker"]
    assert "Color LCD" in blocker and "AML TV" in blocker
    assert "another output window" in blocker.lower()


def test_one_output_window_on_the_projector_has_no_such_note(tmp_path):
    with engine(rig(), data_dir=tmp_path) as client, output(client):
        s = client.get("/api/status").json()
    assert s["scan_blocker"] is None or "Color LCD" not in s["scan_blocker"]
