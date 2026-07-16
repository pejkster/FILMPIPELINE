from src import db
from src.openrouter_client import call_model
from src.parsing import parse_json
from src.prompts import fill, load_template

WRITER_OPENROUTER_ID = "anthropic/claude-opus-4.8"


def _format_statements(entries) -> str:
    blocks = []
    for run_id, model, stmt in entries:
        blocks.append(f"[Run {run_id} — {model['name']}]\n{stmt['text']}")
    return "\n\n".join(blocks)


def _format_list(items, key_a, key_b) -> str:
    if not items:
        return "(none)"
    lines = []
    for item in items:
        lines.append(f"- {item.get(key_a, '')}: {item.get(key_b, '')}")
    return "\n".join(lines)


def extract_topic_findings(conn, run_ids, topic, models) -> dict:
    entries = db.get_final_statements_for_topic_across_runs(conn, run_ids, topic["id"], models)

    template = load_template("outlook_extraction")
    prompt = fill(
        template,
        TOPIC_NAME=topic["name"],
        STATEMENT_COUNT=len(entries),
        RUN_COUNT=len(run_ids),
        ALL_STATEMENTS=_format_statements(entries),
    )
    response = call_model(WRITER_OPENROUTER_ID, prompt)
    return parse_json(response)


def write_topic_section(topic, findings: dict) -> dict:
    template = load_template("outlook_writing")
    prompt = fill(
        template,
        TOPIC_NAME=topic["name"],
        CONSENSUS=_format_list(findings.get("consensus", []), "theme", "detail"),
        STANDOUT_IDEAS=_format_list(findings.get("standout_ideas", []), "idea", "detail"),
    )
    response = call_model(WRITER_OPENROUTER_ID, prompt)
    return parse_json(response)


def generate_outlook(conn, run_ids, progress_callback=None) -> list:
    """Returns [(topic, findings, section), ...] for every topic."""
    topics = db.get_topics(conn)
    models = db.get_models(conn)

    results = []
    for i, topic in enumerate(topics, start=1):
        if progress_callback:
            progress_callback(f"Researching {topic['name']}", i, len(topics))
        findings = extract_topic_findings(conn, run_ids, topic, models)

        if progress_callback:
            progress_callback(f"Writing {topic['name']}", i, len(topics))
        section = write_topic_section(topic, findings)

        results.append((topic, findings, section))

    return results
