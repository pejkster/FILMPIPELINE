"""Production — shot generation, audio, and final video composition."""

import uuid

from pipeline.shared.schemas import Artifact, ArtifactType
from pipeline.shared.utils.io import load_config, load_stage_outputs, save_artifact


class Producer:
    def __init__(self):
        self.config = load_config(stage=3)
        self.video_config = self.config["video"]
        self.narrative_artifacts = load_stage_outputs(stage=1)
        self.worldbuilding_artifacts = load_stage_outputs(stage=2)

    def generate_shot_list(self) -> Artifact:
        """Create ordered shot list from scene breakdown and style guide."""
        print("[Production] Generating shot list...")

        duration = self.video_config["duration_seconds"]
        fps = self.video_config["fps"]

        # TODO: Parse scene breakdown from Stage 1
        # TODO: Map scenes to shots with timing

        artifact = Artifact(
            id=str(uuid.uuid4()),
            artifact_type=ArtifactType.SHOT_LIST,
            stage=3,
            content={
                "total_duration": duration,
                "fps": fps,
                "shots": [],
            },
        )
        save_artifact(artifact)
        return artifact

    def generate_shot(self, shot_spec: dict) -> Artifact:
        """Generate a single shot image from specification."""
        print(f"[Production] Generating shot: {shot_spec.get('name', 'unnamed')}")

        shot_config = self.config["shots"]["generation"]

        # TODO: Generate image via Runware
        # TODO: Apply style guide consistency
        # TODO: Upscale if configured

        artifact = Artifact(
            id=str(uuid.uuid4()),
            artifact_type=ArtifactType.SHOT_IMAGE,
            stage=3,
            content={
                "spec": shot_spec,
                "tool": shot_config["tool"],
                "upscaled": shot_config.get("upscale", False),
                "image_path": None,
            },
        )
        save_artifact(artifact)
        return artifact

    def compose_video(self, shot_artifacts: list[Artifact]) -> Artifact:
        """Compose final video from shots, audio, and transitions."""
        print("[Production] Composing final video...")

        comp_config = self.config["composition"]

        # TODO: Sequence shots with timing from shot list
        # TODO: Apply Ken Burns / parallax animation
        # TODO: Add audio tracks (music, narration, ambient)
        # TODO: Apply color grading
        # TODO: Render via ffmpeg

        artifact = Artifact(
            id=str(uuid.uuid4()),
            artifact_type=ArtifactType.COMPOSITION,
            stage=3,
            content={
                "resolution": self.video_config["resolution"],
                "duration": self.video_config["duration_seconds"],
                "format": self.video_config["format"],
                "shots_used": len(shot_artifacts),
                "output_path": None,
            },
        )
        save_artifact(artifact)
        return artifact


def run_stage() -> list[Artifact]:
    """Entry point for Stage 3."""
    producer = Producer()
    artifacts = []

    shot_list = producer.generate_shot_list()
    artifacts.append(shot_list)

    # Shot generation and composition depend on approved shot list
    print("[Production] Shot list generated — awaiting checkpoint approval before rendering")

    return artifacts
