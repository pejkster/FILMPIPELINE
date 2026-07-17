from pathlib import Path

from src import db, roles
from src.openrouter_client import call_model
from src.parsing import parse_json
from src.prompts import fill, load_template

REFERENCE_DIR = Path(__file__).resolve().parent.parent / "reference"


def _load_source(filename):
    return (REFERENCE_DIR / filename).read_text()


def _artifacts_text(conn, run_id, step, role_list):
    artifacts = db.get_artifacts_for_step(conn, run_id, step)
    blocks = []
    for role in role_list:
        row = artifacts.get(role)
        if row is None:
            continue
        display = roles.ROLE_INFO[role]["display_name"]
        blocks.append(f"### {display}\n{row['content']}")
    return "\n\n".join(blocks) if blocks else "(none)"


def _get_relay_draft(conn, run_id, step):
    """Returns the treatment produced by the last generative role at this
    step — the relay's final output (always the Editor, last in GENERATIVE)."""
    artifacts = db.get_artifacts_for_step(conn, run_id, step)
    for role in reversed(roles.GENERATIVE):
        row = artifacts.get(role)
        if row is not None:
            parsed = parse_json(row["content"])
            return parsed.get("treatment", "")
    return ""


def _run_generative_relay(conn, run_id, step, guardian_briefs, starting_draft, guardian_notes, progress_callback=None):
    current_draft = starting_draft
    for i, role in enumerate(roles.GENERATIVE, start=1):
        if db.artifact_exists(conn, run_id, step, role):
            parsed = parse_json(db.get_artifact(conn, run_id, step, role)["content"])
            current_draft = parsed.get("treatment", current_draft)
            continue
        if progress_callback:
            progress_callback(f"Step {step}: {roles.ROLE_INFO[role]['display_name']}", i, len(roles.GENERATIVE))
        template = load_template(roles.ROLE_INFO[role]["prompt_file"])
        prompt = fill(
            template,
            GUARDIAN_BRIEFS=guardian_briefs,
            CURRENT_DRAFT=current_draft,
            GUARDIAN_NOTES=guardian_notes,
        )
        response = call_model(roles.OPENROUTER_ID, prompt)
        db.insert_artifact(conn, run_id, step, role, "draft", response)
        parsed = parse_json(response)
        current_draft = parsed.get("treatment", current_draft)
    return current_draft


def run_step1_grounding(conn, run_id, progress_callback=None):
    template = load_template("guardian_brief_prompt.md")
    for i, role in enumerate(roles.BINDING_GUARDIANS, start=1):
        if db.artifact_exists(conn, run_id, 1, role):
            continue
        info = roles.ROLE_INFO[role]
        if progress_callback:
            progress_callback(f"Step 1: {info['display_name']} brief", i, len(roles.BINDING_GUARDIANS))
        source = _load_source(info["source_file"])
        prompt = fill(template, ROLE_MANDATE=info["mandate"], SOURCE_MATERIAL=source)
        response = call_model(roles.OPENROUTER_ID, prompt)
        db.insert_artifact(conn, run_id, 1, role, "brief", response)


def run_step2_first_draft(conn, run_id, progress_callback=None):
    guardian_briefs = _artifacts_text(conn, run_id, 1, roles.BINDING_GUARDIANS)
    _run_generative_relay(conn, run_id, 2, guardian_briefs, "", "(none yet — this is the first draft)", progress_callback)


def run_step3_review(conn, run_id, progress_callback=None):
    draft = _get_relay_draft(conn, run_id, 2)
    template = load_template("guardian_review_prompt.md")
    for i, role in enumerate(roles.BINDING_GUARDIANS, start=1):
        if db.artifact_exists(conn, run_id, 3, role):
            continue
        info = roles.ROLE_INFO[role]
        if progress_callback:
            progress_callback(f"Step 3: {info['display_name']} review", i, len(roles.BINDING_GUARDIANS))
        own_brief = db.get_artifact(conn, run_id, 1, role)["content"]
        prompt = fill(template, ROLE_MANDATE=info["mandate"], OWN_BRIEF=own_brief, CURRENT_DRAFT=draft)
        response = call_model(roles.OPENROUTER_ID, prompt)
        db.insert_artifact(conn, run_id, 3, role, "review", response)


def run_step4_revision(conn, run_id, progress_callback=None):
    guardian_briefs = _artifacts_text(conn, run_id, 1, roles.BINDING_GUARDIANS)
    guardian_notes = _artifacts_text(conn, run_id, 3, roles.BINDING_GUARDIANS)
    starting_draft = _get_relay_draft(conn, run_id, 2)
    _run_generative_relay(conn, run_id, 4, guardian_briefs, starting_draft, guardian_notes, progress_callback)


def run_step5_signoff(conn, run_id, progress_callback=None):
    draft = _get_relay_draft(conn, run_id, 4)
    template = load_template("guardian_signoff_prompt.md")
    for i, role in enumerate(roles.BINDING_GUARDIANS, start=1):
        if db.artifact_exists(conn, run_id, 5, role):
            continue
        info = roles.ROLE_INFO[role]
        if progress_callback:
            progress_callback(f"Step 5: {info['display_name']} sign-off", i, len(roles.BINDING_GUARDIANS))
        own_review = db.get_artifact(conn, run_id, 3, role)["content"]
        prompt = fill(template, ROLE_MANDATE=info["mandate"], OWN_REVIEW_NOTES=own_review, REVISED_DRAFT=draft)
        response = call_model(roles.OPENROUTER_ID, prompt)
        db.insert_artifact(conn, run_id, 5, role, "signoff", response)


def run_step6_final(conn, run_id, progress_callback=None):
    draft = _get_relay_draft(conn, run_id, 4)

    if not db.artifact_exists(conn, run_id, 6, "producer"):
        if progress_callback:
            progress_callback("Step 6: Producer review", 1, 3)
        template = load_template("producer_prompt.md")
        response = call_model(roles.OPENROUTER_ID, fill(template, DRAFT=draft))
        db.insert_artifact(conn, run_id, 6, "producer", "advisory", response)

    if not db.artifact_exists(conn, run_id, 6, "outside_critic"):
        if progress_callback:
            progress_callback("Step 6: Outside Critic review", 2, 3)
        template = load_template("critic_prompt.md")
        response = call_model(roles.OPENROUTER_ID, fill(template, DRAFT=draft))
        db.insert_artifact(conn, run_id, 6, "outside_critic", "advisory", response)

    if not db.artifact_exists(conn, run_id, 6, "screenwriter"):
        if progress_callback:
            progress_callback("Step 6: Final polish", 3, 3)
        producer_notes = db.get_artifact(conn, run_id, 6, "producer")["content"]
        critic_notes = db.get_artifact(conn, run_id, 6, "outside_critic")["content"]
        template = load_template("final_polish_prompt.md")
        prompt = fill(template, DRAFT=draft, PRODUCER_NOTES=producer_notes, CRITIC_NOTES=critic_notes)
        response = call_model(roles.OPENROUTER_ID, prompt)
        db.insert_artifact(conn, run_id, 6, "screenwriter", "final", response)


def run_pipeline(conn, run_id, progress_callback=None):
    run_step1_grounding(conn, run_id, progress_callback)
    run_step2_first_draft(conn, run_id, progress_callback)
    run_step3_review(conn, run_id, progress_callback)
    run_step4_revision(conn, run_id, progress_callback)
    run_step5_signoff(conn, run_id, progress_callback)
    run_step6_final(conn, run_id, progress_callback)
