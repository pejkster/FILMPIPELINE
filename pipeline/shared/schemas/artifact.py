"""Shared data contracts for artifacts flowing between pipeline stages."""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


class ArtifactType(Enum):
    NARRATIVE = "narrative"
    SCENE_BREAKDOWN = "scene_breakdown"
    CHARACTER_PROFILE = "character_profile"
    ENVIRONMENT_SPEC = "environment_spec"
    STYLE_GUIDE = "style_guide"
    SHOT_LIST = "shot_list"
    SHOT_IMAGE = "shot_image"
    AUDIO_TRACK = "audio_track"
    COMPOSITION = "composition"
    TREATMENT = "treatment"


class ApprovalStatus(Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    REVISION_REQUESTED = "revision_requested"


@dataclass
class Artifact:
    id: str
    artifact_type: ArtifactType
    stage: int
    content: dict[str, Any]
    created_at: datetime = field(default_factory=datetime.now)
    version: int = 1
    approval: ApprovalStatus = ApprovalStatus.PENDING
    notes: str = ""

    @property
    def requires_checkpoint(self) -> bool:
        return self.approval == ApprovalStatus.PENDING


@dataclass
class Checkpoint:
    stage: int
    artifacts: list[str]
    reviewer: str
    status: ApprovalStatus = ApprovalStatus.PENDING
    reviewed_at: datetime | None = None
    feedback: str = ""
