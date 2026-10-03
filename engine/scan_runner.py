"""Runs a scan: projects every pattern in lockstep with the output window and captures it."""

import time
from pathlib import Path
from typing import Callable

import numpy as np

from engine.calibrate import MAX_EXPOSURE, MIN_RESPONSE, calibrate_exposure
from engine.camera_lock import Uvc, locked_camera
from engine.scan import DecodeResult, HdrDecoder, pattern_sequence


class ScanError(Exception):
    pass


class ScanCanceled(Exception):
    pass


HDR_STEPS = {1: [1], 2: [1, 4], 3: [1, 3, 9]}  # exposure multiples per HDR setting


def hdr_exposures(calibrated: int, hdr: int) -> list[int]:
    """The exposures each pattern is captured at (#66): the calibrated one first, then longer ones
    for dark surfaces, capped at the camera's limit, without repeats."""
    out: list[int] = []
    for k in HDR_STEPS.get(hdr, [1]):
        e = min(MAX_EXPOSURE, int(round(calibrated * k)))
        if e not in out:
            out.append(e)
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
        exposures = hdr_exposures(calibration["exposure"], hdr)
        decoder = HdrDecoder(width, height, [e / exposures[0] for e in exposures])

        for i, pattern in enumerate(seq, 1):
            if canceled():
                raise ScanCanceled()
            show(pattern)
            time.sleep(settle_seconds)  # projector input lag beyond the browser's frame
            for _ in range(drop_frames):  # frames already buffered before the pattern changed
                read_frame()
            frames = []
            for n, exposure in enumerate(exposures):
                if len(exposures) > 1:  # HDR: the same pattern at each exposure in turn
                    uvc.set("exposure-time-abs", str(exposure))
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
