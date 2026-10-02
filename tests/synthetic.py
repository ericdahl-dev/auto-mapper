"""Synthetic projector + camera scene with a known camera->projector mapping.

A wall seen through one homography, plus a "box" region seen through a different one
(a depth step), so decoded coordinates jump at the box edge like a real object.
"""

import numpy as np

from engine.scan import gray_code_stripe


def homography(src, dst) -> np.ndarray:
    import cv2

    return cv2.getPerspectiveTransform(np.float32(src), np.float32(dst))


class Scene:
    def __init__(self, proj_w=256, proj_h=144, cam_w=320, cam_h=240, unresolved_bits=0, noise=2.0, seed=0):
        self.proj_w, self.proj_h, self.cam_w, self.cam_h = proj_w, proj_h, cam_w, cam_h
        self.unresolved_bits = unresolved_bits
        self.noise = noise
        self.rng = np.random.default_rng(seed)
        self.exposure_gain = 1.0
        self.pattern: dict = {"kind": "black"}

        # Projection lands inside the camera view with some keystone.
        corners = [(0, 0), (proj_w, 0), (proj_w, proj_h), (0, proj_h)]
        wall = homography([(40, 30), (290, 45), (280, 215), (35, 200)], corners)
        box = homography([(30, 20), (290, 40), (285, 220), (25, 205)], corners)  # same plane, shifted by depth
        v, u = np.mgrid[0:cam_h, 0:cam_w].astype(np.float64)
        self.box_region = (u >= 190) & (u < 250) & (v >= 130) & (v < 190)
        x, y = self._apply(wall, u, v)
        bx, by = self._apply(box, u, v)
        x = np.where(self.box_region, bx, x)
        y = np.where(self.box_region, by, y)
        self.lit = (x >= 0) & (x < proj_w) & (y >= 0) & (y < proj_h)
        self.true_x = np.where(self.lit, np.floor(x), -1).astype(np.int32)
        self.true_y = np.where(self.lit, np.floor(y), -1).astype(np.int32)
        self.albedo = np.where(self.box_region, 0.9, 0.75)

    @staticmethod
    def _apply(h, u, v):
        d = h[2, 0] * u + h[2, 1] * v + h[2, 2]
        return (h[0, 0] * u + h[0, 1] * v + h[0, 2]) / d, (h[1, 0] * u + h[1, 1] * v + h[1, 2]) / d

    def projector_value(self, pattern: dict) -> np.ndarray:
        """Projector intensity (0..1) arriving at each camera pixel for a pattern."""
        if pattern["kind"] == "white":
            return self.lit.astype(np.float64)
        if pattern["kind"] in ("black", "grid"):
            return np.zeros(self.lit.shape)
        if pattern["bit"] < self.unresolved_bits:  # stripes finer than the camera can resolve
            return np.where(self.lit, 0.5, 0.0)
        size = self.proj_w if pattern["axis"] == "x" else self.proj_h
        coord = self.true_x if pattern["axis"] == "x" else self.true_y
        stripe = gray_code_stripe(size, pattern["bit"])
        on = np.where(self.lit, stripe[np.clip(coord, 0, size - 1)], 0)
        return (1 - on if pattern["inverse"] else on) * self.lit

    def frame(self, pattern: dict | None = None) -> np.ndarray:
        light = self.projector_value(pattern or self.pattern)
        level = 12 + 200 * self.exposure_gain * self.albedo * light
        level = level + self.rng.normal(0, self.noise, level.shape)
        gray = np.clip(level, 0, 255).astype(np.uint8)
        return np.dstack([gray, gray, gray])
