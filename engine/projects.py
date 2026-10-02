"""Named projects: a saved scan plus its scene, as plain files in <data_dir>/projects/<slug>/."""

import json
import re
import shutil
import time
from pathlib import Path

from engine.files import write_text_atomic
from engine.scene import SceneStore

SCAN_FILES = ["scan.png", "mask.png", "map.npz", "meta.json", "scene.json"]
MEDIA_DIR = "media"  # images and videos surfaces show (see engine/media.py)


class UnknownProject(LookupError):
    pass


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "project"


class ProjectStore:
    def __init__(self, data_dir: Path, scan_dir: Path, scene: SceneStore):
        self.root = Path(data_dir) / "projects"
        self.scan_dir = Path(scan_dir)
        self.scene = scene
        self._active_file = Path(data_dir) / "active-project.json"

    def active(self) -> dict | None:
        try:
            return json.loads(self._active_file.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    def _set_active(self, info: dict | None) -> None:
        if info is None:
            self._active_file.unlink(missing_ok=True)
        else:
            write_text_atomic(self._active_file, json.dumps({"name": info["name"], "slug": info["slug"]}))

    def save(self, name: str) -> dict:
        """Saves the current scan and scene; saving under an existing name overwrites it."""
        if self.scene.scene is None:
            raise UnknownProject("Nothing to save: scan first")
        slug = slugify(name)
        folder = self.root / slug
        folder.mkdir(parents=True, exist_ok=True)
        self.scene.save()  # make sure scene.json reflects the current state
        for f in SCAN_FILES:
            if (self.scan_dir / f).exists():
                shutil.copy2(self.scan_dir / f, folder / f)
        _replace_dir(self.scan_dir / MEDIA_DIR, folder / MEDIA_DIR)
        info = {
            "name": name.strip() or slug,
            "slug": slug,
            "saved_at": time.time(),
            "width": self.scene.scene["width"],
            "height": self.scene.scene["height"],
            "surfaces": len(self.scene.scene["surfaces"]),
        }
        write_text_atomic(folder / "project.json", json.dumps(info, indent=2))
        self._set_active(info)
        return info

    def list(self) -> list[dict]:
        if not self.root.exists():
            return []
        projects = [json.loads(p.read_text()) for p in self.root.glob("*/project.json")]
        return sorted(projects, key=lambda p: p["saved_at"], reverse=True)

    def open(self, slug: str) -> dict:
        folder = self.root / slug
        if not (folder / "project.json").exists():
            raise UnknownProject(slug)
        self.scan_dir.mkdir(parents=True, exist_ok=True)
        for f in SCAN_FILES:
            target = self.scan_dir / f
            if (folder / f).exists():
                shutil.copy(folder / f, target)  # fresh mtimes: an opened project is new scan data
            else:
                target.unlink(missing_ok=True)
        _replace_dir(folder / MEDIA_DIR, self.scan_dir / MEDIA_DIR)
        self.scene.reload()
        info = json.loads((folder / "project.json").read_text())
        self._set_active(info)
        return info


def _replace_dir(source: Path, target: Path) -> None:
    """Makes target a copy of source; no source means no target."""
    shutil.rmtree(target, ignore_errors=True)
    if source.is_dir():
        shutil.copytree(source, target, ignore=shutil.ignore_patterns("*.part"))
