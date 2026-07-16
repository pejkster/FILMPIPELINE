from src import db
from src.openrouter_client import call_model
from src.parsing import parse_json
from src.prompts import fill, load_template

ANALYST_OPENROUTER_ID = "anthropic/claude-opus-4.8"


def _format_score_summary(stats) -> str:
    if stats is None or stats["count"] == 0:
        return "No peer feedback was recorded for this topic."
    return (
        f"Peer feedback averaged {stats['avg']:.2f}/5 "
        f"(range {stats['min']}-{stats['max']}, {stats['count']} ratings total)."
    )


def analyze_topic(conn, run_id, topic, models):
    """Returns a dict with 'summary', 'similarities', 'differences' for one topic."""
    latest_round = db.get_latest_round(conn, run_id, topic["id"])
    if latest_round is None:
        return {"summary": "No statements recorded for this topic.", "similarities": [], "differences": []}

    statements = db.get_statements_for_round(conn, run_id, topic["id"], latest_round)
    stats = db.get_topic_score_stats(conn, run_id, topic["id"])

    kwargs = {
        "TOPIC_NAME": topic["name"],
        "SCORE_SUMMARY": _format_score_summary(stats),
    }
    for i, model in enumerate(models, start=1):
        stmt = statements.get(model["id"])
        kwargs[f"MODEL_{i}_NAME"] = model["name"]
        kwargs[f"MODEL_{i}_STATEMENT"] = stmt["text"] if stmt else "(no statement recorded)"

    template = load_template("analysis")
    prompt = fill(template, **kwargs)
    response = call_model(ANALYST_OPENROUTER_ID, prompt)
    return parse_json(response)


def generate_report_data(conn, run_id, progress_callback=None):
    """Runs the analysis for every topic in a run. progress_callback(topic_name,
    index, total) is called before each topic, if provided.
    Returns (run_row, [(topic, analysis), ...])."""
    run_row = db.get_run(conn, run_id)
    topics = db.get_topics(conn)
    models = db.get_models(conn)

    results = []
    for i, topic in enumerate(topics, start=1):
        if progress_callback:
            progress_callback(topic["name"], i, len(topics))
        analysis = analyze_topic(conn, run_id, topic, models)
        results.append((topic, analysis))

    return run_row, results
