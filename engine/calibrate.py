"""Finds a manual exposure where the projector's white frame is bright but not clipped."""

from typing import Callable

import numpy as np

from engine.camera_lock import Uvc

# Exposure is in 100 µs units. Exposures longer than a frame slow the camera down (100 ms
# ~ 10 fps) but brighten without the noise that gain adds; scans don't need speed.
# Measured on the AC410 at 4K: 100 ms at gain 0 was as bright as 33 ms at gain 15.
MAX_EXPOSURE = 1000  # every camera allows this; longer is used where the camera accepts it
LONGER_EXPOSURES = (3000, 2000)  # 300 ms, 200 ms: tried first; scans don't need speed
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
    longest = longest_exposure(uvc)
    darkest, brightest = brightness_at(1), brightness_at(longest)
    if brightest - darkest < MIN_RESPONSE:
        raise CalibrationError(
            "Camera brightness did not respond to exposure changes. The preview camera and the "
            "camera being controlled may be different devices, or the lens is covered."
        )
    if darkest >= CLIP_LEVEL:
        raise CalibrationError("White frame clips even at the shortest exposure. Dim the projector or the room.")
    if brightest < CLIP_LEVEL:
        return {**_add_gain(uvc, read_frame, brightest, longest), "max_exposure": longest}

    lo, hi = 1, longest  # brightness(lo) < CLIP_LEVEL <= brightness(hi)
    best = darkest
    while hi - lo > 1:
        mid = (lo + hi) // 2
        level = brightness_at(mid)
        if level < CLIP_LEVEL:
            lo, best = mid, level
        else:
            hi = mid
    return {"exposure": lo, "gain": 0, "p99": best, "max_exposure": longest}


def longest_exposure(uvc: Uvc) -> int:
    """The longest exposure this camera accepts, up to 300 ms (UvcUtil reports a clamped value)."""
    for exposure in getattr(uvc, "longer_exposures", LONGER_EXPOSURES):  # still cameras: seconds
        try:
            uvc.set("exposure-time-abs", str(exposure))
            return exposure
        except RuntimeError:
            continue
    return MAX_EXPOSURE


def _add_gain(uvc: Uvc, read_frame: Callable[[], np.ndarray], level: float, longest: int = MAX_EXPOSURE) -> dict:
    """At the longest exposure, raise gain until the white frame is bright enough, without clipping."""
    best = {"exposure": longest, "gain": 0, "p99": level}
    for gain in range(1, MAX_GAIN + 1):
        if best["p99"] >= TARGET_LEVEL:
            break
        uvc.set("gain", str(gain))
        for _ in range(STALE_FRAMES):
            read_frame()
        level = float(np.percentile(read_frame(), 99))
        if level >= CLIP_LEVEL:
            break
        best = {"exposure": longest, "gain": gain, "p99": level}
    return best
