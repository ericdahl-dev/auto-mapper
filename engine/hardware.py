"""Detects the projector (a non-main display) and attached cameras."""

import json
import re
import subprocess
from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class HardwareSnapshot:
    displays: list[dict] = field(default_factory=list)
    cameras: list[str] = field(default_factory=list)

    @property
    def projector(self) -> dict | None:
        external = [d for d in self.displays if not d["main"]]
        if not external:
            return None
        d = external[0]
        return {"name": d["name"], "width": d["width"], "height": d["height"]}

    @property
    def issues(self) -> list[str]:
        issues = []
        if self.projector is None:
            issues.append("no_projector")
        if not self.cameras:
            issues.append("no_camera")
        return issues

    def to_dict(self) -> dict:
        return {"projector": self.projector, "cameras": self.cameras, "issues": self.issues}


class HardwareProbe(Protocol):
    def probe(self) -> HardwareSnapshot: ...


class FakeHardware:
    """Test probe. Edit `displays`/`cameras` to simulate plugging hardware in or out."""

    def __init__(self, displays: list[dict], cameras: list[str]):
        self.displays = list(displays)
        self.cameras = list(cameras)

    def probe(self) -> HardwareSnapshot:
        return HardwareSnapshot(displays=list(self.displays), cameras=list(self.cameras))


class MacHardware:
    """Reads displays and cameras from system_profiler (about 1.5 s per call)."""

    def probe(self) -> HardwareSnapshot:
        out = subprocess.run(
            ["system_profiler", "SPDisplaysDataType", "SPCameraDataType", "-json"],
            capture_output=True, text=True, timeout=15, check=True,
        ).stdout
        return parse_system_profiler(json.loads(out))


def parse_system_profiler(data: dict) -> HardwareSnapshot:
    displays = []
    for gpu in data.get("SPDisplaysDataType", []):
        for d in gpu.get("spdisplays_ndrvs", []):
            m = re.match(r"(\d+) x (\d+)", d.get("_spdisplays_pixels", ""))
            if not m:
                continue
            displays.append({
                "name": d.get("_name", "Display"),
                "width": int(m.group(1)),
                "height": int(m.group(2)),
                "main": d.get("spdisplays_main") == "spdisplays_yes",
            })
    cameras = [c["_name"] for c in data.get("SPCameraDataType", [])]
    return HardwareSnapshot(displays=displays, cameras=cameras)
