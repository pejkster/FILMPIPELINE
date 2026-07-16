import argparse
import random

from src import db
from src.openrouter_client import call_model
from src.parsing import parse_json
from src.prompts import fill, load_template

MAX_ROUNDS_DEFAULT = 10
LABELS = ["A", "B", "C", "D", "E"]


def run_statement_call(conn, run_id, model, topic, round_=1):
    if db.statement_exists(conn, run_id, model["id"], topic["id"], round_):
        return
    template = load_template("statement")
    prompt = fill(template, TOPIC_NAME=topic["name"])
    text = call_model(model["openrouter_id"], prompt)
    db.insert_statement(
        conn, run_id, model["id"], topic["id"], round_,
        text=text.strip(), rationale=None, revision_score=0,
    )


def run_round1(conn, run_id, topics, models):
    for topic in topics:
        for model in models:
            print(f"[round1] {model['name']} / {topic['name']}")
            run_statement_call(conn, run_id, model, topic, round_=1)


def run_feedback_round(conn, run_id, topic, models, round_):
    statements = db.get_statements_for_round(conn, run_id, topic["id"], round_)
    if len(statements) != len(models):
        raise RuntimeError(
            f"Expected {len(models)} statements for run {run_id}, topic '{topic['slug']}' "
            f"round {round_}, found {len(statements)} — an earlier step is incomplete, "
            f"run round1/that revision round again before continuing."
        )

    template = load_template("feedback")

    for reviewer in models:
        if db.feedback_exists(conn, run_id, reviewer["id"], topic["id"], round_):
            continue

        others = [(mid, stmt) for mid, stmt in statements.items() if mid != reviewer["id"]]
        shuffled = random.sample(others, len(others))
        label_map = {LABELS[i]: shuffled[i] for i in range(len(shuffled))}

        kwargs = {"TOPIC_NAME": topic["name"]}
        for label, (_mid, stmt) in label_map.items():
            kwargs[f"STATEMENT_{label}"] = stmt["text"]

        prompt = fill(template, **kwargs)
        print(f"[feedback] {reviewer['name']} / {topic['name']} (round {round_})")
        response = call_model(reviewer["openrouter_id"], prompt)
        reviews = parse_json(response)

        for review in reviews:
            _mid, stmt = label_map[review["label"]]
            db.insert_feedback(
                conn, run_id, reviewer["id"], stmt["id"], topic["id"], round_,
                score=int(review["score"]), text=review["feedback"],
            )


def run_revision_round(conn, run_id, topic, models, round_):
    """Revises round_ statements into round_ + 1. Returns True if any model made
    a major (score 2) revision this round."""
    prev_statements = db.get_statements_for_round(conn, run_id, topic["id"], round_)
    template = load_template("revision")
    any_major = False

    for model in models:
        existing = conn.execute(
            "SELECT revision_score FROM statements "
            "WHERE run_id = ? AND model_id = ? AND topic_id = ? AND round = ?",
            (run_id, model["id"], topic["id"], round_ + 1),
        ).fetchone()
        if existing is not None:
            if existing["revision_score"] == 2:
                any_major = True
            continue

        stmt = prev_statements[model["id"]]
        reviews = db.get_feedback_for_statement(conn, stmt["id"])

        kwargs = {"TOPIC_NAME": topic["name"], "CURRENT_STATEMENT": stmt["text"]}
        for i, review in enumerate(reviews, start=1):
            kwargs[f"SCORE_{i}"] = review["score"]
            kwargs[f"FEEDBACK_{i}"] = review["text"]

        prompt = fill(template, **kwargs)
        print(f"[revision] {model['name']} / {topic['name']} (round {round_} -> {round_ + 1})")
        response = call_model(model["openrouter_id"], prompt)
        result = parse_json(response)

        revision_score = int(result["revision_score"])
        db.insert_statement(
            conn, run_id, model["id"], topic["id"], round_ + 1,
            text=result["statement"].strip(),
            rationale=result.get("rationale"),
            revision_score=revision_score,
        )
        if revision_score == 2:
            any_major = True

    return any_major


def run_topic_loop(conn, run_id, topic, models, max_rounds=MAX_ROUNDS_DEFAULT):
    round_ = 1
    while round_ <= max_rounds:
        run_feedback_round(conn, run_id, topic, models, round_)
        any_major = run_revision_round(conn, run_id, topic, models, round_)
        if not any_major:
            print(f"[closed] {topic['name']} settled after round {round_}")
            return
        round_ += 1
    print(f"[capped] {topic['name']} hit the {max_rounds}-round safety cap")


def main():
    parser = argparse.ArgumentParser(description="Run the Metanoia LLM council pipeline")
    parser.add_argument("--mode", choices=["smoke", "round1", "full"], default="smoke")
    parser.add_argument("--topic", help="Restrict to a single topic slug")
    parser.add_argument("--max-rounds", type=int, default=MAX_ROUNDS_DEFAULT)

    run_group = parser.add_mutually_exclusive_group(required=True)
    run_group.add_argument("--new-run", action="store_true", help="Start a new run")
    run_group.add_argument("--run", type=int, help="Resume an existing run by id")
    parser.add_argument("--label", help="Optional label for a new run")

    args = parser.parse_args()

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

    topics = [dict(t) for t in db.get_topics(conn)]
    models = [dict(m) for m in db.get_models(conn)]

    if args.topic:
        topics = [t for t in topics if t["slug"] == args.topic]
        if not topics:
            raise SystemExit(f"Unknown topic slug: {args.topic}")

    if args.mode == "smoke":
        # One model, one topic, round 1 only — a cheap sanity check (env, auth,
        # DB write) before spending on a full run.
        run_statement_call(conn, run_id, models[0], topics[0], round_=1)
        row = db.get_statements_for_round(conn, run_id, topics[0]["id"], 1)[models[0]["id"]]
        print("Smoke test OK. Sample statement:\n")
        print(row["text"])
        return

    run_round1(conn, run_id, topics, models)

    if args.mode == "full":
        for topic in topics:
            run_topic_loop(conn, run_id, topic, models, max_rounds=args.max_rounds)


if __name__ == "__main__":
    main()
