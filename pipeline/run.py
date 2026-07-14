"""Main pipeline runner — orchestrates all three stages with checkpoint gates."""

import argparse
import sys

from pipeline.shared.schemas import ApprovalStatus
from pipeline.shared.utils.io import load_stage_outputs


def check_checkpoint(stage: int) -> bool:
    """Verify all artifacts from a stage are approved before proceeding."""
    artifacts = load_stage_outputs(stage)
    if not artifacts:
        print(f"[Pipeline] No outputs from stage {stage} — cannot proceed")
        return False

    pending = [a for a in artifacts if a.approval == ApprovalStatus.PENDING]
    rejected = [a for a in artifacts if a.approval == ApprovalStatus.REJECTED]

    if rejected:
        print(f"[Pipeline] Stage {stage} has {len(rejected)} rejected artifact(s) — resolve before proceeding")
        return False
    if pending:
        print(f"[Pipeline] Stage {stage} has {len(pending)} pending artifact(s) — review required")
        return False

    print(f"[Pipeline] Stage {stage} checkpoint passed")
    return True


def run_pipeline(stage: int | None = None):
    """Run the full pipeline or a single stage."""
    stages = {
        1: ("LLM Council", "pipeline.01_llm_council.council"),
        2: ("Worldbuilding", "pipeline.02_worldbuilding.worldbuilder"),
        3: ("Production", "pipeline.03_production.producer"),
    }

    if stage:
        run_stages = [stage]
    else:
        run_stages = [1, 2, 3]

    for s in run_stages:
        name, module_path = stages[s]
        print(f"\n{'='*60}")
        print(f"  Stage {s}: {name}")
        print(f"{'='*60}\n")

        if s > 1 and not stage:
            if not check_checkpoint(s - 1):
                print(f"\n[Pipeline] Halted — Stage {s-1} checkpoint not cleared")
                sys.exit(1)

        import importlib
        mod = importlib.import_module(module_path)
        artifacts = mod.run_stage()
        print(f"\n[Pipeline] Stage {s} produced {len(artifacts)} artifact(s)")

    print(f"\n{'='*60}")
    print("  Pipeline complete")
    print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(description="Metaninoa Film Pipeline")
    parser.add_argument("--stage", type=int, choices=[1, 2, 3], help="Run a specific stage")
    args = parser.parse_args()
    run_pipeline(stage=args.stage)


if __name__ == "__main__":
    main()
