"""LLM Council — collaborative debate system for narrative generation."""

import uuid
from dataclasses import dataclass

from pipeline.shared.schemas import Artifact, ArtifactType
from pipeline.shared.utils.io import load_config, save_artifact


@dataclass
class CouncilMember:
    role: str
    perspective: str
    model: str


@dataclass
class Proposal:
    author: str
    content: str
    round: int


@dataclass
class DebateRound:
    round_number: int
    proposals: list[Proposal]
    consensus: dict | None = None


class LLMCouncil:
    def __init__(self):
        config = load_config(stage=1)
        self.council_config = config["council"]
        self.members = [
            CouncilMember(**m) for m in self.council_config["members"]
        ]
        self.debate_rounds = self.council_config["debate"]["rounds"]
        self.consensus_threshold = self.council_config["debate"]["consensus_threshold"]
        self.history: list[DebateRound] = []

    def run_debate(self, topic: str, context: dict | None = None) -> Artifact:
        """Run a multi-round debate among council members on a topic."""
        print(f"[Council] Starting debate on: {topic}")
        print(f"[Council] {len(self.members)} members, {self.debate_rounds} rounds")

        for round_num in range(1, self.debate_rounds + 1):
            print(f"[Council] Round {round_num}/{self.debate_rounds}")
            round_result = self._run_round(round_num, topic, context)
            self.history.append(round_result)

            if round_result.consensus:
                print(f"[Council] Consensus reached in round {round_num}")
                break

        narrative = self._synthesize()

        artifact = Artifact(
            id=str(uuid.uuid4()),
            artifact_type=ArtifactType.NARRATIVE,
            stage=1,
            content={
                "topic": topic,
                "narrative": narrative,
                "rounds": len(self.history),
                "consensus_reached": self.history[-1].consensus is not None,
            },
        )
        save_artifact(artifact)
        return artifact

    def _run_round(self, round_num: int, topic: str, context: dict | None) -> DebateRound:
        """Execute one round of debate. Each member proposes based on their perspective."""
        proposals = []
        for member in self.members:
            proposal = self._get_member_proposal(member, topic, round_num, context)
            proposals.append(proposal)

        consensus = self._evaluate_consensus(proposals)
        return DebateRound(
            round_number=round_num,
            proposals=proposals,
            consensus=consensus,
        )

    def _get_member_proposal(
        self, member: CouncilMember, topic: str, round_num: int, context: dict | None
    ) -> Proposal:
        """Get a proposal from a council member. TODO: wire to actual LLM calls."""
        # Placeholder — will be replaced with actual API calls
        return Proposal(
            author=member.role,
            content=f"[{member.role}] Proposal for '{topic}' (round {round_num}) — perspective: {member.perspective}",
            round=round_num,
        )

    def _evaluate_consensus(self, proposals: list[Proposal]) -> dict | None:
        """Check if proposals have reached sufficient consensus. TODO: implement scoring."""
        # Placeholder — will implement semantic similarity / voting
        return None

    def _synthesize(self) -> str:
        """Synthesize final narrative from debate history. TODO: implement."""
        return "Synthesized narrative placeholder"


def run_stage(context: dict | None = None) -> list[Artifact]:
    """Entry point for Stage 1."""
    council = LLMCouncil()

    artifacts = []

    narrative = council.run_debate(
        topic="Metaninoa: A hopeful vision of humanity 10-100 years from now",
        context=context,
    )
    artifacts.append(narrative)

    return artifacts
