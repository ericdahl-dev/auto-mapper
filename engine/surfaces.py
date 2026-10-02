"""Finds surfaces (walls, boxes, objects) in a scan and outlines them as projector-space polygons.

Two kinds of boundary separate surfaces:
- depth edges: neighbouring camera pixels whose projector coordinates jump, because the
  projector and camera see a step in depth from different angles (parallax). This works
  even when both surfaces are the same colour.
- colour/brightness edges in the scan image.
Areas the camera could not see at all (shadows, occlusion) are boundaries too.
"""

import cv2
import numpy as np

from engine.scan import DecodeResult

DEPTH_JUMP_FACTOR = 3.0  # a camera step this many times the typical one is a depth edge
DEPTH_JUMP_MIN = 2.5  # camera px; ignore jumps smaller than this whatever the median
DEPTH_HYSTERESIS = 0.6  # weaker jumps count if connected to a strong one
MIN_DECODE_DENSITY = 0.2  # fraction of projector pixels with a decoded camera sample, locally
DENSITY_SIGMA = 6
MIN_DEPTH_EDGE_PX = 40  # tuned on a real room: 99% of noise fragments were under 13 px
FILL_SIGMA = 1.5  # projector px; spreads sparse camera samples across empty projector pixels
CANNY_LOW, CANNY_HIGH = 6, 16  # tuned on the rig: a light box against a light wall is subtle
BLUR_PX = 3  # smooth speckle before colour edges
EDGE_DILATE_PX = 7  # tuned on the rig: bridges gaps in faint colour edges
MIN_AREA_FRACTION = 0.003  # of the projector area
SIMPLIFY_FRACTION = 0.015  # polygon tolerance, as a fraction of its perimeter
SLIT_CLOSE_PX = 15  # gaps narrower than this inside a region are sealed; wider bends are kept
HULL_SOLIDITY = 0.97  # only truly convex regions are outlined by their hull (keeps inward curves)
CURVE_PX = 3.0  # a side whose smoothed deviation from straight exceeds this is a curve
CURVE_FIT = 0.15  # ...and a cubic explains it: leftover below this share of the bend (real edges meander)
CURVE_SMOOTH_PX = 2.0  # smoothing along a curved run before simplifying it
CURVE_EPS_PX = 1.5  # simplification tolerance on curved runs


def depth_edges(decoded: DecodeResult) -> np.ndarray:
    """Projector-space mask of depth discontinuities.

    Neighbouring projector pixels on the same surface are seen by neighbouring camera
    pixels. Across a depth step, parallax makes the camera position jump.
    """
    h, w = decoded.height, decoded.width
    v, u = np.nonzero(decoded.valid)
    px, py = decoded.proj_x[v, u], decoded.proj_y[v, u]
    sums = np.zeros((2, h, w), np.float32)
    counts = np.zeros((h, w), np.float32)
    np.add.at(sums[0], (py, px), u)
    np.add.at(sums[1], (py, px), v)
    np.add.at(counts, (py, px), 1)
    # The camera usually has fewer pixels than the projector: fill the gaps between samples.
    den = cv2.GaussianBlur(counts, (0, 0), FILL_SIGMA)
    seen = den > 0.2
    cam = [np.where(seen, cv2.GaussianBlur(sums[i], (0, 0), FILL_SIGMA) / np.maximum(den, 1e-6), 0) for i in (0, 1)]
    # Isolated decode errors look like jumps too; a median removes them but keeps real steps.
    cam = [cv2.medianBlur(c.astype(np.float32), 5) for c in cam]

    step = np.zeros((h, w), np.float32)
    ok = np.zeros((h, w), bool)
    for axis in (0, 1):
        du, dv = (np.diff(c, axis=axis) for c in cam)
        pair = seen[:-1, :] & seen[1:, :] if axis == 0 else seen[:, :-1] & seen[:, 1:]
        pad = ((0, 1), (0, 0)) if axis == 0 else ((0, 0), (0, 1))
        step = np.maximum(step, np.pad(np.where(pair, np.hypot(du, dv), 0), pad))
        ok |= np.pad(pair, pad)
    if not ok.any():
        return np.zeros((h, w), bool)
    threshold = max(DEPTH_JUMP_MIN, DEPTH_JUMP_FACTOR * float(np.median(step[ok])))
    # Hysteresis: parallax is weak for edges running along the camera-projector baseline,
    # so keep weaker jumps when they connect to a clear one.
    strong = ok & (step > threshold)
    weak = ok & (step > DEPTH_HYSTERESIS * threshold)
    count, labels = cv2.connectedComponents(weak.astype(np.uint8), connectivity=8)
    keep = np.zeros(count, bool)
    keep[np.unique(labels[strong])] = True
    keep[0] = False
    edges = keep[labels]
    # Where decoding is sparse (dark or distant surfaces), decode errors look like jumps
    # everywhere. Ignore those areas, and keep only line-sized edges, not speckle.
    density = cv2.GaussianBlur((counts > 0).astype(np.float32), (0, 0), DENSITY_SIGMA)
    edges &= density >= MIN_DECODE_DENSITY
    count, labels, stats, _ = cv2.connectedComponentsWithStats(edges.astype(np.uint8), connectivity=8)
    long_enough = stats[:, cv2.CC_STAT_AREA] >= MIN_DEPTH_EDGE_PX
    long_enough[0] = False
    return long_enough[labels]


