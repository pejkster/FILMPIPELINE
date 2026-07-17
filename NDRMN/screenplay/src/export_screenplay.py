import argparse
from pathlib import Path

from src import db
from src.parsing import parse_json
from src.pdf_screenplay import STATIC_DIR, build_screenplay_pdf


def screenplay_pdf_path(run_id: int) -> Path:
    return STATIC_DIR / f"screenplay_run{run_id}.pdf"


def export(run_id: int) -> Path:
    conn = db.get_connection()
    run_row = db.get_run(conn, run_id)
    if run_row is None:
        raise SystemExit(f"No run with id {run_id}")

    row = db.get_artifact(conn, run_id, 6, "screenwriter")
    if row is None:
        raise SystemExit(f"Run {run_id} has no finished screenplay yet (Step 6 not complete)")

    parsed = parse_json(row["content"])
    title = parsed.get("title", "Untitled")
    screenplay = parsed.get("screenplay", "")
    label = run_row["label"] or f"Run {run_id}"

    return build_screenplay_pdf(title, label, run_id, screenplay, screenplay_pdf_path(run_id))


def main():
    parser = argparse.ArgumentParser(description="Export a finished screenplay to PDF")
    parser.add_argument("--run", type=int, required=True)
    args = parser.parse_args()
    path = export(args.run)
    print(f"Saved: {path}")


if __name__ == "__main__":
    main()
