"""How well the projection fills the camera frame (#149).

The more of the frame the projection spans, the more camera pixels each stripe lands on, and the
finer the stripes a scan can decode. Measured from the camera's view of a white and a black frame
on the projector: what the projector lights is what got brighter.
"""

from dataclasses import dataclass

import cv2
import numpy as np

LIT_LEVEL = 30  # white minus black: at least this much brighter counts as lit by the projector
EDGE = 2  # px: lit within this of the frame's edge means the projection runs off it
EDGE_SHARE = 0.02  # ...along at least this share of an edge (not a stray bright pixel)
GOOD_SPAN = 0.7  # spans at least this share of the frame: framed well enough


@dataclass
class Framing:
    span: float  # the share of the frame the projection spans, the larger of width and height
    cut_off: bool  # part of the projection is outside the frame
    outline: list[tuple[float, float]]  # the lit area's outline, as shares of the frame's width and height

    def advice(self) -> str | None:
        """What to change, in the editor's words; None when it's framed well."""
        if not self.outline:
            return "The camera doesn't see the projection: point it at the lit area."
        if self.cut_off:
            return "Part of the projection is outside the camera's view: zoom out or move the camera back."
        if self.span < GOOD_SPAN:
            return (f"The projection fills {round(self.span * 100)}% of the camera's view: "
                    "zoom in or move the camera closer for a finer scan.")
        return None

    def to_dict(self) -> dict:
        return {"span": self.span, "cut_off": self.cut_off, "outline": [list(p) for p in self.outline],
                "advice": self.advice()}


def measure_framing(white: np.ndarray, black: np.ndarray) -> Framing:
    gray = lambda img: img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)  # noqa: E731
    diff = cv2.subtract(gray(white), gray(black))
    lit = (diff >= LIT_LEVEL).astype(np.uint8)
    lit = cv2.morphologyEx(lit, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))  # drop speckle noise
    h, w = lit.shape
    contours, _ = cv2.findContours(lit, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return Framing(span=0.0, cut_off=False, outline=[])
    hull = cv2.convexHull(np.concatenate(contours))
    x, y, bw, bh = cv2.boundingRect(hull)
    edges = [lit[:EDGE, :], lit[-EDGE:, :], lit[:, :EDGE].T, lit[:, -EDGE:].T]
    cut_off = any(e.any(axis=0).mean() >= EDGE_SHARE for e in edges)
    outline = [(float(px) / w, float(py) / h) for px, py in hull.reshape(-1, 2)]
    return Framing(span=max(bw / w, bh / h), cut_off=bool(cut_off), outline=outline)
