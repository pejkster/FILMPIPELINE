# NDRMN / council

An independent LLM council implementation for the Metanoia project's first mission:
generating an "abundant future" vision across 8 aspects of life, 40 years out, as
raw material for later worldbuilding and treatment work.

Lives under `NDRMN/`, kept separate from the rest of this repo's `pipeline/`/`ui/`
work to avoid any collision with Nejc's implementation. `NDRMN/` is meant to hold
further pieces of this side of the project alongside this one as they're built.

## Approach

- **6 council seats**, one flagship model per major lab, via [OpenRouter](https://openrouter.ai):
  Claude Opus 4.8, GPT-5.6 Sol, Gemini 3.1 Pro Preview, Grok 4.5, Qwen3.7 Max, DeepSeek V4 Pro.
- **8 topics**: work & purpose, health & longevity, family & relationships, learning
  & growing up, governance & trust, resources & environment, culture & meaning, the
  ordinary day.
- **Process per topic**: each model answers independently and blind (no cross-model
  exposure, no shared background lore) → each model anonymously scores and comments
  on the other 5 statements (1-5 agreement scale) → each model may revise its own
  statement in light of that feedback (self-classified as unchanged / minor /
  major) → repeats until a round passes with no major revisions, capped at 10
  rounds per topic.
- Every statement, revision, and piece of peer feedback is logged to SQLite
  (`db/council.db`) for full traceability.

## Structure

- `prompts/` — the prompt templates used at each stage
- `db/` — SQLite schema, seed data, and the actual generated data from 2 completed runs
- `src/` — the pipeline orchestration, OpenRouter client, and report generation
- `webapp/` — a Streamlit app for browsing statements/feedback and rating them (1-5 stars)
- `output/`, `webapp/static/` — exported Word doc and generated PDF analysis reports

## Running it

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then add your own OPENROUTER_API_KEY

# run the pipeline
python3 -m src.pipeline --mode full --new-run --label "my run"

# browse results
streamlit run webapp/app.py
```
