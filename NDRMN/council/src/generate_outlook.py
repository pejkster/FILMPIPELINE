import argparse
from pathlib import Path

from src import db
from src.outlook import generate_outlook
from src.pdf_outlook import STATIC_DIR, build_outlook_pdf


def main():
    parser = argparse.ArgumentParser(description="Generate The Metanoia Outlook")
    parser.add_argument("--runs", help="Comma-separated run ids (default: all runs)")
    parser.add_argument("--output", type=Path, default=STATIC_DIR / "metanoia_outlook.pdf")
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
    path = build_outlook_pdf(run_labels, sections, args.output)
    print(f"Saved: {path}")


if __name__ == "__main__":
    main()
