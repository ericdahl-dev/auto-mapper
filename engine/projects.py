"""Named projects: a saved scan plus its show, as plain files in <data_dir>/projects/<slug>/."""

import json
import re
import time
from pathlib import Path

from engine.files import write_text_atomic
from engine.scan_folder import ScanFolder
from engine.show import CurrentShow



class UnknownProject(LookupError):
    pass


def _fingerprint(data: dict | None) -> str | None:
    return None if data is None else json.dumps(data, sort_keys=True)


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "project"


class ProjectStore:
    def __init__(self, data_dir: Path, folder: ScanFolder, show: CurrentShow):
        self.root = Path(data_dir) / "projects"
        self.folder = folder  # the working scan (scans/latest)
        self.show = show
        self._active_file = Path(data_dir) / "active-project.json"
        # The show as last saved or opened: anything else is unsaved. At start, the open project's
        # saved copy (the working show may have changed since).
        active = self.active()
        saved = self.root / active["slug"] if active else None
        self._saved = _fingerprint(CurrentShow(ScanFolder(saved)).data) if saved and saved.is_dir() else None

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
        """Saves the current scan and show; saving under an existing name overwrites it."""
        if self.show.data is None:
            raise UnknownProject("Nothing to save: scan first")
        slug = slugify(name)
        folder = self.root / slug
        self.show.save()  # make sure the saved show reflects the current state
        self.folder.copy_to(folder)
        info = {
            "name": name.strip() or slug,
            "slug": slug,
            "saved_at": time.time(),
            "width": self.show.data["width"],
            "height": self.show.data["height"],
            "surfaces": len(self.show.data["surfaces"]),
        }
        write_text_atomic(folder / "project.json", json.dumps(info, indent=2))
        self._set_active(info)
        self._saved = _fingerprint(self.show.data)
        return info

    def new(self) -> None:
        """Starts over: no scan, no show, no open project. Saved projects are kept."""
        self.folder.clear()
        self.show.clear()
        self._set_active(None)
        self._saved = None

    def unsaved(self) -> bool:
        """True when there's a show that differs from what was last saved or opened (selection,
        Play/Blackout and sound aren't part of it)."""
        return self.show.data is not None and _fingerprint(self.show.data) != self._saved

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
        self.show.reload()
        self.show.present(mode="play", blackout=False)  # an opened project is ready to show
        info = json.loads((folder / "project.json").read_text())
        self._set_active(info)
        self._saved = _fingerprint(self.show.data)
        return info

