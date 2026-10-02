"""Named projects: a saved scan plus its scene, as plain files in <data_dir>/projects/<slug>/."""

import json
import re
import time
from pathlib import Path

from engine.files import write_text_atomic
from engine.scan_folder import ScanFolder
from engine.scene import SceneStore



class UnknownProject(LookupError):
    pass


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "project"


class ProjectStore:
    def __init__(self, data_dir: Path, folder: ScanFolder, scene: SceneStore):
        self.root = Path(data_dir) / "projects"
        self.folder = folder  # the working scan (scans/latest)
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
        self.scene.save()  # make sure the saved show reflects the current state
        self.folder.copy_to(folder)
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
        self.folder.replace_with(ScanFolder(folder))
        self.scene.reload()
        self.scene.present(mode="play", blackout=False)  # an opened project is ready to show
        info = json.loads((folder / "project.json").read_text())
        self._set_active(info)
        return info

