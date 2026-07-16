import argparse
import json
from pathlib import Path

from src.openrouter_client import call_model_with_image
from src.parsing import parse_json
from src.prompts import load_template

MOODBOARD_DIR = Path(__file__).resolve().parent.parent / "moodboard"
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "output" / "moodboard_analysis.jsonl"
DEFAULT_MODEL = "google/gemini-3.1-pro-preview"


def load_already_done(output_path: Path) -> set:
    if not output_path.exists():
        return set()
    done = set()
    for line in output_path.read_text().splitlines():
        if line.strip():
            done.add(json.loads(line)["filename"])
    return done


def analyze_image(model: str, prompt: str, image_path: Path) -> dict:
    response = call_model_with_image(model, prompt, image_path)
    result = parse_json(response)
    result["filename"] = image_path.name
    return result


def main():
    parser = argparse.ArgumentParser(description="Analyze Disordine moodboard images")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--limit", type=int, help="Only process the first N not-yet-done images")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()

    prompt = load_template("image_analysis_prompt.md")
    all_images = sorted(MOODBOARD_DIR.glob("*.jpg"))
    done = load_already_done(args.output)
    todo = [p for p in all_images if p.name not in done]

    if args.limit:
        todo = todo[: args.limit]

    print(f"{len(all_images)} total images, {len(done)} already done, {len(todo)} to process")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    errors = []

    with open(args.output, "a") as f:
        for i, image_path in enumerate(todo, start=1):
            print(f"[{i}/{len(todo)}] {image_path.name}")
            try:
                result = analyze_image(args.model, prompt, image_path)
                f.write(json.dumps(result) + "\n")
                f.flush()
            except Exception as exc:
                print(f"  ERROR on {image_path.name}: {exc}")
                errors.append(image_path.name)

    print(f"Done. {len(todo) - len(errors)} succeeded, {len(errors)} failed.")
    if errors:
        print("Failed files (rerun the script to retry them):", errors)


if __name__ == "__main__":
    main()
