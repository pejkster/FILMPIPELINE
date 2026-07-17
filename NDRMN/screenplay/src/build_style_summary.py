"""Map-reduce summarization of the full moodboard analysis (all 514 entries)
into one comprehensive style guide — grounded in everything, not a sample,
without dumping ~129K raw tokens into a single call."""

import json
from pathlib import Path

from src.openrouter_client import call_model
from src.parsing import parse_json
from src.prompts import fill, load_template

MOODBOARD_JSONL = (
    Path(__file__).resolve().parent.parent.parent / "disordine" / "output" / "moodboard_analysis.jsonl"
)
CHECKPOINT_PATH = Path(__file__).resolve().parent.parent / "reference" / "style_summary_batches.json"
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "reference" / "style_summary.txt"
MODEL = "anthropic/claude-opus-4.8"
CHUNK_SIZE = 50
MAX_PARSE_RETRIES = 3


def _format_entries(entries) -> str:
    blocks = []
    for entry in entries:
        desc = entry.get("description", {})
        parts = [desc.get("color_palette"), desc.get("lighting"), desc.get("mood"), desc.get("symbolism")]
        parts = [p for p in parts if p]
        blocks.append(f"[{entry.get('filename', '?')}] " + " ".join(parts))
    return "\n\n".join(blocks)


def _call_with_parse_retry(prompt: str) -> dict:
    last_error = None
    for attempt in range(1, MAX_PARSE_RETRIES + 1):
        response = call_model(MODEL, prompt)
        try:
            return parse_json(response)
        except (ValueError, KeyError) as exc:
            last_error = exc
            print(f"  [parse-retry] malformed JSON on attempt {attempt}/{MAX_PARSE_RETRIES}: {exc}")
    raise RuntimeError(f"Failed to get valid JSON after {MAX_PARSE_RETRIES} attempts") from last_error


def _load_checkpoint() -> dict:
    if CHECKPOINT_PATH.exists():
        return json.loads(CHECKPOINT_PATH.read_text())
    return {}


def _save_checkpoint(batch_results: dict):
    CHECKPOINT_PATH.write_text(json.dumps(batch_results, indent=2))


def main():
    lines = [json.loads(l) for l in MOODBOARD_JSONL.read_text().splitlines() if l.strip()]
    print(f"{len(lines)} total entries")

    chunks = [lines[i : i + CHUNK_SIZE] for i in range(0, len(lines), CHUNK_SIZE)]
    print(f"{len(chunks)} batches of ~{CHUNK_SIZE}")

    batch_results = _load_checkpoint()
    chunk_template = load_template("style_chunk_summary_prompt.md")

    for i, chunk in enumerate(chunks, start=1):
        key = str(i)
        if key in batch_results:
            print(f"[{i}/{len(chunks)}] already done, skipping")
            continue
        print(f"[{i}/{len(chunks)}] summarizing batch...")
        prompt = fill(chunk_template, ENTRY_COUNT=len(chunk), ENTRIES=_format_entries(chunk))
        parsed = _call_with_parse_retry(prompt)
        batch_results[key] = parsed
        _save_checkpoint(batch_results)

    print("Synthesizing final style guide...")
    batch_summaries = "\n\n".join(
        f"### Batch {i}\n" + json.dumps(batch_results[str(i)], indent=2) for i in range(1, len(chunks) + 1)
    )
    final_template = load_template("style_final_synthesis_prompt.md")
    prompt = fill(final_template, BATCH_COUNT=len(chunks), BATCH_SUMMARIES=batch_summaries)
    final = _call_with_parse_retry(prompt)

    output_text = "\n\n".join(f"## {k.replace('_', ' ').title()}\n{v}" for k, v in final.items())
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(output_text)
    print(f"Saved: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
