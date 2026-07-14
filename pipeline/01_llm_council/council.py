"""LLM Council — four-phase expert pipeline using Claude via Runware."""

import asyncio
import json
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import yaml
from dotenv import load_dotenv
from runware import Runware, ITextInference, ITextInferenceMessage

load_dotenv()

COUNCIL_ROOT = Path(__file__).parent
PIPELINE_ROOT = COUNCIL_ROOT.parent


@dataclass
class ExpertConfig:
    id: str
    role: str
    prompt_file: str
    receives: list[str] = field(default_factory=list)


@dataclass
class PhaseConfig:
    id: str
    name: str
    description: str
    parallel: bool
    checkpoint: bool
    experts: list[ExpertConfig]


@dataclass
class ExpertOutput:
    expert_id: str
    role: str
    phase_id: str
    content: str
    timestamp: datetime = field(default_factory=datetime.now)


class LLMCouncil:
    def __init__(self):
        self.config = self._load_config()
        self.llm_config = self.config["llm"]
        self.phases = self._parse_phases()
        self.outputs: dict[str, ExpertOutput] = {}
        self._runware: Runware | None = None

    def _load_config(self) -> dict:
        config_path = COUNCIL_ROOT / "config" / "stage.yaml"
        with open(config_path) as f:
            return yaml.safe_load(f)

    def _parse_phases(self) -> list[PhaseConfig]:
        phases = []
        for p in self.config["phases"]:
            experts = [
                ExpertConfig(
                    id=e["id"],
                    role=e["role"],
                    prompt_file=e["prompt_file"],
                    receives=e.get("receives", []),
                )
                for e in p["experts"]
            ]
            phases.append(PhaseConfig(
                id=p["id"],
                name=p["name"],
                description=p["description"],
                parallel=p["parallel"],
                checkpoint=p["checkpoint"],
                experts=experts,
            ))
        return phases

    def _load_prompt(self, prompt_file: str) -> str:
        path = COUNCIL_ROOT / prompt_file
        return path.read_text()

    def _build_context(self, expert: ExpertConfig) -> str:
        """Build context from prior expert outputs that this expert receives."""
        if not expert.receives:
            return ""

        context_parts = []

        if "all_research" in expert.receives:
            research_outputs = [
                o for o in self.outputs.values() if o.phase_id == "research"
            ]
            for o in research_outputs:
                context_parts.append(
                    f"## Research Briefing: {o.role}\n\n{o.content}"
                )
        elif "vision_document" in expert.receives:
            vision_outputs = [
                o for o in self.outputs.values() if o.phase_id == "vision"
            ]
            for o in vision_outputs:
                context_parts.append(
                    f"## {o.role}'s Contribution\n\n{o.content}"
                )
        elif "narrative_document" in expert.receives:
            narrative_outputs = [
                o for o in self.outputs.values() if o.phase_id == "narrative"
            ]
            for o in narrative_outputs:
                context_parts.append(
                    f"## {o.role}'s Contribution\n\n{o.content}"
                )
        else:
            for expert_id in expert.receives:
                if expert_id in self.outputs:
                    o = self.outputs[expert_id]
                    context_parts.append(
                        f"## {o.role}'s Contribution\n\n{o.content}"
                    )

        if not context_parts:
            return ""

        return (
            "\n\n---\n\n"
            "# Context from Prior Experts\n\n"
            "The following contributions have been produced by earlier experts in the council. "
            "Build upon this work — don't repeat it, extend it.\n\n"
            + "\n\n---\n\n".join(context_parts)
        )

    async def _get_runware(self) -> Runware:
        if self._runware is None:
            api_key = os.getenv("RUNWARE_API_KEY")
            if not api_key:
                raise ValueError("RUNWARE_API_KEY not set in environment")
            self._runware = Runware(api_key=api_key)
            await self._runware.connect()
        return self._runware

    async def _call_llm(self, system_prompt: str, user_message: str) -> str:
        """Call Claude via Runware's text inference API."""
        client = await self._get_runware()

        request = ITextInference(
            model=self.llm_config["model"],
            messages=[
                ITextInferenceMessage(role="user", content=user_message),
            ],
            settings={
                "maxTokens": self.llm_config["max_tokens"],
                "thinkingLevel": "off",
                "systemPrompt": system_prompt,
            },
        )

        results = await client.textInference(request)
        return results[0].text

    async def run_expert(self, expert: ExpertConfig, phase_id: str) -> ExpertOutput:
        """Run a single expert — load prompt, build context, call LLM."""
        print(f"  [{expert.role}] Starting...")

        system_prompt = self._load_prompt(expert.prompt_file)
        context = self._build_context(expert)

        user_message = (
            "Produce your deliverable now. Follow your instructions precisely. "
            "Be thorough, specific, and vivid. This is for a real film competition "
            "with a $3.5 million prize — bring your best work."
        )
        if context:
            user_message = context + "\n\n---\n\n" + user_message

        content = await self._call_llm(system_prompt, user_message)

        output = ExpertOutput(
            expert_id=expert.id,
            role=expert.role,
            phase_id=phase_id,
            content=content,
        )
        self.outputs[expert.id] = output
        print(f"  [{expert.role}] Complete ({len(content)} chars)")
        return output

    async def run_phase(self, phase: PhaseConfig) -> list[ExpertOutput]:
        """Run all experts in a phase (parallel or sequential)."""
        print(f"\n{'='*60}")
        print(f"  Phase: {phase.name}")
        print(f"  {phase.description}")
        print(f"  Experts: {len(phase.experts)} ({'parallel' if phase.parallel else 'sequential'})")
        print(f"{'='*60}\n")

        results = []

        if phase.parallel:
            tasks = [
                self.run_expert(expert, phase.id) for expert in phase.experts
            ]
            results = await asyncio.gather(*tasks)
            results = list(results)
        else:
            for expert in phase.experts:
                output = await self.run_expert(expert, phase.id)
                results.append(output)

        return results

    def save_phase_artifact(
        self, phase: PhaseConfig, outputs: list[ExpertOutput]
    ) -> "Artifact":
        """Save all expert outputs from a phase as a single artifact."""
        from pipeline.shared.schemas import Artifact, ArtifactType, ApprovalStatus
        from pipeline.shared.utils.io import save_artifact

        artifact_type_map = {
            "research": ArtifactType.NARRATIVE,
            "vision": ArtifactType.NARRATIVE,
            "narrative": ArtifactType.SCENE_BREAKDOWN,
            "treatment": ArtifactType.TREATMENT,
        }

        content = {
            "phase": phase.id,
            "phase_name": phase.name,
            "expert_outputs": [
                {
                    "expert_id": o.expert_id,
                    "role": o.role,
                    "content": o.content,
                    "timestamp": o.timestamp.isoformat(),
                }
                for o in outputs
            ],
        }

        artifact = Artifact(
            id=str(uuid.uuid4()),
            artifact_type=artifact_type_map.get(phase.id, ArtifactType.NARRATIVE),
            stage=1,
            content=content,
            approval=(
                ApprovalStatus.PENDING
                if phase.checkpoint
                else ApprovalStatus.APPROVED
            ),
        )
        path = save_artifact(artifact)
        print(f"\n  Artifact saved: {path.name}")
        return artifact

    async def run_council(self, phase_id: str | None = None) -> list["Artifact"]:
        """Run the full council or a specific phase."""
        artifacts = []

        phases_to_run = self.phases
        if phase_id:
            phases_to_run = [p for p in self.phases if p.id == phase_id]
            if not phases_to_run:
                raise ValueError(f"Unknown phase: {phase_id}")

        for phase in phases_to_run:
            outputs = await self.run_phase(phase)
            artifact = self.save_phase_artifact(phase, outputs)
            artifacts.append(artifact)

            if phase.checkpoint:
                print(f"\n  ✓ CHECKPOINT — {phase.name} requires review before proceeding")
                print(f"    Artifact status: PENDING")
                break

        return artifacts


async def run_stage(phase_id: str | None = None, context: dict | None = None) -> list:
    """Entry point for Stage 1."""
    council = LLMCouncil()
    return await council.run_council(phase_id=phase_id)
