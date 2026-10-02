"""Writing state files safely: a crash mid-write must never leave a half-written file."""

import os
from pathlib import Path


def write_text_atomic(path: Path, text: str) -> None:
    """Writes to a temp file next to the target, then renames it into place (atomic on one disk)."""
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, path)
