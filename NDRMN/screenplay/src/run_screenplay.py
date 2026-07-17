import argparse

from src import db
from src.pipeline import run_pipeline


def main():
    parser = argparse.ArgumentParser(description="Run the Metanoia screenplay pipeline")
    parser.add_argument("--new-run", action="store_true")
    parser.add_argument("--run", type=int, help="Resume an existing run by id")
    parser.add_argument("--label", help="Optional label for a new run")
    args = parser.parse_args()

    if not args.new_run and not args.run:
        raise SystemExit("Specify --new-run or --run <id>")

    conn = db.get_connection()

    if args.new_run:
        run_id = db.create_run(conn, label=args.label)
        print(f"Started run {run_id}" + (f" ({args.label})" if args.label else ""))
    else:
        run_row = db.get_run(conn, args.run)
        if run_row is None:
            raise SystemExit(f"No run with id {args.run}")
        run_id = args.run
        print(f"Resuming run {run_id}" + (f" ({run_row['label']})" if run_row["label"] else ""))

    def progress(step_label, i, total):
        print(f"[{i}/{total}] {step_label}")

    run_pipeline(conn, run_id, progress_callback=progress)
    print(f"Done. Run {run_id} complete.")


if __name__ == "__main__":
    main()
