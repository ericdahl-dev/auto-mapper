import json
from pathlib import Path

from engine.hardware import parse_system_profiler

FIXTURE = Path(__file__).parent / "fixtures" / "system_profiler_rig.json"


def test_real_rig_profile_finds_projector_and_cameras():
    hw = parse_system_profiler(json.loads(FIXTURE.read_text()))

    assert hw.projector == {"name": "AML TV", "width": 1920, "height": 1080}
    assert "Webcam AC410" in hw.cameras
    assert hw.issues == []