def colour_edges(image: np.ndarray, covered: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (0, 0), BLUR_PX)
    edges = cv2.Canny(gray, CANNY_LOW, CANNY_HIGH).astype(bool)
    # Ignore the edge between the scan and the black uncovered area; that is handled separately.
    inner = cv2.erode(covered.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    return edges & inner


def detect_surfaces(decoded: DecodeResult, view: tuple[np.ndarray, np.ndarray]) -> list[dict]:
    image, covered = view
    h, w = covered.shape
    # Unseen areas (camera shadow) are boundaries too, grown with the edges so the
    # edge lines and shadow strips join up without leaks at the corners.
    boundary = depth_edges(decoded) | colour_edges(image, covered) | ~covered
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * EDGE_DILATE_PX + 1, 2 * EDGE_DILATE_PX + 1))
    boundary = cv2.dilate(boundary.astype(np.uint8), k).astype(bool)

    free = (covered & ~boundary).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
    min_area = MIN_AREA_FRACTION * w * h
    surfaces = []
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] < min_area:
            continue
        # Grow back over the boundary band so neighbouring surfaces meet.
        mask = cv2.dilate((labels == label).astype(np.uint8), k) & covered.astype(np.uint8)
        poly = outline_polygon(mask)
        if len(poly) < 3:
            continue
        surfaces.append({"polygon": poly, "area": float(cv2.contourArea(np.int32(poly)))})
    surfaces.sort(key=lambda s: s["area"], reverse=True)
    return surfaces


def outline_polygon(mask: np.ndarray) -> list[list[int]]:
    """Outline of a region: straight sides stay single lines, curved sides follow the curve.

    A coarse simplification gives the region's main sides. For each side, the true contour's
    deviation from the straight side is smoothed over a tenth of the side's length: edge
    noise and notches average out, a real bend does not. Sides that still bend by more than
    CURVE_PX are replaced by the finely simplified contour.
    """
    # Seal narrow slits (grooves widened by edge dilation) without flattening wide curves.
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (SLIT_CLOSE_PX, SLIT_CLOSE_PX))
    pad = SLIT_CLOSE_PX
    padded = cv2.copyMakeBorder(mask.astype(np.uint8), pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0)
    mask = cv2.morphologyEx(padded, cv2.MORPH_CLOSE, k)[pad:-pad, pad:-pad]
    contour = _largest_contour(mask)
    if contour is None:
        return []
    hull = cv2.convexHull(contour)
    if cv2.contourArea(contour) >= HULL_SOLIDITY * cv2.contourArea(hull):
        # Truly convex: dents are noise. Re-trace the hull densely so curves can still be followed.
        filled = np.zeros_like(mask)
        cv2.fillPoly(filled, [hull], 1)
        contour = _largest_contour(filled)
    pts = contour.reshape(-1, 2)
    n = len(pts)
    eps = max(1.5, SIMPLIFY_FRACTION * cv2.arcLength(contour, True))
    corners = cv2.approxPolyDP(contour, eps, True).reshape(-1, 2)
    index = {}
    for i, (x, y) in enumerate(pts):
        index.setdefault((int(x), int(y)), i)
    idx = sorted(index[(int(x), int(y))] for x, y in corners)

    out: list[list[int]] = []
    for a, b in zip(idx, idx[1:] + [idx[0] + n]):
        side = pts[[i % n for i in range(a, b + 1)]].astype(np.float64)
        out.append(side[0].round().astype(int).tolist())
        if len(side) > 4 and _bends(side):
            smooth = _smooth_open(side, CURVE_SMOOTH_PX)
            fine = cv2.approxPolyDP(smooth.astype(np.float32).reshape(-1, 1, 2), CURVE_EPS_PX, False).reshape(-1, 2)
            out.extend(p.round().astype(int).tolist() for p in fine[1:-1])
    return out


def _largest_contour(mask: np.ndarray):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    return max(contours, key=cv2.contourArea) if contours else None


def _bends(side: np.ndarray) -> bool:
    """True if a contour run between two corners is a real curve, not noise on a straight side.

    A curve's offset from the straight side follows a smooth arc that a cubic explains
    almost exactly; notches and wobble are spikes a cubic can't follow. Offsets are taken
    once per pixel along the side, so a notch's wrapped-round contour doesn't outvote it.
    """
    a, b = side[0], side[-1]
    d = b - a
    length = float(np.hypot(*d))
    if length < 8:
        return False
    deviation = ((side[:, 0] - a[0]) * d[1] - (side[:, 1] - a[1]) * d[0]) / length
    along = ((side[:, 0] - a[0]) * d[0] + (side[:, 1] - a[1]) * d[1]) / length
    bins = np.clip(along.round().astype(int), 0, int(length))
    total = np.bincount(bins, weights=deviation, minlength=int(length) + 1)
    count = np.bincount(bins, minlength=int(length) + 1)
    x = np.nonzero(count)[0]
    y = total[x] / count[x]
    fit = np.polyval(np.polyfit(x / length, y, 3), x / length)
    bend = float(np.abs(fit).max())
    leftover = float(np.sqrt(np.mean((y - fit) ** 2)))
    return bend > CURVE_PX and leftover < CURVE_FIT * bend


def _smooth_open(side: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian smoothing along a contour run, keeping its two end corners fixed."""
    smooth = np.column_stack([
        cv2.GaussianBlur(side[:, i].reshape(-1, 1), (1, 0), sigma, borderType=cv2.BORDER_REPLICATE).ravel()
        for i in (0, 1)
    ])
    smooth[0], smooth[-1] = side[0], side[-1]
    return smooth
