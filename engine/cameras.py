"""Camera catalog built from device metadata only. Nothing here opens a camera.

OpenCV's AVFoundation backend numbers devices by sorting them on uniqueID
(modules/videoio/src/cap_avfoundation_mac.mm), so the OpenCV index is derived
from metadata instead of probing indices, which would switch on every camera.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path

from engine.files import write_text_atomic

_USB_ID = re.compile(r"^0x([0-9a-f]+)([0-9a-f]{4})([0-9a-f]{4})$", re.IGNORECASE)


@dataclass(frozen=True)
class UsbAddress:
    location: int
    vendor: int
    product: int


def usb_address(unique_id: str) -> UsbAddress | None:
    """USB cameras on macOS have uniqueIDs like 0x2110000f1311306 = location 0x02110000, f131:1306."""
    m = _USB_ID.match(unique_id)
    if not m:
        return None
    return UsbAddress(int(m.group(1), 16), int(m.group(2), 16), int(m.group(3), 16))


def opencv_index(cameras: list[dict], unique_id: str) -> int | None:
    order = sorted(c["unique_id"] for c in cameras)
    return order.index(unique_id) if unique_id in order else None


def default_camera(cameras: list[dict]) -> str | None:
    """First USB webcam; never the built-in, Continuity (phone) or virtual cameras."""
    for c in cameras:
        if usb_address(c["unique_id"]):
            return c["unique_id"]
    return None


class CameraSettings:
    """Remembers the user's camera choice in <data_dir>/settings.json."""

    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "settings.json"

    def _load(self) -> dict:
        try:
            return json.loads(self.path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def selected(self, cameras: list[dict]) -> str | None:
        saved = self._load().get("camera")
        if saved and any(c["unique_id"] == saved for c in cameras):
            return saved
        return default_camera(cameras)

    def select(self, unique_id: str) -> None:
        data = self._load()
        data["camera"] = unique_id
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_text_atomic(self.path, json.dumps(data, indent=2))

    def calibration(self, unique_id: str | None) -> dict | None:
        return self._load().get("calibration", {}).get(unique_id) if unique_id else None

    def save_calibration(self, unique_id: str, result: dict) -> None:
        data = self._load()
        data.setdefault("calibration", {})[unique_id] = result
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_text_atomic(self.path, json.dumps(data, indent=2))
