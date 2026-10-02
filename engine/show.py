"""The current show: its surfaces, the effect and settings on each, and how it's presented.

Effect ids and params are opaque here; the frontend effect registry owns their meaning.
"""

import copy
import json
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from engine.files import write_text_atomic
from engine.geometry import polygon_area
from engine.scan_folder import ScanFolder

MERGE_CLOSE_PX = 5  # bridges hairline gaps between surfaces being merged
DUPLICATE_OVERLAP = 0.5  # a new detection this much inside a kept surface is a duplicate
MATCH_IOU = 0.5  # overlap needed for a new detection to inherit an old surface's effect


class UnknownSurface(LookupError):
    pass


class CurrentShow:
    def __init__(self, folder: ScanFolder):
        self.folder = folder  # the scan this show is mapped on, and where the show is saved
        self.data: dict | None = self._load()
        self.scan_rev = self._scan_rev()
        self.selected: int | None = None  # the editor's selected surface: session state, not saved
        self._listeners: list[Callable[[], None]] = []
        # How the output presents the show (Edit/Play mode, Blackout). Session state: not saved.
        self.presentation = {"mode": "edit", "blackout": False}
        # Sound-reactive effects: whether the output listens, and to which input (a browser device id).
        # source: "mic", or "video" to react to the playing videos' own sound (no mic, no feedback).
        # output: a browser audio output device id for video sound; None = the system default.
        self.sound = {"enabled": False, "device": None, "source": "mic", "output": None}

    def _load(self) -> dict | None:
        show = _read_json(self.folder.show_file)
        if show is not None:
            show.pop("selected", None)  # older files saved the selection; it's session state now
            for surface in show["surfaces"]:
                surface.setdefault("name", f"Surface {surface['id']}")
                surface.setdefault("source", "detected")
                if surface["source"] == "manual":
                    surface["source"] = "drawn"  # older name for surfaces made by hand
            return show
        meta = self.folder.meta()
        return self._from_scan(meta) if meta is not None else None

    def _scan_rev(self) -> str | None:
        """Changes only when new scan data lands (scan, redetect, project open), not on edits,
        so the output reloads the scan image only when it actually changed."""
        meta = self.folder.meta_file
        return str(meta.stat().st_mtime_ns) if meta.exists() else None

    @staticmethod
    def _from_scan(summary: dict) -> dict:
        return {
            "width": summary["width"],
            "height": summary["height"],
            "surfaces": [
                {"id": i, "name": f"Surface {i}", "polygon": s["polygon"], "area": s["area"], "effect": "none",
                 "params": {}, "source": "detected"}
                for i, s in enumerate(summary.get("surfaces", []), 1)
            ],
        }

    def subscribe(self, listener: Callable[[], None]) -> None:
        """Called after every change, so editors and the output window can be told (see Hub)."""
        self._listeners.append(listener)

    def _changed(self) -> None:
        for listener in self._listeners:
            listener()

    def reload(self) -> None:
        self.data = self._load()
        self.scan_rev = self._scan_rev()
        self.selected = None
        self._changed()

    def save(self) -> None:
        if self.data is not None:
            self._save()

    def reset_from_scan(self, summary: dict) -> None:
        self.data = self._from_scan(summary)
        self.scan_rev = self._scan_rev()
        self.selected = None
        self._save()
        self._changed()

    def _surface(self, surface_id: int) -> dict:
        for s in (self.data or {}).get("surfaces", []):
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
        bezier: dict | None = None,
        edge: int | None = None,
    ) -> None:
        surface = self._surface(surface_id)
        if polygon is not None:
            # The Bezier (editor curves) must describe this polygon; a plain polygon edit makes it stale.
            if bezier is not None:
                surface["bezier"] = bezier
            else:
                surface.pop("bezier", None)
            surface["polygon"] = self._clamp(polygon)
            surface["area"] = polygon_area(surface["polygon"])
            _reshaped(surface)
        if name is not None:
            surface["name"] = name.strip() or surface["name"]
        if edge is not None:
            surface["edge"] = edge  # how far the lit area grows (+) or shrinks (-) past the outline
        if effect is not None and effect != surface["effect"]:
            surface["effect"], surface["params"] = effect, {}  # params belong to the old effect
        if params:
            surface["params"].update(params)
        self._save()
        self._changed()

    def delete(self, surface_id: int) -> None:
        surface = self._surface(surface_id)
        self.data["surfaces"].remove(surface)
        if self.selected == surface_id:
            self.selected = None
        self._save()
        self._changed()

    def merge(self, ids: list[int]) -> int:
        """Replaces the surfaces with one covering all of them; keeps the first one's id and effect."""
        surfaces = [self._surface(i) for i in ids]
        w, h = self.data["width"], self.data["height"]
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
        keep.pop("bezier", None)  # the merged outline is new; its old curves don't apply
        _reshaped(keep)
        keep["area"] = polygon_area(keep["polygon"])
        for s in surfaces[1:]:
            self.data["surfaces"].remove(s)
        self.selected = keep["id"]
        self._save()
        self._changed()
        return keep["id"]

    def apply_effect(self, from_id: int, to_ids: list[int] | None = None) -> None:
        """Gives other surfaces (all, by default) a copy of one surface's effect and params."""
        source = self._surface(from_id)
        targets = self.data["surfaces"] if to_ids is None else [self._surface(i) for i in to_ids]
        for t in targets:
            t["effect"] = source["effect"]
            t["params"] = copy.deepcopy(source["params"])  # copies: later edits stay per surface
        self._save()
        self._changed()

    def add_manual(self, polygon: list[list[float]], name: str | None = None) -> int:
        """A surface drawn by hand, for areas detection missed."""
        new_id = self._next_id()
        poly = self._clamp(polygon)
        self.data["surfaces"].append({
            "id": new_id, "name": name or f"Surface {new_id}", "polygon": poly, "area": polygon_area(poly),
            "effect": "none", "params": {}, "source": "drawn",
        })
        self.selected = new_id
        self._save()
        self._changed()
        return new_id

    def apply_detection(self, summary: dict) -> None:
        """Replaces detected surfaces with a new detection, keeping what the user made.

        Drawn and edited surfaces are kept as they are; new detections that mostly cover
        one of them are dropped as duplicates. A new detection that overlaps an old detected
        surface takes over its id, name and effect, so rescans don't wipe effects.
        """
        if self.data is None or (self.data["width"], self.data["height"]) != (summary["width"], summary["height"]):
            self.reset_from_scan(summary)
            return
        w, h = summary["width"], summary["height"]
        kept = [s for s in self.data["surfaces"] if s["source"] != "detected"]
        old = [s for s in self.data["surfaces"] if s["source"] == "detected"]
        kept_masks = [_mask(s["polygon"], w, h) for s in kept]
        old_masks = [_mask(s["polygon"], w, h) for s in old]
        next_id = self._next_id()
        result = list(kept)
        claimed: set[int] = set()
        for found in summary.get("surfaces", []):
            m = _mask(found["polygon"], w, h)
            size = max(int(m.sum()), 1)
            if any((m & k).sum() > DUPLICATE_OVERLAP * size for k in kept_masks):
                continue
            match = None
            best = MATCH_IOU
            for o, om in zip(old, old_masks):
                if o["id"] in claimed:
                    continue
                iou = (m & om).sum() / max(int((m | om).sum()), 1)
                if iou >= best:
                    match, best = o, iou
            if match is not None:
                claimed.add(match["id"])
                surface = {**match, "polygon": found["polygon"], "area": found["area"]}
            else:
                surface = {"id": next_id, "name": f"Surface {next_id}", "polygon": found["polygon"],
                           "area": found["area"], "effect": "none", "params": {}, "source": "detected"}
                next_id += 1
            result.append(surface)
        result.sort(key=lambda s: s["area"], reverse=True)  # smaller surfaces draw on top
        self.scan_rev = self._scan_rev()
        self.data["surfaces"] = result
        if not any(s["id"] == self.selected for s in result):
            self.selected = None
        self._save()
        self._changed()

    def _next_id(self) -> int:
        return max((s["id"] for s in self.data["surfaces"]), default=0) + 1

    def _clamp(self, polygon: list[list[float]]) -> list[list[float]]:
        w, h = self.data["width"], self.data["height"]
        return [[min(max(x, 0), w), min(max(y, 0), h)] for x, y in polygon]

    def select(self, surface_id: int | None) -> None:
        if surface_id is not None:
            self._surface(surface_id)
        if self.data is not None:
            self.selected = surface_id  # not saved: selection is the editor's session state
            self._changed()

    def present(self, mode: str | None = None, blackout: bool | None = None) -> None:
        if mode is not None:
            self.presentation["mode"] = mode
        if blackout is not None:
            self.presentation["blackout"] = blackout
        self._changed()

    def set_sound(
        self, enabled: bool | None = None, device: str | None = None, source: str | None = None, output: str | None = None
    ) -> None:
        if output is not None:
            self.sound["output"] = output or None  # "" = back to the system default
        if source is not None:
            self.sound["source"] = source
        if enabled is not None:
            self.sound["enabled"] = enabled
        if device is not None:
            self.sound["device"] = device
        self._changed()

    def public(self) -> dict | None:
        if not self.data:
            return None
        return {**self.data, "selected": self.selected, "presentation": dict(self.presentation),
                "sound": dict(self.sound), "scan_rev": self.scan_rev}

    def message(self) -> dict | None:
        return {"type": "show", **self.public()} if self.data else None

    def _save(self) -> None:
        self.folder.path.mkdir(parents=True, exist_ok=True)
        write_text_atomic(self.folder.show_file, json.dumps(self.data, indent=2))


def _reshaped(surface: dict) -> None:
    """A detected surface reshaped by hand becomes edited, so redetecting won't overwrite it."""
    if surface["source"] == "detected":
        surface["source"] = "edited"


def _mask(polygon: list[list[float]], width: int, height: int) -> np.ndarray:
    m = np.zeros((height, width), np.uint8)
    cv2.fillPoly(m, [np.round(np.asarray(polygon)).astype(np.int32)], 1)
    return m.astype(bool)


def _read_json(path: Path) -> dict | None:
    """None if the file is missing or unreadable (e.g. cut off by a crash before atomic writes)."""
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None
