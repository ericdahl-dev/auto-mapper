"""The scene being projected: detected surfaces plus the effect assigned to each.

Effect ids and params are opaque here; the frontend effect registry owns their meaning.
"""

import json
from pathlib import Path


class UnknownSurface(LookupError):
    pass


class SceneStore:
    def __init__(self, scan_dir: Path):
        self.scan_dir = Path(scan_dir)
        self.scene: dict | None = self._load()

    def _load(self) -> dict | None:
        saved = self.scan_dir / "scene.json"
        if saved.exists():
            return json.loads(saved.read_text())
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
                {"id": i, "polygon": s["polygon"], "area": s["area"], "effect": "none", "params": {}}
                for i, s in enumerate(summary.get("surfaces", []), 1)
            ],
            "selected": None,
        }

    def reset_from_scan(self, summary: dict) -> None:
        self.scene = self._from_scan(summary)
        self._save()

    def _surface(self, surface_id: int) -> dict:
        for s in (self.scene or {}).get("surfaces", []):
            if s["id"] == surface_id:
                return s
        raise UnknownSurface(surface_id)

    def update(self, surface_id: int, effect: str | None, params: dict | None) -> None:
        surface = self._surface(surface_id)
        if effect is not None and effect != surface["effect"]:
            surface["effect"], surface["params"] = effect, {}  # params belong to the old effect
        if params:
            surface["params"].update(params)
        self._save()

    def select(self, surface_id: int | None) -> None:
        if surface_id is not None:
            self._surface(surface_id)
        if self.scene is not None:
            self.scene["selected"] = surface_id
            self._save()

    def message(self) -> dict | None:
        return {"type": "scene", **self.scene} if self.scene else None

    def _save(self) -> None:
        self.scan_dir.mkdir(parents=True, exist_ok=True)
        (self.scan_dir / "scene.json").write_text(json.dumps(self.scene, indent=2))
