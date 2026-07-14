"""Worldbuilding — character design, environments, and visual consistency."""

import uuid

from pipeline.shared.schemas import Artifact, ArtifactType
from pipeline.shared.utils.io import load_config, load_stage_outputs, save_artifact


class Worldbuilder:
    def __init__(self):
        self.config = load_config(stage=2)
        self.style_config = self.config["style"]
        self.narrative_artifacts = load_stage_outputs(stage=1)

    def generate_style_guide(self) -> Artifact:
        """Create the visual style bible from narrative direction."""
        print("[Worldbuilding] Generating style guide...")

        # TODO: Use narrative artifacts to drive style decisions
        # TODO: Generate reference images via Runware/ComfyUI

        artifact = Artifact(
            id=str(uuid.uuid4()),
            artifact_type=ArtifactType.STYLE_GUIDE,
            stage=2,
            content={
                "aesthetic": self.style_config["aesthetic"],
                "color_palette": self.style_config.get("color_palette", []),
                "lighting": "warm, golden hour dominant",
                "textures": "organic, weathered, lived-in",
                "references": [],
            },
        )
        save_artifact(artifact)
        return artifact

    def generate_character(self, name: str, description: str) -> Artifact:
        """Generate a character reference sheet with consistent design."""
        print(f"[Worldbuilding] Generating character: {name}")

        char_config = self.config["characters"]["generation"]

        # TODO: Generate character images via configured tool
        # TODO: Ensure consistency across views using reference_sheet method

        artifact = Artifact(
            id=str(uuid.uuid4()),
            artifact_type=ArtifactType.CHARACTER_PROFILE,
            stage=2,
            content={
                "name": name,
                "description": description,
                "views": char_config["views"],
                "generation_tool": char_config["tool"],
                "image_paths": [],
            },
        )
        save_artifact(artifact)
        return artifact

    def generate_environment(self, name: str, description: str) -> Artifact:
        """Generate an environment specification with layered composition."""
        print(f"[Worldbuilding] Generating environment: {name}")

        env_config = self.config["environments"]["generation"]

        # TODO: Generate environment layers via configured tool
        # TODO: Compose layers into final environment

        artifact = Artifact(
            id=str(uuid.uuid4()),
            artifact_type=ArtifactType.ENVIRONMENT_SPEC,
            stage=2,
            content={
                "name": name,
                "description": description,
                "layers": env_config["layers"],
                "generation_tool": env_config["tool"],
                "image_paths": [],
            },
        )
        save_artifact(artifact)
        return artifact


def run_stage() -> list[Artifact]:
    """Entry point for Stage 2."""
    wb = Worldbuilder()
    artifacts = []

    artifacts.append(wb.generate_style_guide())

    # Characters and environments will be driven by Stage 1 outputs
    # For now, placeholders
    print("[Worldbuilding] Waiting for narrative artifacts to drive character/environment generation")

    return artifacts
