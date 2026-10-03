"""Daily on and off times for unattended displays (#53).

A schedule is {"enabled": bool, "on": "HH:MM", "off": "HH:MM", "days": {...}}. "days" overrides the
times for a weekday ("0" = Monday ... "6" = Sunday): {"on": ..., "off": ...}, or None for off all day.
An off time at or before the on time runs past midnight into the next morning.
"""

import asyncio
from collections.abc import Callable
from datetime import date, datetime, time, timedelta

LOOKAHEAD_DAYS = 8  # far enough to find the next change past a week of days off


def _hhmm(text: str) -> time:
    h, m = map(int, text.split(":"))
    return time(h, m)


def _window(schedule: dict, day: date) -> tuple[datetime, datetime] | None:
    """When the display is on for the evening that starts on `day`, or None if it stays off."""
    days = schedule.get("days", {})
    times = days.get(str(day.weekday()), schedule)  # that weekday's own times, or the usual ones
    if times is None:
        return None  # off all day
    start = datetime.combine(day, _hhmm(times["on"]))
    end = datetime.combine(day, _hhmm(times["off"]))
    if end <= start:
        end += timedelta(days=1)  # runs past midnight
    return start, end


def _windows(schedule: dict, around: datetime):
    for offset in range(-1, LOOKAHEAD_DAYS):
        w = _window(schedule, around.date() + timedelta(days=offset))
        if w is not None:
            yield w


def should_be_on(schedule: dict, now: datetime) -> bool:
    if not schedule.get("enabled"):
        return False
    return any(start <= now < end for start, end in _windows(schedule, now))


def next_change(schedule: dict, now: datetime) -> tuple[datetime, bool] | None:
    """The next time the schedule switches the display, and whether that turns it on."""
    if not schedule.get("enabled"):
        return None
    current = should_be_on(schedule, now)
    times = sorted({t for w in _windows(schedule, now) for t in w if t > now})
    for t in times:
        if should_be_on(schedule, t) != current:
            return t, not current
    return None


class ScheduleRunner:
    """Switches the output between Play and Blackout at the schedule's times. Only acts when the
    schedule's state changes, so switching by hand holds until the next scheduled change."""

    def __init__(self, show, settings, clock: Callable[[], datetime], poll_seconds: float):
        self.show, self.settings, self.clock, self.poll = show, settings, clock, poll_seconds
        self._applied: bool | None = None  # the state last switched to

    def restart(self) -> None:
        """The schedule changed: apply its current state on the next check."""
        self._applied = None

    def check(self) -> None:
        schedule = self.settings.schedule()
        if not schedule.get("enabled"):
            self._applied = None
            return
        on = should_be_on(schedule, self.clock())
        if on == self._applied:
            return
        self._applied = on
        if on:
            self.show.present(mode="play", blackout=False)
        else:
            self.show.present(blackout=True)

    async def run(self) -> None:
        while True:
            self.check()
            await asyncio.sleep(self.poll)
