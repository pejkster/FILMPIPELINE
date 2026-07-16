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
    mode: str  # "parallel" or "sequential" (with intra-phase chaining)
    checkpoint: bool
    experts: list[ExpertConfig]
    context_level: str = "none"
    previous_phase: str | None = None
    include_prior_stage_context: bool = False


@dataclass
class ExpertOutput:
    expert_id: str
    role: str
    phase_id: str
    content: str
    timestamp: datetime = field(default_factory=datetime.now)


STAGE_DIRS = {
    1: "01_llm_council",
    2: "02_worldbuilding",
    3: "03_production",
}


class LLMCouncil:
    def __init__(self, stage: int = 1):
        self.stage = stage
        self.stage_root = PIPELINE_ROOT / STAGE_DIRS[stage]
        self.config = self._load_config()
        self.llm_config = self.config["llm"]
        self.phases = self._parse_phases()
        self.outputs: dict[str, ExpertOutput] = {}
        self._runware: Runware | None = None

    def _load_config(self) -> dict:
        config_path = self.stage_root / "config" / "stage.yaml"
        with open(config_path) as f:
            return yaml.safe_load(f)

    def _parse_phases(self) -> list[PhaseConfig]:
        phases = []
        phase_list = self.config["phases"]
        for i, p in enumerate(phase_list):
            experts = [
                ExpertConfig(
                    id=e["id"],
                    role=e["role"],
                    prompt_file=e["prompt_file"],
                    receives=e.get("receives", []),
                )
                for e in p["experts"]
            ]
            mode = p.get("mode", "sequential" if not p.get("parallel", False) else "parallel")
            prev_phase = p.get("previous_phase", phase_list[i - 1]["id"] if i > 0 else None)
            phases.append(PhaseConfig(
                id=p["id"],
                name=p["name"],
                description=p["description"],
                mode=mode,
                checkpoint=p["checkpoint"],
                experts=experts,
                context_level=p.get("context_level", "none"),
                previous_phase=prev_phase,
                include_prior_stage_context=p.get("include_prior_stage_context",
                    self.config.get("include_prior_stage_context", False)),
            ))
        return phases

    def _load_prior_outputs(self):
        """Load saved expert results from disk so context chaining works across separate runs."""
        # Load from previous stages for cross-stage context
        for s in range(1, self.stage + 1):
            self._load_outputs_from_dir(PIPELINE_ROOT / STAGE_DIRS[s] / "outputs" / "experts")

    def _load_outputs_from_dir(self, results_dir: Path):
        """Load expert outputs from a specific directory."""
        if not results_dir.exists():
            return
        for path in results_dir.glob("*.json"):
            if path.name.startswith("_"):
                continue
            try:
                data = json.loads(path.read_text())
                eid = data["expert_id"]
                if eid not in self.outputs:
                    self.outputs[eid] = ExpertOutput(
                        expert_id=eid,
                        role=data["role"],
                        phase_id=data["phase_id"],
                        content=data["content"],
                        timestamp=datetime.fromisoformat(data["timestamp"]),
                    )
            except (json.JSONDecodeError, KeyError):
                continue

    CONTEXT_LEVELS = ["none", "basic", "futurax", "disordine"]

    def _load_prompt(self, prompt_file: str) -> str:
        if not prompt_file:
            return ""
        path = self.stage_root / prompt_file
        if not path.exists():
            path = COUNCIL_ROOT / prompt_file
        return path.read_text()

    def _load_context_preamble(self, level: str) -> str:
        """Load a context level preamble. Returns empty string for 'none'."""
        if level == "none" or not level:
            return ""
        path = COUNCIL_ROOT / "prompts" / "context" / f"{level}.md"
        if path.exists():
            return path.read_text().strip()
        return ""

    def build_system_prompt(self, expert: ExpertConfig, context_level: str = "none") -> str:
        """Build the full system prompt: preamble + expert prompt."""
        preamble = self._load_context_preamble(context_level)
        expert_prompt = self._load_prompt(expert.prompt_file)
        if preamble:
            return preamble + "\n\n---\n\n" + expert_prompt
        return expert_prompt

    def _build_phase_context(self, phase: PhaseConfig) -> str:
        """Build context from all outputs of the previous phase."""
        if not phase.previous_phase:
            return ""

        prev_outputs = [
            o for o in self.outputs.values()
            if o.phase_id == phase.previous_phase
        ]
        if not prev_outputs:
            return ""

        context_parts = [
            f"## {o.role}\n\n{o.content}" for o in prev_outputs
        ]

        return (
            "\n\n---\n\n"
            f"# Context from {phase.previous_phase.title()} Phase\n\n"
            "The following outputs were produced by the previous phase. "
            "Build upon this work — don't repeat it, extend and deepen it.\n\n"
            + "\n\n---\n\n".join(context_parts)
        )

    def _build_cross_stage_context(self) -> str:
        """Build context from all prior stage outputs (stage 1 outputs for stage 2, etc.)."""
        prior_outputs = [
            o for o in self.outputs.values()
            if not any(
                o.phase_id == p.id for p in self.phases
            )
        ]
        if not prior_outputs:
            return ""
        context_parts = [
            f"## {o.role} ({o.phase_id})\n\n{o.content}" for o in prior_outputs
        ]
        return (
            "\n\n---\n\n"
            "# Context from Prior Stage\n\n"
            "The following outputs were produced by the previous stage's council. "
            "Use this as your foundation — build upon it, don't repeat it.\n\n"
            + "\n\n---\n\n".join(context_parts)
        )

    def _build_intra_phase_context(self, expert: ExpertConfig) -> str:
        """Build context from earlier experts within the same phase (sequential mode only)."""
        context_parts = []
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
            "# Context from Earlier Experts in This Phase\n\n"
            "The following contributions have been produced by earlier experts in this phase. "
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

    async def _call_llm(self, system_prompt: str, user_message: str, own_connection: bool = False) -> str:
        """Call Claude via Runware's text inference API."""
        if own_connection:
            api_key = os.getenv("RUNWARE_API_KEY")
            client = Runware(api_key=api_key)
            await client.connect()
        else:
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

    async def run_expert(
        self, expert: ExpertConfig, phase: PhaseConfig,
        include_intra_phase: bool = False, parallel: bool = False,
        context_level: str = "none",
    ) -> ExpertOutput:
        """Run a single expert — load prompt, build context, call LLM."""
        print(f"  [{expert.role}] Starting... (context: {context_level})")

        system_prompt = self.build_system_prompt(expert, context_level)

        # Cross-stage context (outputs from prior stages)
        phase_context = ""
        if phase.include_prior_stage_context and self.stage > 1:
            phase_context = self._build_cross_stage_context()

        # Context from previous phase within this stage
        prev_phase_ctx = self._build_phase_context(phase)
        if prev_phase_ctx:
            phase_context = phase_context + prev_phase_ctx if phase_context else prev_phase_ctx

        # Intra-phase chaining (only in sequential mode)
        if include_intra_phase and expert.receives:
            intra = self._build_intra_phase_context(expert)
            if intra:
                phase_context = phase_context + intra if phase_context else intra

        user_message = "Produce your deliverable now. Be thorough, specific, and grounded."
        if phase_context:
            user_message = phase_context + "\n\n---\n\n" + user_message

        content = await self._call_llm(system_prompt, user_message, own_connection=parallel)

        output = ExpertOutput(
            expert_id=expert.id,
            role=expert.role,
            phase_id=phase.id,
            content=content,
        )
        self.outputs[expert.id] = output
        print(f"  [{expert.role}] Complete ({len(content)} chars)")
        return output

    async def run_phase(self, phase: PhaseConfig) -> list[ExpertOutput]:
        """Run all experts in a phase (parallel or sequential with intra-phase chaining)."""
        print(f"\n{'='*60}")
        print(f"  Phase: {phase.name}")
        print(f"  {phase.description}")
        print(f"  Experts: {len(phase.experts)} (mode: {phase.mode})")
        print(f"{'='*60}\n")

        results = []

        if phase.mode == "parallel":
            sem = asyncio.Semaphore(2)

            async def run_with_sem(expert):
                async with sem:
                    return await self.run_expert(expert, phase, parallel=True)

            tasks = [run_with_sem(e) for e in phase.experts]
            results = list(await asyncio.gather(*tasks))
        else:
            for expert in phase.experts:
                output = await self.run_expert(expert, phase, include_intra_phase=True)
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
        self._load_prior_outputs()
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
