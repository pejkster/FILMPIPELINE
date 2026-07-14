"""Utilities for reading/writing pipeline artifacts."""

import json
import yaml
from pathlib import Path
from datetime import datetime

from pipeline.shared.schemas import Artifact, ArtifactType, ApprovalStatus


PIPELINE_ROOT = Path(__file__).parent.parent.parent


def load_config(stage: int) -> dict:
    stage_dirs = {1: "01_llm_council", 2: "02_worldbuilding", 3: "03_production"}
    config_path = PIPELINE_ROOT / stage_dirs[stage] / "config" / "stage.yaml"
    with open(config_path) as f:
        return yaml.safe_load(f)


def save_artifact(artifact: Artifact, filename: str | None = None) -> Path:
    stage_dirs = {1: "01_llm_council", 2: "02_worldbuilding", 3: "03_production"}
    output_dir = PIPELINE_ROOT / stage_dirs[artifact.stage] / "outputs"
    output_dir.mkdir(parents=True, exist_ok=True)

    if filename is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{artifact.artifact_type.value}_{timestamp}.json"

    path = output_dir / filename
    data = {
        "id": artifact.id,
        "type": artifact.artifact_type.value,
        "stage": artifact.stage,
        "version": artifact.version,
        "approval": artifact.approval.value,
        "notes": artifact.notes,
        "created_at": artifact.created_at.isoformat(),
        "content": artifact.content,
    }
    path.write_text(json.dumps(data, indent=2))
    return path


def load_artifact(path: Path) -> Artifact:
    data = json.loads(path.read_text())
    return Artifact(
        id=data["id"],
        artifact_type=ArtifactType(data["type"]),
        stage=data["stage"],
        content=data["content"],
        created_at=datetime.fromisoformat(data["created_at"]),
        version=data["version"],
        approval=ApprovalStatus(data["approval"]),
        notes=data.get("notes", ""),
    )


def load_stage_outputs(stage: int) -> list[Artifact]:
    stage_dirs = {1: "01_llm_council", 2: "02_worldbuilding", 3: "03_production"}
    output_dir = PIPELINE_ROOT / stage_dirs[stage] / "outputs"
    if not output_dir.exists():
        return []
    artifacts = []
    for path in sorted(output_dir.glob("*.json")):
        artifacts.append(load_artifact(path))
    return artifacts
