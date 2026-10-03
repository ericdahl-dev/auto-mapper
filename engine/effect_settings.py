"""Each effect's settings (type, range, options), recorded from the frontend's effect definitions by
frontend/src/effects/settingsRecord.test.ts into effect_settings.json. Lets the engine check and clamp
values that come from outside the Editor (OSC, MIDI) the way the Editor's controls would."""

import json
import re
from pathlib import Path

SETTINGS: dict[str, dict[str, dict]] = json.loads((Path(__file__).parent / "effect_settings.json").read_text())
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


class BadSetting(ValueError):
    pass


def checked(effect: str, name: str, value):
    """The value to save for an effect's setting: numbers clamped to its range; anything that isn't
    one of its options, or isn't a setting at all, raises BadSetting."""
    spec = SETTINGS.get(effect, {}).get(name)
    if spec is None:
        raise BadSetting(f"{effect} has no setting {name}")
    kind = spec["type"]
    if kind == "number" and isinstance(value, (int, float)) and not isinstance(value, bool):
        lo = spec["min"] if spec["min"] is not None else float("-inf")
        hi = spec["max"] if spec["max"] is not None else float("inf")
        return min(hi, max(lo, value))
    if kind == "choice" and value in spec["options"]:
        return value
    if kind == "color" and isinstance(value, str) and HEX.match(value):
        return value.lower()
    if kind in ("text", "media") and isinstance(value, str):
        return value
    raise BadSetting(f"{value!r} isn't a value for {effect}.{name}")
