"""Runs a scan: projects every pattern in lockstep with the output window and captures it."""

import time
from pathlib import Path
from typing import Callable

import numpy as np

from engine.calibrate import MIN_RESPONSE, calibrate_exposure
from engine.camera_lock import Uvc, locked_camera
from engine.scan import DecodeResult, GrayDecoder, pattern_sequence


class ScanError(Exception):
    pass


class ScanCancelled(Exception):
    pass


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
    cancelled: Callable[[], bool] = lambda: False,
    frames_per_pattern: int = 1,
) -> tuple[DecodeResult, dict]:
    seq = pattern_sequence(width, height)
    decoder = GrayDecoder(width, height)
    with locked_camera(uvc, data_dir):
        if calibration is None:
            show({"kind": "white"})
            calibration = calibrate_exposure(uvc, read_frame)
        # Calibration leaves the camera at whatever it probed last; set the chosen values.
        uvc.set("gain", str(calibration["gain"]))
        uvc.set("exposure-time-abs", str(calibration["exposure"]))

        for i, pattern in enumerate(seq, 1):
            if cancelled():
                raise ScanCancelled()
            show(pattern)
            time.sleep(settle_seconds)  # projector input lag beyond the browser's frame
            for _ in range(drop_frames):  # frames already buffered before the pattern changed
                read_frame()
            # Averaging several frames of the same pattern cuts sensor noise (~1/sqrt(n)).
            frame = np.mean([read_frame().astype(np.float32) for _ in range(frames_per_pattern)], axis=0)
            decoder.add(pattern, frame)
            if pattern["kind"] == "black":
                # Per-pixel difference: lamps or windows saturated in both frames must not
                # mask a projector that is working everywhere else.
                diff = decoder.white.astype(np.int16) - frame.astype(np.int16)
                spread = np.percentile(diff, 99)
                if spread < MIN_RESPONSE:
                    raise ScanError(
                        "White and black frames look the same to the camera. Check the camera "
                        "sees the projection, or increase the scan settle time."
                    )
            progress(i, len(seq))
    return decoder.result(), calibration
