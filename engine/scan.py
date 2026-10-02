"""Gray-code structured light: pattern definitions and decoding.

Pattern for bit k on an axis: value at coordinate c is bit k of gray(c) = c ^ (c >> 1),
so bit k has a stripe period of 2**(k+1). frontend/src/output/patterns.ts mirrors this.
"""

import math
from dataclasses import dataclass

import numpy as np


def bits_for(size: int) -> int:
    return max(1, math.ceil(math.log2(size)))


def gray_code_stripe(size: int, bit: int) -> np.ndarray:
    c = np.arange(size)
    return ((c ^ (c >> 1)) >> bit) & 1


def pattern_sequence(width: int, height: int) -> list[dict]:
    seq: list[dict] = [{"kind": "white"}, {"kind": "black"}]
    for axis, size in (("x", width), ("y", height)):
        for bit in reversed(range(bits_for(size))):
            for inverse in (False, True):
                seq.append({"kind": "gray", "axis": axis, "bit": bit, "inverse": inverse})
    return seq


MIN_CONTRAST = 20  # white minus black (gray levels) for a camera pixel to count as lit
MIN_BIT_DIFF = 6  # pattern minus inverse must exceed this...
BIT_DIFF_FRACTION = 0.15  # ...and this fraction of the pixel's white-black contrast
MAX_UNRELIABLE_LOW_BITS = 3  # finest bits the camera may fail to resolve before a pixel is dropped


@dataclass
class DecodeResult:
    proj_x: np.ndarray  # int32 per camera pixel, -1 where invalid
    proj_y: np.ndarray
    valid: np.ndarray  # bool per camera pixel
    white: np.ndarray  # camera frame under full white, BGR
    black: np.ndarray
    bit_reliability: dict[str, dict[int, float]]  # axis -> bit -> fraction of lit pixels read clearly
    width: int  # projector size
    height: int


def _gray(frame: np.ndarray) -> np.ndarray:
    return frame.astype(np.float32).mean(axis=2) if frame.ndim == 3 else frame.astype(np.float32)


def _gray_to_binary(g: np.ndarray) -> np.ndarray:
    b = g.copy()
    shift = g >> 1
    while shift.any():
        b ^= shift
        shift >>= 1
    return b


class _Axis:
    def __init__(self, size: int, shape: tuple[int, int]):
        self.size, self.bits = size, bits_for(size)
        self.code = np.zeros(shape, np.int32)
        self.still_reliable = np.ones(shape, bool)
        self.reliable_bits = np.zeros(shape, np.int32)
        self.reliability: dict[int, float] = {}


def _refine(values: np.ndarray, valid: np.ndarray, unknown: np.ndarray, coarse: dict) -> np.ndarray:
    """Recovers sub-stripe positions when the finest stripes were too thin for the camera.

    Projector coordinates change smoothly across the camera image, so averaging the
    coarse (interval-centre) values of neighbouring camera pixels lands between stripe
    edges. The window spans about one unresolved stripe, measured in camera pixels.
    """
    import cv2

    if not valid.any():
        return np.full(values.shape, -1, np.int32)
    k = int(unknown[valid].max())
    if k == 0:
        return np.where(valid, values, -1).astype(np.int32)
    xs, ys = coarse["x"][valid], coarse["y"][valid]
    proj_area = max(1.0, float(np.ptp(xs) * np.ptp(ys)))
    cam_per_proj = np.sqrt(valid.sum() / proj_area)
    sigma = max(1.0, 0.5 * (1 << k) * cam_per_proj)
    w = valid.astype(np.float32)
    num = cv2.GaussianBlur(np.where(valid, values, 0).astype(np.float32), (0, 0), sigma)
    den = cv2.GaussianBlur(w, (0, 0), sigma)
    refined = np.where(den > 1e-3, num / np.maximum(den, 1e-3), -1)
    return np.where(valid, np.round(refined), -1).astype(np.int32)


