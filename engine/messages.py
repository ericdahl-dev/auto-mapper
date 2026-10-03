"""WebSocket and API message shapes. Mirrored in frontend/src/shared/messages.ts."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

TestFrameKind = Literal["white", "black", "grid"]


class EditorHello(BaseModel):
    type: Literal["hello"]
    role: Literal["editor"]


class OutputHello(BaseModel):
    type: Literal["hello"]
    role: Literal["output"]
    width: int = Field(gt=0)
    height: int = Field(gt=0)


Hello = TypeAdapter(Annotated[EditorHello | OutputHello, Field(discriminator="role")])


class TestFrameRequest(BaseModel):
    kind: TestFrameKind


class CameraSelectRequest(BaseModel):
    unique_id: str


class ProjectorSelectRequest(BaseModel):
    key: str


Point = Annotated[list[float], Field(min_length=2, max_length=2)]


class SurfaceUpdate(BaseModel):
    effect: str | None = None
    params: dict | None = None
    polygon: Annotated[list[Point], Field(min_length=3)] | None = None
    name: Annotated[str, Field(max_length=80)] | None = None
    bezier: dict | None = None  # editor-only curve data; sent together with its flattened polygon
    edge: Annotated[int, Field(ge=-10, le=10)] | None = None  # grow (+) or shrink (-) the lit area, in pixels
    gesture: Annotated[str, Field(max_length=64)] | None = None  # edits sharing one are one undo step


class NewSceneRequest(BaseModel):
    name: Annotated[str, Field(max_length=80)] | None = None
    duplicate: int | None = None  # copy this scene's effects and settings instead of starting dark


class SceneUpdate(BaseModel):
    name: Annotated[str, Field(max_length=80)] | None = None
    duration: Annotated[float, Field(gt=0, le=3600)] | None = None  # seconds in a playlist


HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


class DayTimes(BaseModel):
    on: Annotated[str, Field(pattern=HHMM)]
    off: Annotated[str, Field(pattern=HHMM)]


class ScheduleRequest(BaseModel):
    """Daily on and off times; "days" overrides them per weekday ("0" = Monday), None = off all day."""

    enabled: bool
    on: Annotated[str, Field(pattern=HHMM)]
    off: Annotated[str, Field(pattern=HHMM)]
    days: dict[Literal["0", "1", "2", "3", "4", "5", "6"], DayTimes | None] = {}


class MidiSettingTarget(BaseModel, extra="forbid"):
    surface: int
    param: str


class MidiActionTarget(BaseModel, extra="forbid"):
    action: Literal["play", "edit", "blackout", "next", "previous"]


class MidiBinding(BaseModel, extra="forbid"):
    """A knob or fader (cc) or a key or pad (note), on a channel, bound to a setting or an action."""

    kind: Literal["cc", "note"]
    channel: Annotated[int, Field(ge=0, le=15)]
    number: Annotated[int, Field(ge=0, le=127)]
    target: MidiSettingTarget | MidiActionTarget


class MidiBindings(BaseModel):
    bindings: Annotated[list[MidiBinding], Field(max_length=256)]


class OscRequest(BaseModel):
    enabled: bool
    port: Annotated[int, Field(ge=0, le=65535)] | None = None  # 0: any free port (tests)


UnitPoint = Annotated[list[Annotated[float, Field(ge=0, le=1)]], Field(min_length=2, max_length=2)]


class ScanSettingsRequest(BaseModel):
    hole_fill: Annotated[int, Field(ge=0, le=31)] | None = None  # px gap filled between decoded pixels
    # Areas of the camera image to scan (0..1 camera coordinates); the rest is ignored.
    mask: Annotated[list[Annotated[list[UnitPoint], Field(min_length=3, max_length=200)]], Field(min_length=1, max_length=16)] | None = None
    clear_mask: bool = False  # back to scanning the whole camera image
    hdr: Annotated[int, Field(ge=1, le=3)] | None = None  # exposures per pattern: 1 = off
    # Still cameras: f-number to scan at ("8" = f/8, deep focus), or "camera" to leave the lens as set.
    aperture: Annotated[str, Field(pattern=r"^(\d{1,2}(\.\d)?|camera)$")] | None = None


class AutostartRequest(BaseModel):
    enabled: bool


class PlaylistRequest(BaseModel):
    crossfade: Annotated[float, Field(ge=0, le=60)] | None = None  # seconds blending one scene into the next
    loop: bool | None = None  # after the last scene, start over


class SceneOrder(BaseModel):
    ids: Annotated[list[int], Field(min_length=1)]


class DeleteRequest(BaseModel):
    ids: Annotated[list[int], Field(min_length=1)]


class MergeRequest(BaseModel):
    ids: Annotated[list[int], Field(min_length=2)]


class SelectRequest(BaseModel):
    id: int | None


class ProjectSaveRequest(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]


class AlignmentRequest(BaseModel):
    """Realign the whole show: where the output's four corners go (TL, TR, BR, BL, projector pixels)."""

    corners: Annotated[list[Point], Field(min_length=4, max_length=4)] | None = None
    brightness: Annotated[float, Field(ge=0, le=1)] | None = None
    gesture: Annotated[str, Field(max_length=64)] | None = None  # one drag = one undo step


