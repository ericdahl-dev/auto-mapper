"""Finds a manual exposure where the projector's white frame is bright but not clipped."""

from typing import Callable

import numpy as np

from engine.camera_lock import Uvc

# Exposure is in 100 µs units. Longer than one frame (~33 ms at 30 fps) can stall or be
# clamped by the camera, so the search stays within one frame period.
MAX_EXPOSURE = 330
CLIP_LEVEL = 250  # 99th-percentile brightness at or above this counts as clipped
MIN_RESPONSE = 10  # brightness must move at least this much across the exposure range
STALE_FRAMES = 2  # frames captured before the new exposure took effect
MAX_GAIN = 15  # AC410 range
TARGET_LEVEL = 180  # below this at the longest exposure, add gain (dark or distant surfaces)


class CalibrationError(Exception):
    pass


def calibrate_exposure(uvc: Uvc, read_frame: Callable[[], np.ndarray]) -> dict:
    def brightness_at(exposure: int) -> float:
        uvc.set("exposure-time-abs", str(exposure))
        for _ in range(STALE_FRAMES):
            read_frame()
        return float(np.percentile(read_frame(), 99))

    uvc.set("gain", "0")
    darkest, brightest = brightness_at(1), brightness_at(MAX_EXPOSURE)
    if brightest - darkest < MIN_RESPONSE:
        raise CalibrationError(
            "Camera brightness did not respond to exposure changes. The preview camera and the "
            "camera being controlled may be different devices, or the lens is covered."
        )
    if darkest >= CLIP_LEVEL:
        raise CalibrationError("White frame clips even at the shortest exposure. Dim the projector or the room.")
    if brightest < CLIP_LEVEL:
        return _add_gain(uvc, read_frame, brightest)

    lo, hi = 1, MAX_EXPOSURE  # brightness(lo) < CLIP_LEVEL <= brightness(hi)
    best = darkest
    while hi - lo > 1:
        mid = (lo + hi) // 2
        level = brightness_at(mid)
        if level < CLIP_LEVEL:
            lo, best = mid, level
        else:
            hi = mid
    return {"exposure": lo, "gain": 0, "p99": best}


def _add_gain(uvc: Uvc, read_frame: Callable[[], np.ndarray], level: float) -> dict:
    """At the longest exposure, raise gain until the white frame is bright enough, without clipping."""
    best = {"exposure": MAX_EXPOSURE, "gain": 0, "p99": level}
    for gain in range(1, MAX_GAIN + 1):
        if best["p99"] >= TARGET_LEVEL:
            break
        uvc.set("gain", str(gain))
        for _ in range(STALE_FRAMES):
            read_frame()
        level = float(np.percentile(read_frame(), 99))
        if level >= CLIP_LEVEL:
            break
        best = {"exposure": MAX_EXPOSURE, "gain": gain, "p99": level}
    return best
