"""WebSocket and API message shapes. Mirrored in frontend/src/shared/messages.ts."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

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


Point = Annotated[list[float], Field(min_length=2, max_length=2)]


class SurfaceUpdate(BaseModel):
    effect: str | None = None
    params: dict | None = None
    polygon: Annotated[list[Point], Field(min_length=3)] | None = None
    name: Annotated[str, Field(max_length=80)] | None = None


class MergeRequest(BaseModel):
    ids: Annotated[list[int], Field(min_length=2)]


class SelectRequest(BaseModel):
    id: int | None


class ProjectSaveRequest(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]


class PresentationRequest(BaseModel):
    mode: Literal["edit", "play"] | None = None
    blackout: bool | None = None
