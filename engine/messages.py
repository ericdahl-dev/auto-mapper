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


class MergeRequest(BaseModel):
    ids: Annotated[list[int], Field(min_length=2)]


class SelectRequest(BaseModel):
    id: int | None


class ProjectSaveRequest(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]


class SoundRequest(BaseModel):
    enabled: bool | None = None
    source: Literal["mic", "video"] | None = None
    output: Annotated[str, Field(max_length=200)] | None = None  # "" = the system default
    device: Annotated[str, Field(max_length=200)] | None = None


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
    camera: dict
    project: dict | None
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
    | EffectErrorOut | ShowPatternOut | ShowTestFrameOut,
    Field(discriminator="type"),
])
