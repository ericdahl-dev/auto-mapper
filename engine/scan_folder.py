"""A saved scan on disk: the only module that knows a scan's files.

A scan folder holds the scan image (scan.png), which projector pixels decoded (mask.png), the
camera-to-projector map (map.npz), the scan summary with detected surfaces (meta.json), the
current show mapped on it (scene.json), and the images and videos its surfaces show (media/). The working scan lives in <data_dir>/scans/latest; a project
keeps a copy of the same files.
"""

import json
import shutil
from pathlib import Path

import cv2
import numpy as np

from engine.files import write_text_atomic
from engine.scan import DecodeResult
from engine.surfaces import detect_surfaces

IMAGE, MASK, MAP, META, SHOW = "scan.png", "mask.png", "map.npz", "meta.json", "scene.json"
FILES = (IMAGE, MASK, MAP, META, SHOW)
MEDIA = "media"  # see engine/media.py


class NoScan(LookupError):
    pass


class ScanFolder:
    def __init__(self, path: Path):
        self.path = Path(path)

    @property
    def show_file(self) -> Path:
        """Where the show mapped on this scan is saved."""
        return self.path / SHOW

    @property
    def media_dir(self) -> Path:
        """Images and videos uploaded for the show's surfaces."""
        return self.path / MEDIA

    @property
    def meta_file(self) -> Path:
        return self.path / META

    def has_scan(self) -> bool:
        return (self.path / META).exists()

    def can_redetect(self) -> bool:
        return all((self.path / f).exists() for f in (IMAGE, MAP, META))

    def meta(self) -> dict | None:
        """The scan summary: size, coverage, timing, warnings and detected surfaces."""
        try:
            return json.loads((self.path / META).read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    def image_path(self) -> Path | None:
        path = self.path / IMAGE
        return path if path.exists() else None

    def mask_path(self) -> Path | None:
        path = self.path / MASK
        return path if path.exists() else None

    def save(self, decoded: DecodeResult, image: np.ndarray, covered: np.ndarray, summary: dict) -> None:
        self.path.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(self.path / IMAGE), image)
        cv2.imwrite(str(self.path / MASK), covered.astype(np.uint8) * 255)
        np.savez_compressed(
            self.path / MAP, proj_x=decoded.proj_x.astype(np.int16), proj_y=decoded.proj_y.astype(np.int16),
            valid=decoded.valid, covered=covered,
        )
        write_text_atomic(self.path / META, json.dumps(summary, indent=2))

    def redetect(self) -> dict:
        """Runs surface detection again on the saved scan (e.g. after detection improves) and saves it."""
        if not self.can_redetect():
            raise NoScan(self.path)
        m = np.load(self.path / MAP)
        meta = self.meta() or {}
        decoded = DecodeResult(
            proj_x=m["proj_x"].astype(np.int32), proj_y=m["proj_y"].astype(np.int32), valid=m["valid"],
            white=None, black=None, bit_reliability={}, width=meta["width"], height=meta["height"],
        )
        image = cv2.imread(str(self.path / IMAGE))
        meta["surfaces"] = detect_surfaces(decoded, (image, m["covered"]))
        write_text_atomic(self.path / META, json.dumps(meta, indent=2))
        return meta

    def copy_to(self, dest: Path) -> "ScanFolder":
        """Copies the scan and its show into another folder (e.g. a project), replacing what's there."""
        target = ScanFolder(dest)
        target.replace_with(self)
        return target

    def clear(self) -> None:
        """Removes the scan, its show and its media: back to no scan at all."""
        for f in FILES:
            (self.path / f).unlink(missing_ok=True)
        shutil.rmtree(self.media_dir, ignore_errors=True)

    def replace_with(self, other: "ScanFolder") -> None:
        """Makes this folder hold exactly the other folder's scan and show."""
        self.path.mkdir(parents=True, exist_ok=True)
        for f in FILES:
            src, dst = other.path / f, self.path / f
            if src.exists():
                shutil.copy(src, dst)  # fresh timestamps: to the output, copied-in data is new scan data
            elif dst.exists():
                dst.unlink()  # a file the other scan doesn't have mustn't linger from an older one
        shutil.rmtree(self.media_dir, ignore_errors=True)
        if other.media_dir.is_dir():
            shutil.copytree(other.media_dir, self.media_dir, ignore=shutil.ignore_patterns("*.part"))
