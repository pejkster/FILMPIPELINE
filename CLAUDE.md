# FILMPIPELINE — Metaninoa

## Project
AI-driven film production pipeline for a 3-minute cinematic trailer and 12-page treatment.
Competition deadline: **August 14, 2026**. Prize: $3.5M.

## Architecture
Monorepo with three sequential pipeline stages connected by a shared artifact schema:
1. **LLM Council** (`pipeline/01_llm_council/`) — narrative, research, vision
2. **Worldbuilding** (`pipeline/02_worldbuilding/`) — characters, environments, style consistency
3. **Production** (`pipeline/03_production/`) — shot generation, composition, audio, final video

Artifacts flow forward through checkpoints (`checkpoints/`) where human review gates the next stage.

## Tech Stack
- Python 3.11+ for orchestration
- YAML for pipeline and stage config
- Markdown for narrative outputs
- JSON schemas for inter-stage data contracts

## Conventions
- Config files live in each stage's `config/` directory
- Stage outputs go to each stage's `outputs/` directory
- All generated assets are gitignored; only configs, prompts, and schemas are tracked
- Checkpoint approvals are tracked as YAML files in `checkpoints/`

## Commands
```bash
pip install -r requirements.txt                        # install dependencies
python -m pipeline.run                                 # run full pipeline
python -m pipeline.run --stage 1                       # run single stage
uvicorn ui.app:app --reload --port 8000                # start dashboard UI
```