class SoundRequest(BaseModel):
    enabled: bool | None = None
    source: Literal["mic", "video"] | None = None
    output: Annotated[str, Field(max_length=200)] | None = None  # "" = the system default
    device: Annotated[str, Field(max_length=200)] | None = None
    # ms: + holds video sound back for a late projector; - plays it early for late speakers (Bluetooth)
    delay: Annotated[int, Field(ge=-500, le=500)] | None = None


class PresentationRequest(BaseModel):
    mode: Literal["edit", "play"] | None = None
    blackout: bool | None = None


class NewSurfaceRequest(BaseModel):
    polygon: Annotated[list[Point], Field(min_length=3)]
    name: Annotated[str, Field(max_length=80)] | None = None


class ApplyEffectRequest(BaseModel):
    from_id: int = Field(alias="from")
    to: list[int] | None = None  # omitted: every surface


# --- From the output window ------------------------------------------------------------------------

class PatternShown(BaseModel):
    type: Literal["pattern_shown"]
    seq: int


class OutputSound(BaseModel):
    level: float = 0
    error: str | None = None


class OutputStats(BaseModel):
    type: Literal["output_stats"]
    fps: float | None = None
    sound: OutputSound | None = None
    video_sound_blocked: bool | None = None
    sound_output_error: str | None = None
    sound_channels: Annotated[int, Field(ge=1, le=64)] | None = None  # channels the sound output has


class EffectErrorReport(BaseModel):
    type: Literal["effect_error"]
    surface: int
    effect: str
    log: str


OutputMessage = TypeAdapter(
    Annotated[PatternShown | OutputStats | EffectErrorReport | OutputHello, Field(discriminator="type")]
)


# --- From the engine (to editors and the output window) --------------------------------------------
# Checked before sending (Hub._send), and pinned by tests/test_message_contract.py together with the
# browser's parser (frontend/src/shared/messages.ts).

class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StatusOut(_Out):
    type: Literal["status"]
    hardware: dict
    output_connected: bool
    output_resolution: dict | None
    output_fps: float | None
    output_sound: dict | None
    output_video_sound_blocked: bool
    output_sound_output_error: str | None
    output_sound_channels: int | None
    camera: dict
    project: dict | None
    unsaved: bool  # the show differs from what was last saved or opened
    can_scan: bool


class ShowSurfaceOut(_Out):
    id: int
    name: str
    polygon: list[list[float]]
    area: float
    effect: str
    params: dict
    source: Literal["detected", "edited", "drawn"]
    bezier: dict | None = None
    edge: int = 0


class ShowOut(_Out):
    type: Literal["show"]
    width: int
    height: int
    surfaces: list[ShowSurfaceOut]
    selected: int | None
    presentation: dict
    sound: dict
    alignment: dict
    history: dict
    scenes: list[dict]
    scene: int
    playlist: dict
    midi: list[dict]
    scan_rev: str | None


class ScanStarted(_Out):
    type: Literal["scan_started"]


class ScanProgress(_Out):
    type: Literal["scan_progress"]
    done: int
    total: int


class ScanResult(_Out):
    type: Literal["scan_result"]
    width: int
    height: int
    coverage: float
    seconds: float
    bit_reliability: dict
    surfaces: list[dict]
    warnings: list[str]
    image: str


class ScanFailed(_Out):
    type: Literal["scan_failed"]
    error: str


class ScanCanceledOut(_Out):
    type: Literal["scan_canceled"]


class ScanReload(_Out):
    type: Literal["scan_reload"]


class ShowCleared(_Out):
    """No scan and no show any more (a new project): the output goes dark, editors start empty."""

    type: Literal["show_cleared"]


class EffectErrorOut(_Out):
    type: Literal["effect_error"]
    surface: int
    effect: str
    log: str


class ShowPatternOut(_Out):
    type: Literal["show_pattern"]
    seq: int
    pattern: dict


class ShowTestFrameOut(_Out):
    type: Literal["show_test_frame"]
    kind: TestFrameKind


EngineMessage = TypeAdapter(Annotated[
    StatusOut | ShowOut | ScanStarted | ScanProgress | ScanResult | ScanFailed | ScanCanceledOut | ScanReload
    | ShowCleared | EffectErrorOut | ShowPatternOut | ShowTestFrameOut,
    Field(discriminator="type"),
])
