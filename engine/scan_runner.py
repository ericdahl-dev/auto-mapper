"""Runs a scan: projects every pattern in lockstep with the output window and captures it."""

import math
import time
from pathlib import Path
from typing import Callable

import numpy as np

from engine.calibrate import MAX_EXPOSURE, MAX_GAIN, MIN_RESPONSE, calibrate_exposure
from engine.camera_lock import Uvc, locked_camera
from engine.scan import DecodeResult, HdrDecoder, pattern_sequence


class ScanError(Exception):
    pass


class ScanCanceled(Exception):
    pass


HDR_STEPS = {1: [1], 2: [1, 4], 3: [1, 3, 9]}  # exposure multiples per HDR setting


GAIN_TRIPLES = 15  # AC410: gain 15 brightens about as much as 3x the exposure (calibrate.py)


def hdr_captures(calibration: dict, hdr: int) -> list[tuple[int, int]]:
    """The (exposure, gain) settings each pattern is captured at (#66): the calibrated one first,
    then brighter ones for dark surfaces. Longer exposures first; past the camera's longest, the rest
    of the step is gain (a dim room calibrates there already). Capped, without repeats."""
    e0, g0 = calibration["exposure"], calibration.get("gain", 0)
    out: list[tuple[int, int]] = []
    for k in HDR_STEPS.get(hdr, [1]):
        exposure = min(MAX_EXPOSURE, int(round(e0 * k)))
        rest = e0 * k / exposure  # what a longer exposure couldn't give
        gain = g0 if rest <= 1.0001 else min(MAX_GAIN, g0 + int(round(GAIN_TRIPLES * math.log(rest) / math.log(3))))
        if (exposure, gain) not in out:
            out.append((exposure, gain))
    return out


def capture_scan(
    *,
    show: Callable[[dict], None],  # blocks until the output confirms the pattern is on screen
    read_frame: Callable[[], np.ndarray],
    uvc: Uvc,
    data_dir: Path,
    width: int,
    height: int,
    calibration: dict | None,
    progress: Callable[[int, int], None],
    settle_seconds: float,
    drop_frames: int,
    canceled: Callable[[], bool] = lambda: False,
    frames_per_pattern: int = 1,
    hdr: int = 1,  # exposures per pattern (#66): 1 = off
) -> tuple[DecodeResult, dict]:
    seq = pattern_sequence(width, height)
    with locked_camera(uvc, data_dir):
        if calibration is None:
            show({"kind": "white"})
            calibration = calibrate_exposure(uvc, read_frame)
        # Calibration leaves the camera at whatever it probed last; set the chosen values.
        uvc.set("gain", str(calibration["gain"]))
        uvc.set("exposure-time-abs", str(calibration["exposure"]))
        captures = hdr_captures(calibration, hdr)
        # Roughly how much brighter each capture is (see HdrDecoder: it needn't be exact).
        e0, _ = captures[0]
        decoder = HdrDecoder(width, height, [e / e0 * 3 ** ((g - captures[0][1]) / GAIN_TRIPLES) for e, g in captures])

        for i, pattern in enumerate(seq, 1):
            if canceled():
                raise ScanCanceled()
            show(pattern)
            time.sleep(settle_seconds)  # projector input lag beyond the browser's frame
            for _ in range(drop_frames):  # frames already buffered before the pattern changed
                read_frame()
            frames = []
            for n, (exposure, gain) in enumerate(captures):
                if len(captures) > 1:  # HDR: the same pattern at each setting in turn
                    uvc.set("exposure-time-abs", str(exposure))
                    uvc.set("gain", str(gain))
                    if n:
                        time.sleep(settle_seconds)
                    for _ in range(drop_frames):  # frames taken before the new exposure applied
                        read_frame()
                # Averaging several frames of the same pattern cuts sensor noise (~1/sqrt(n)).
                frames.append(np.mean([read_frame().astype(np.float32) for _ in range(frames_per_pattern)], axis=0))
            if pattern["kind"] == "white":
                first_white = frames[0]
            decoder.add(pattern, frames)
            if pattern["kind"] == "black":
                # Per-pixel difference: lamps or windows saturated in both frames must not
                # mask a projector that is working everywhere else.
                diff = first_white.astype(np.int16) - frames[0].astype(np.int16)
                spread = np.percentile(diff, 99)
                if spread < MIN_RESPONSE:
                    raise ScanError(
                        "White and black frames look the same to the camera. Check the camera "
                        "sees the projection, or increase the scan settle time."
                    )
            progress(i, len(seq))
    return decoder.result(), calibration
