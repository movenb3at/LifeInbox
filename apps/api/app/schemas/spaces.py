from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SpaceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100)
    type: Literal["personal", "shared"] = "personal"


class SpacePatch(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    is_default: Literal[True] | None = None


class MemberInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: UUID
    role: Literal["member", "viewer"] = "member"


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: UUID
    role: str


class CopyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    space_id: UUID
