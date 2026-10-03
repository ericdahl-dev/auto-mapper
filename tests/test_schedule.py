"""#53: daily on and off times for unattended displays."""

from datetime import datetime

from engine.schedule import next_change, should_be_on

EVENINGS = {"enabled": True, "on": "17:30", "off": "23:00", "days": {}}
LATE = {"enabled": True, "on": "22:00", "off": "02:00", "days": {}}  # across midnight


def at(day: int, hhmm: str) -> datetime:
    """2026-10-05 is a Monday: day 0 = Monday ... 6 = Sunday."""
    h, m = map(int, hhmm.split(":"))
    return datetime(2026, 10, 5 + day, h, m)


def test_on_between_the_times_off_outside_them():
    assert not should_be_on(EVENINGS, at(0, "17:29"))
    assert should_be_on(EVENINGS, at(0, "17:30"))
    assert should_be_on(EVENINGS, at(0, "22:59"))
    assert not should_be_on(EVENINGS, at(0, "23:00"))


def test_a_schedule_across_midnight_stays_on_into_the_next_morning():
    assert should_be_on(LATE, at(0, "23:30"))
    assert should_be_on(LATE, at(1, "01:59"))
    assert not should_be_on(LATE, at(1, "02:00"))
    assert not should_be_on(LATE, at(1, "21:59"))


def test_weekdays_can_have_their_own_times_or_stay_off():
    weekly = {**EVENINGS, "days": {"5": {"on": "12:00", "off": "23:30"}, "6": None}}  # Sat long, Sun off
    assert should_be_on(weekly, at(5, "12:00"))
    assert should_be_on(weekly, at(5, "23:15"))
    assert not should_be_on(weekly, at(6, "18:00"))
    assert should_be_on(weekly, at(4, "18:00"))  # Friday: the usual times


def test_a_disabled_schedule_never_switches():
    assert not should_be_on({**EVENINGS, "enabled": False}, at(0, "18:00"))
    assert next_change({**EVENINGS, "enabled": False}, at(0, "18:00")) is None


def test_the_next_change_is_the_next_on_or_off_time():
    assert next_change(EVENINGS, at(0, "12:00")) == (at(0, "17:30"), True)
    assert next_change(EVENINGS, at(0, "18:00")) == (at(0, "23:00"), False)
    assert next_change(EVENINGS, at(0, "23:30")) == (at(1, "17:30"), True)
    assert next_change(LATE, at(0, "23:00")) == (at(1, "02:00"), False)
    off_sundays = {**EVENINGS, "days": {"6": None}}
    assert next_change(off_sundays, at(5, "23:30")) == (at(7, "17:30"), True)  # skips Sunday


# The engine applies the schedule, read from a clock tests can move.

import time as wall  # noqa: E402

import pytest  # noqa: E402

from engine.hardware import FakeHardware  # noqa: E402
from tests.helpers import AC410, LAPTOP, PROJECTOR, engine  # noqa: E402


class Clock:
    def __init__(self, now: datetime):
        self.now = now

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def rig():
    return FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[AC410])


def presentation(client):
    return client.get("/api/presentation").json()


def eventually(fn, timeout=2.0):
    end = wall.monotonic() + timeout
    while wall.monotonic() < end:
        if fn():
            return True
        wall.sleep(0.01)
    return False


def test_the_schedule_is_saved_and_reports_the_next_change(rig, tmp_path):
    clock = Clock(at(0, "12:00"))
    with engine(rig, data_dir=tmp_path, clock=clock, schedule_poll_seconds=0.01) as client:
        assert client.get("/api/schedule").json()["schedule"]["enabled"] is False
        assert client.post("/api/schedule", json=EVENINGS).status_code == 200
        got = client.get("/api/schedule").json()
        assert got["schedule"] == EVENINGS
        assert got["next"] == {"at": "2026-10-05T17:30:00", "on": True}
        assert client.post("/api/schedule", json={**EVENINGS, "on": "25:00"}).status_code == 422
    with engine(rig, data_dir=tmp_path, clock=clock) as client:  # kept in settings
        assert client.get("/api/schedule").json()["schedule"] == EVENINGS


def test_the_engine_switches_between_play_and_blackout_on_time(rig, tmp_path):
    clock = Clock(at(0, "17:00"))
    with engine(rig, data_dir=tmp_path, clock=clock, schedule_poll_seconds=0.01) as client:
        client.post("/api/schedule", json=EVENINGS)
        assert eventually(lambda: presentation(client)["blackout"] is True)  # off hours: dark
        clock.now = at(0, "17:30")
        assert eventually(lambda: presentation(client) == {"mode": "play", "blackout": False})
        clock.now = at(0, "23:00")
        assert eventually(lambda: presentation(client)["blackout"] is True)


def test_switching_by_hand_holds_until_the_next_scheduled_change(rig, tmp_path):
    clock = Clock(at(0, "18:00"))
    with engine(rig, data_dir=tmp_path, clock=clock, schedule_poll_seconds=0.01) as client:
        client.post("/api/schedule", json=EVENINGS)
        assert eventually(lambda: presentation(client)["mode"] == "play")
        client.post("/api/presentation", json={"blackout": True})
        wall.sleep(0.1)
        assert presentation(client)["blackout"] is True  # not switched back on
        clock.now = at(0, "23:00")
        wall.sleep(0.1)
        clock.now = at(1, "17:30")
        assert eventually(lambda: presentation(client)["blackout"] is False)


def test_a_disabled_schedule_leaves_presentation_alone(rig, tmp_path):
    clock = Clock(at(0, "18:00"))
    with engine(rig, data_dir=tmp_path, clock=clock, schedule_poll_seconds=0.01) as client:
        client.post("/api/schedule", json={**EVENINGS, "enabled": False})
        wall.sleep(0.1)
        assert presentation(client) == {"mode": "edit", "blackout": False}


def test_auto_start_opens_the_last_show_in_play_without_a_camera(tmp_path):
    from tests.helpers import write_scan
    no_camera = FakeHardware(displays=[LAPTOP, PROJECTOR], cameras=[])
    write_scan(tmp_path, [{"polygon": [[0, 0], [100, 0], [100, 100]], "area": 5000.0}], 1920, 1080)
    with engine(no_camera, data_dir=tmp_path) as client:
        assert presentation(client)["mode"] == "edit"  # off by default
        assert client.post("/api/autostart", json={"enabled": True}).status_code == 200
        assert client.get("/api/schedule").json()["autostart"] is True
    with engine(no_camera, data_dir=tmp_path) as client:  # the next start
        assert presentation(client) == {"mode": "play", "blackout": False}
        assert len(client.get("/api/show").json()["surfaces"]) == 1
