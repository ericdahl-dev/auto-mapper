"""The scene being projected: detected surfaces plus the effect assigned to each.

Effect ids and params are opaque here; the frontend effect registry owns their meaning.
"""

import json
from pathlib import Path

import cv2
import numpy as np

MERGE_CLOSE_PX = 5  # bridges hairline gaps between surfaces being merged


class UnknownSurface(LookupError):
    pass


class SceneStore:
    def __init__(self, scan_dir: Path):
        self.scan_dir = Path(scan_dir)
        self.scene: dict | None = self._load()
        # How the output presents the scene. Session state: not saved with the scene.
        self.presentation = {"mode": "edit", "blackout": False}

    def _load(self) -> dict | None:
        saved = self.scan_dir / "scene.json"
        if saved.exists():
            scene = json.loads(saved.read_text())
            for surface in scene["surfaces"]:
                surface.setdefault("name", f"Surface {surface['id']}")
            return scene
        meta = self.scan_dir / "meta.json"
        if meta.exists():
            return self._from_scan(json.loads(meta.read_text()))
        return None

    @staticmethod
    def _from_scan(summary: dict) -> dict:
        return {
            "width": summary["width"],
            "height": summary["height"],
            "surfaces": [
                {"id": i, "name": f"Surface {i}", "polygon": s["polygon"], "area": s["area"], "effect": "none", "params": {}}
                for i, s in enumerate(summary.get("surfaces", []), 1)
            ],
            "selected": None,
        }

    def reload(self) -> None:
        self.scene = self._load()

    def save(self) -> None:
        if self.scene is not None:
            self._save()

    def reset_from_scan(self, summary: dict) -> None:
        self.scene = self._from_scan(summary)
        self._save()

    def _surface(self, surface_id: int) -> dict:
        for s in (self.scene or {}).get("surfaces", []):
            if s["id"] == surface_id:
                return s
        raise UnknownSurface(surface_id)

    def update(
        self,
        surface_id: int,
        effect: str | None = None,
        params: dict | None = None,
        polygon: list[list[float]] | None = None,
        name: str | None = None,
    ) -> None:
        surface = self._surface(surface_id)
        if polygon is not None:
            surface["polygon"] = self._clamp(polygon)
            surface["area"] = polygon_area(surface["polygon"])
        if name is not None:
            surface["name"] = name.strip() or surface["name"]
        if effect is not None and effect != surface["effect"]:
            surface["effect"], surface["params"] = effect, {}  # params belong to the old effect
        if params:
            surface["params"].update(params)
        self._save()

    def delete(self, surface_id: int) -> None:
        surface = self._surface(surface_id)
        self.scene["surfaces"].remove(surface)
        if self.scene["selected"] == surface_id:
            self.scene["selected"] = None
        self._save()

    def merge(self, ids: list[int]) -> int:
        """Replaces the surfaces with one covering all of them; keeps the first one's id and effect."""
        surfaces = [self._surface(i) for i in ids]
        w, h = self.scene["width"], self.scene["height"]
        mask = np.zeros((h, w), np.uint8)
        for s in surfaces:
            cv2.fillPoly(mask, [np.round(np.array(s["polygon"])).astype(np.int32)], 1)
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (MERGE_CLOSE_PX, MERGE_CLOSE_PX))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        outline = max(contours, key=cv2.contourArea)  # disjoint pieces: keep the biggest outline
        outline = cv2.approxPolyDP(outline, 1.5, True).reshape(-1, 2)
        keep = surfaces[0]
        keep["polygon"] = outline.tolist()
        keep["area"] = polygon_area(keep["polygon"])
        for s in surfaces[1:]:
            self.scene["surfaces"].remove(s)
        self.scene["selected"] = keep["id"]
        self._save()
        return keep["id"]

    def _clamp(self, polygon: list[list[float]]) -> list[list[float]]:
        w, h = self.scene["width"], self.scene["height"]
        return [[min(max(x, 0), w), min(max(y, 0), h)] for x, y in polygon]

    def select(self, surface_id: int | None) -> None:
        if surface_id is not None:
            self._surface(surface_id)
        if self.scene is not None:
            self.scene["selected"] = surface_id
            self._save()

    def present(self, mode: str | None = None, blackout: bool | None = None) -> None:
        if mode is not None:
            self.presentation["mode"] = mode
        if blackout is not None:
            self.presentation["blackout"] = blackout

    def public(self) -> dict | None:
        return {**self.scene, "presentation": dict(self.presentation)} if self.scene else None

    def message(self) -> dict | None:
        return {"type": "scene", **self.public()} if self.scene else None

    def _save(self) -> None:
        self.scan_dir.mkdir(parents=True, exist_ok=True)
        (self.scan_dir / "scene.json").write_text(json.dumps(self.scene, indent=2))


def polygon_area(polygon: list[list[float]]) -> float:
    pts = np.asarray(polygon, float)
    x, y = pts[:, 0], pts[:, 1]
    return float(0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))
