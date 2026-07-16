import argparse
from pathlib import Path

from src import db
from src.outlook import generate_outlook
from src.pdf_outlook import STATIC_DIR, build_outlook_pdf


def next_output_path(static_dir: Path) -> Path:
    """Never overwrites an existing file — metanoia_outlook.pdf, then
    metanoia_outlook2.pdf, metanoia_outlook3.pdf, etc."""
    base = static_dir / "metanoia_outlook.pdf"
    if not base.exists():
        return base
    n = 2
    while (static_dir / f"metanoia_outlook{n}.pdf").exists():
        n += 1
    return static_dir / f"metanoia_outlook{n}.pdf"


def main():
    parser = argparse.ArgumentParser(description="Generate The Metanoia Outlook")
    parser.add_argument("--runs", help="Comma-separated run ids (default: all runs)")
    parser.add_argument("--output", type=Path, help="Output path (default: auto-versioned)")
    args = parser.parse_args()

    conn = db.get_connection()

    if args.runs:
        run_ids = [int(r) for r in args.runs.split(",")]
    else:
        run_ids = [r["id"] for r in db.get_runs(conn)]

    run_rows = [db.get_run(conn, rid) for rid in run_ids]
    run_labels = [r["label"] or f"Run {r['id']}" for r in run_rows]

    print(f"Generating outlook from runs: {run_labels}")

    def progress(step, i, total):
        print(f"[{i}/{total}] {step}")

    sections = generate_outlook(conn, run_ids, progress_callback=progress)
    output_path = args.output or next_output_path(STATIC_DIR)
    path = build_outlook_pdf(run_labels, sections, output_path)
    print(f"Saved: {path}")


if __name__ == "__main__":
    main()
