import json
from pathlib import Path

from engine.hardware import parse_system_profiler

FIXTURE = Path(__file__).parent / "fixtures" / "system_profiler_rig.json"


def test_real_rig_profile_finds_projector():
    hw = parse_system_profiler(json.loads(FIXTURE.read_text()))

    assert hw.projector == {"name": "AML TV", "key": "AML TV", "width": 1920, "height": 1080}


MULTI = Path(__file__).parent / "fixtures" / "system_profiler_multimonitor.json"


def test_displays_get_a_stable_key_from_vendor_product_and_serial():
    hw = parse_system_profiler(json.loads(MULTI.read_text()))

    keys = {d["name"]: d["key"] for d in hw.displays}
    assert keys == {"Thunderbolt Display": "610:9227:16200ddf", "Color LCD": "610:a050:fd626d62",
                    "P24q-10": "30ae:61a5:1010101"}
