"""Images and videos the user maps onto surfaces, kept as plain files in <scan_dir>/media/.

Stored names are "<slug>-<hash>.<ext>": safe to put in a URL, and a different file uploaded
under the same name never replaces one that another surface (or project) still shows.
"""

import hashlib
import re
import tempfile
from pathlib import Path
from typing import AsyncIterator

# Extension -> (kind, content type). Only formats a browser can draw into a WebGL texture.
TYPES = {
    "png": ("image", "image/png"),
    "jpg": ("image", "image/jpeg"),
    "jpeg": ("image", "image/jpeg"),
    "webp": ("image", "image/webp"),
    "gif": ("image", "image/gif"),
    "mp4": ("video", "video/mp4"),
    "m4v": ("video", "video/mp4"),
    "mov": ("video", "video/quicktime"),
    "webm": ("video", "video/webm"),
}
MAX_BYTES = 2 * 1024**3
STORED_NAME = re.compile(r"^[a-z0-9][a-z0-9-]*-[0-9a-f]{12}\.([a-z0-9]+)$")


class MediaError(ValueError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def extension(filename: str) -> str:
    ext = Path(filename).suffix.lower().lstrip(".")
    if ext not in TYPES:
        raise MediaError(415, f"Unsupported media type: choose {', '.join(sorted(TYPES))}")
    return ext


def stem_slug(filename: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", Path(Path(filename).name).stem.lower()).strip("-")[:40].strip("-")
    return slug or "media"


async def store(media_dir: Path, filename: str, chunks: AsyncIterator[bytes]) -> dict:
    """Streams an upload to disk (videos can be large) and returns its name, URL and kind."""
    ext = extension(filename)
    media_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    with tempfile.NamedTemporaryFile(dir=media_dir, suffix=".part", delete=False) as tmp:
        part = Path(tmp.name)
        try:
            async for chunk in chunks:
                size += len(chunk)
                if size > MAX_BYTES:
                    raise MediaError(413, "Media file is too large")
                digest.update(chunk)
                tmp.write(chunk)
        except BaseException:
            tmp.close()
            part.unlink(missing_ok=True)
            raise
    if size == 0:
        part.unlink(missing_ok=True)
        raise MediaError(400, "Empty upload")
    name = f"{stem_slug(filename)}-{digest.hexdigest()[:12]}.{ext}"
    part.replace(media_dir / name)
    return {"name": name, "url": f"/api/media/{name}", "kind": TYPES[ext][0]}


def lookup(media_dir: Path, name: str) -> tuple[Path, str] | None:
    """The stored file and its content type, or None for unknown or unsafe names."""
    m = STORED_NAME.match(name)
    if not m or m.group(1) not in TYPES:
        return None
    path = media_dir / name
    return (path, TYPES[m.group(1)][1]) if path.is_file() else None
