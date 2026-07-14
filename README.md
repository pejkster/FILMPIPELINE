# Metaninoa — AI Film Production Pipeline

Automated pipeline for producing a 3-minute cinematic trailer and 12-page treatment for the Disorder universe "Metaninoa" chapter.

## Pipeline Stages

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  1. LLM Council │────▶│ 2. Worldbuilding│────▶│  3. Production  │
│                 │     │                 │     │                 │
│ - Narrative     │  ✓  │ - Style Guide   │  ✓  │ - Shot Gen      │
│ - Scene Breakdown│────│ - Characters    │────│ - Audio         │
│ - Treatment     │     │ - Environments  │     │ - Composition   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                    checkpoint              checkpoint
```

Each stage produces artifacts that must pass a **checkpoint review** before flowing to the next stage.

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # add your API keys
```

## Usage

```bash
python -m pipeline              # run full pipeline
python -m pipeline --stage 1    # run LLM Council only
python -m pipeline --stage 2    # run Worldbuilding only
python -m pipeline --stage 3    # run Production only
```

## Project Structure

```
pipeline/
├── shared/              # Shared schemas and utilities
│   ├── schemas/         # Data contracts between stages
│   └── utils/           # I/O, config loading
├── 01_llm_council/      # Stage 1: Narrative & vision
│   ├── config/          # Council configuration
│   ├── prompts/         # LLM prompt templates
│   └── outputs/         # Generated narratives (gitignored)
├── 02_worldbuilding/    # Stage 2: Visual consistency
│   ├── config/          # Style & generation config
│   ├── assets/          # Generated images (gitignored)
│   └── outputs/         # Style guides, character sheets
├── 03_production/       # Stage 3: Final video
│   ├── config/          # Video & audio config
│   ├── shots/           # Generated frames (gitignored)
│   ├── audio/           # Music & narration (gitignored)
│   └── outputs/         # Final compositions
checkpoints/             # Review gate approvals
treatments/              # Film treatment documents
docs/                    # Project documentation
```

## Deadline

**August 14, 2026** — Final submission.