class GrayDecoder:
    """Decodes captures incrementally, so only the reference frames are kept in memory.

    Feed frames in pattern_sequence order. Bits are read MSB first; once a bit can't be
    read clearly, it and all finer bits are zeroed, which bounds the error to the stripe
    width of the first unreadable bit instead of throwing the pixel away.
    """

    def __init__(self, width: int, height: int):
        self.width, self.height = width, height
        self.white: np.ndarray | None = None
        self.black: np.ndarray | None = None
        self._axes: dict[str, _Axis] = {}
        self._pending: np.ndarray | None = None

    def add(self, pattern: dict, frame: np.ndarray) -> None:
        kind = pattern["kind"]
        if kind == "white":
            self.white = frame
        elif kind == "black":
            self.black = frame
            contrast = _gray(self.white) - _gray(self.black)
            self._lit = contrast > MIN_CONTRAST
            self._threshold = np.maximum(MIN_BIT_DIFF, BIT_DIFF_FRACTION * contrast)
            shape = self._lit.shape
            self._axes = {"x": _Axis(self.width, shape), "y": _Axis(self.height, shape)}
        elif not pattern["inverse"]:
            self._pending = _gray(frame)
        else:
            self._add_bit(self._axes[pattern["axis"]], pattern["bit"], self._pending - _gray(frame))
            self._pending = None

    def _add_bit(self, axis: _Axis, bit: int, diff: np.ndarray) -> None:
        clear = np.abs(diff) > self._threshold
        axis.reliability[bit] = float(clear[self._lit].mean()) if self._lit.any() else 0.0
        axis.still_reliable &= clear
        on = (diff > 0) & axis.still_reliable
        axis.code |= on.astype(np.int32) << bit
        axis.reliable_bits += axis.still_reliable

    def result(self) -> DecodeResult:
        coarse, unknown, valid = {}, {}, self._lit.copy()
        for name, axis in self._axes.items():
            k = np.clip(axis.bits - axis.reliable_bits, 0, None)  # unreadable low bits per pixel
            base = (_gray_to_binary(axis.code) >> k) << k
            # Centre of the interval the unreadable bits leave open.
            coarse[name] = base + ((1 << k) - 1) / 2.0
            unknown[name] = k
            valid &= (k <= MAX_UNRELIABLE_LOW_BITS) & (base < axis.size)
        coords = {name: _refine(coarse[name], valid, unknown[name], coarse) for name in coarse}
        for name, axis in self._axes.items():
            valid &= (coords[name] >= 0) & (coords[name] < axis.size)
        return DecodeResult(
            proj_x=np.where(valid, coords["x"], -1),
            proj_y=np.where(valid, coords["y"], -1),
            valid=valid,
            white=self.white,
            black=self.black,
            bit_reliability={name: axis.reliability for name, axis in self._axes.items()},
            width=self.width,
            height=self.height,
        )


HOLE_CLOSE_PX = 9  # camera has fewer pixels than the projector, and coarse decodes leave specks
COVERAGE_BLOCK = 8


def projector_space_image(r: DecodeResult) -> tuple[np.ndarray, np.ndarray]:
    """Re-projects the white reference frame into projector pixels.

    Returns the image and a mask of projector pixels that have data (decoded, or a small
    gap between decoded pixels that was filled in).
    """
    import cv2

    h, w = r.height, r.width
    sums = np.zeros((h, w, 3), np.float64)
    counts = np.zeros((h, w), np.int32)
    ys, xs = r.proj_y[r.valid], r.proj_x[r.valid]
    np.add.at(sums, (ys, xs), r.white[r.valid].astype(np.float64))
    np.add.at(counts, (ys, xs), 1)
    hit = counts > 0
    img = np.zeros((h, w, 3), np.uint8)
    img[hit] = (sums[hit] / counts[hit, None]).astype(np.uint8)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (HOLE_CLOSE_PX, HOLE_CLOSE_PX))
    covered = cv2.morphologyEx(hit.astype(np.uint8), cv2.MORPH_CLOSE, kernel).astype(bool)
    holes = covered & ~hit
    if holes.any():
        img = cv2.inpaint(img, holes.astype(np.uint8), 3, cv2.INPAINT_TELEA)
    img[~covered] = 0
    return img, covered


def block_coverage(covered: np.ndarray, block: int = COVERAGE_BLOCK) -> float:
    """Fraction of block x block projector tiles with any decoded pixel."""
    h, w = covered.shape
    bh, bw = -(-h // block), -(-w // block)
    padded = np.zeros((bh * block, bw * block), bool)
    padded[:h, :w] = covered
    tiles = padded.reshape(bh, block, bw, block).any(axis=(1, 3))
    return float(tiles.mean())
