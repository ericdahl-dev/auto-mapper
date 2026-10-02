"""Locks a UVC webcam's automatic adjustments during a scan, and always puts them back."""

import json
import subprocess
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Protocol

# Restore order matters: a manual value written while its auto mode is on can be ignored,
# so autos go off first when locking and come back on last when restoring.
AUTO_OFF = {"auto-exposure-mode": "1", "auto-white-balance-temp": "false", "auto-focus": "false"}
MANUAL = ["exposure-time-abs", "gain", "white-balance-temp", "focus-abs"]
CONTROLS = list(AUTO_OFF) + MANUAL


class Uvc(Protocol):
    def get(self, name: str) -> str: ...
    def set(self, name: str, value: str) -> None: ...


class UvcUtil:
    """Talks to one webcam through the uvc-util CLI, selected by USB location."""

    def __init__(self, location: int):
        self.location = location

    def _run(self, *args: str) -> str:
        out = subprocess.run(
            ["uvc-util", "-L", hex(self.location), *args], capture_output=True, text=True, timeout=10,
        )
        if out.returncode != 0:
            raise RuntimeError(f"uvc-util {' '.join(args)} failed: {out.stderr.strip() or out.stdout.strip()}")
        return out.stdout.strip()

    def get(self, name: str) -> str:
        return self._run("-o", name)

    def set(self, name: str, value: str) -> None:
        self._run("-s", f"{name}={value}")
        actual = self.get(name)
        if actual != value:
            raise RuntimeError(f"{name}: asked for {value}, camera applied {actual}")


class FakeUvc:
    """Test double: holds control values and records every write in order."""

    def __init__(self, values: dict[str, str]):
        self.values = dict(values)
        self.writes: list[tuple[str, str]] = []

    def get(self, name: str) -> str:
        return self.values[name]

    def set(self, name: str, value: str) -> None:
        self.writes.append((name, value))
        self.values[name] = value


def _snapshot_path(data_dir: Path) -> Path:
    return Path(data_dir) / "camera-restore.json"


def _restore(uvc: Uvc, original: dict[str, str]) -> None:
    for name in MANUAL + list(AUTO_OFF):
        uvc.set(name, original[name])


@contextmanager
def locked_camera(uvc: Uvc, data_dir: Path) -> Iterator[dict[str, str]]:
    """Turns off auto exposure, white balance and focus; restores the originals on exit.

    The originals are also written to disk first, so recover_camera() can put them back
    after a crash or kill that skips the finally block.
    """
    original = {name: uvc.get(name) for name in CONTROLS}
    snapshot = _snapshot_path(data_dir)
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    snapshot.write_text(json.dumps(original))
    try:
        for name, value in AUTO_OFF.items():
            uvc.set(name, value)
        yield original
    finally:
        _restore(uvc, original)
        snapshot.unlink(missing_ok=True)


def recover_camera(uvc: Uvc, data_dir: Path) -> bool:
    """Restores settings left locked by a crashed scan. Returns True if it restored anything."""
    snapshot = _snapshot_path(data_dir)
    if not snapshot.exists():
        return False
    _restore(uvc, json.loads(snapshot.read_text()))
    snapshot.unlink()
    return True
