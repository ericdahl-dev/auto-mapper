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
NOTCH_CLOSE_FRACTION = 0.06  # notch filling, as a fraction of the region's typical size
NOTCH_CLOSE_MIN, NOTCH_CLOSE_MAX = 9, 41  # px
HULL_SOLIDITY = 0.9  # regions at least this convex are outlined by their convex hull


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
    """Outline of a region as a polygon with few, straight sides.

    Edge detection leaves notches along real straight edges. A closing sized to the
    region fills them (closing keeps convex corners sharp), then a coarse simplification
    turns each straight run into a single side.
    """
    mask = mask.astype(np.uint8)
    size = int(np.sqrt(max(int(mask.sum()), 1)) * NOTCH_CLOSE_FRACTION)
    size = int(np.clip(size, NOTCH_CLOSE_MIN, NOTCH_CLOSE_MAX)) | 1
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
    padded = cv2.copyMakeBorder(mask, size, size, size, size, cv2.BORDER_CONSTANT, value=0)
    closed = cv2.morphologyEx(padded, cv2.MORPH_CLOSE, k)[size:-size, size:-size]
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return []
    contour = max(contours, key=cv2.contourArea)
    hull = cv2.convexHull(contour)
    if cv2.contourArea(contour) >= HULL_SOLIDITY * cv2.contourArea(hull):
        contour = hull  # nearly convex: the dents are noise, not shape
    eps = max(1.5, SIMPLIFY_FRACTION * cv2.arcLength(contour, True))
    return cv2.approxPolyDP(contour, eps, True).reshape(-1, 2).tolist()
