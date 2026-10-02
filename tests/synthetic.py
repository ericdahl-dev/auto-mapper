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
    def __init__(self, proj_w=256, proj_h=144, cam_w=320, cam_h=240, unresolved_bits=0, noise=2.0, seed=0,
                 box=True, box_albedo=0.9, wall_albedo=0.75, lamp=False):
        self.proj_w, self.proj_h, self.cam_w, self.cam_h = proj_w, proj_h, cam_w, cam_h
        self.unresolved_bits = unresolved_bits
        self.noise = noise
        self.rng = np.random.default_rng(seed)
        self.exposure_gain = 1.0
        self.pattern: dict = {"kind": "black"}

        # Projection lands inside the camera view with some keystone.
        corners = [(0, 0), (proj_w, 0), (proj_w, proj_h), (0, proj_h)]
        wall = homography([(40, 30), (290, 45), (280, 215), (35, 200)], corners)
        # The box is nearer the camera: parallax shifts it along the camera-projector
        # baseline, so its projector coordinates are the wall's, offset in camera space.
        shift = np.array([[1, 0, 12], [0, 1, 4], [0, 0, 1]], float)
        box_h = wall @ shift
        self._box_h = box_h
        v, u = np.mgrid[0:cam_h, 0:cam_w].astype(np.float64)
        self.box_rect = (190, 130, 250, 190)  # camera pixels: u0, v0, u1, v1
        u0, v0, u1, v1 = self.box_rect
        inside = (u >= u0) & (u < u1) & (v >= v0) & (v < v1)
        self.box_region = inside if box else np.zeros(u.shape, bool)
        x, y = self._apply(wall, u, v)
        bx, by = self._apply(box_h, u, v)
        x = np.where(self.box_region, bx, x)
        y = np.where(self.box_region, by, y)
        self.lit = (x >= 0) & (x < proj_w) & (y >= 0) & (y < proj_h)
        if box:
            # Wall behind the box gets no projector light: the box is in the way (projector shadow).
            import cv2

            footprint = np.zeros((proj_h, proj_w), np.uint8)
            cv2.fillPoly(footprint, [np.int32(np.round(self.box_projector_quad()))], 1)
            xi = np.clip(np.floor(x), 0, proj_w - 1).astype(int)
            yi = np.clip(np.floor(y), 0, proj_h - 1).astype(int)
            self.lit &= self.box_region | (footprint[yi, xi] == 0)
        self.true_x = np.where(self.lit, np.floor(x), -1).astype(np.int32)
        self.true_y = np.where(self.lit, np.floor(y), -1).astype(np.int32)
        self.albedo = np.where(self.box_region, box_albedo, wall_albedo)
        # A light source in view: saturated whatever the projector shows.
        self.lamp = np.zeros(self.lit.shape, bool)
        if lamp:
            self.lamp[2:42, 2:62] = True  # ~3% of the frame, like a lit appliance

    def box_projector_quad(self) -> np.ndarray:
        """The box's outline in projector pixels (4 x 2)."""
        u0, v0, u1, v1 = self.box_rect
        u = np.array([u0, u1, u1, u0], float)
        v = np.array([v0, v0, v1, v1], float)
        x, y = self._apply(self._box_h, u, v)
        return np.stack([x, y], axis=1)

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
        level[self.lamp] = 255
        gray = np.clip(level, 0, 255).astype(np.uint8)
        return np.dstack([gray, gray, gray])
