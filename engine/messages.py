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
