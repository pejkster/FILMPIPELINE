import sys
from pathlib import Path

import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import db, roles  # noqa: E402
from src.parsing import parse_json  # noqa: E402
from src.pipeline import run_pipeline  # noqa: E402
from src.export_screenplay import export as export_screenplay, screenplay_pdf_path  # noqa: E402

st.set_page_config(page_title="Metanoia Screenplay", layout="wide")

conn = db.get_connection()

# --- Sidebar ---
st.sidebar.title("Metanoia Screenplay")

runs = db.get_runs(conn)
run_labels = {f"Run {r['id']} — {r['label'] or 'untitled'}": r["id"] for r in runs}

new_run_label = st.sidebar.text_input("New run label", placeholder="e.g. first attempt")
if st.sidebar.button("Start new run"):
    new_id = db.create_run(conn, label=new_run_label or None)
    st.session_state["selected_run"] = new_id
    st.rerun()

if not runs:
    st.info("No runs yet — start one from the sidebar.")
    st.stop()

default_run = st.session_state.get("selected_run", runs[0]["id"])
default_label = next((k for k, v in run_labels.items() if v == default_run), list(run_labels.keys())[0])
run_choice = st.sidebar.selectbox("Run", list(run_labels.keys()), index=list(run_labels.keys()).index(default_label))
run_id = run_labels[run_choice]

if st.sidebar.button("Run / Resume Pipeline", type="primary"):
    status_box = st.sidebar.status("Running pipeline...", expanded=True)

    def _progress(label, i, total):
        status_box.update(label=f"{label} ({i}/{total})")

    run_pipeline(conn, run_id, progress_callback=_progress)
    status_box.update(label="Pipeline complete", state="complete")
    st.rerun()

if st.sidebar.button("Refresh"):
    st.rerun()

# If the final screenplay exists for this run, make sure a PDF is generated
# (no button — this just happens once Step 6 is done) and link to it.
final_artifact = db.get_artifact(conn, run_id, 6, "screenwriter")
if final_artifact is not None:
    pdf_path = screenplay_pdf_path(run_id)
    if not pdf_path.exists():
        export_screenplay(run_id)
    st.sidebar.markdown(
        f'📄 <a href="app/static/{pdf_path.name}" target="_blank">Open Screenplay</a>',
        unsafe_allow_html=True,
    )

# --- Main area ---
st.title(run_choice)


def render_artifact(role_key, row):
    display = roles.ROLE_INFO[role_key]["display_name"]
    try:
        parsed = parse_json(row["content"])
    except ValueError:
        st.markdown(f"**{display}**")
        st.text(row["content"])
        return

    st.markdown(f"**{display}**")

    if "must_haves" in parsed:
        st.markdown("*Must-haves:*")
        for item in parsed.get("must_haves", []):
            st.markdown(f"- {item}")
        st.markdown("*Red lines:*")
        for item in parsed.get("red_lines", []):
            st.markdown(f"- {item}")
        st.markdown("*Opportunities:*")
        for item in parsed.get("opportunities", []):
            st.markdown(f"- {item}")

    elif "required_changes" in parsed:
        if parsed.get("clean"):
            st.success("No required changes.")
        for item in parsed.get("required_changes", []):
            st.markdown(f"- **{item.get('issue', '')}**: {item.get('detail', '')}")

    elif "resolved" in parsed or "still_open" in parsed:
        status = "✅ Signed off" if parsed.get("signed_off") else "⚠️ Not signed off"
        st.markdown(status)
        if parsed.get("resolved"):
            st.markdown("*Resolved:* " + ", ".join(parsed["resolved"]))
        for item in parsed.get("still_open", []):
            st.markdown(f"- **{item.get('issue', '')}**: {item.get('detail', '')}")

    elif "treatment" in parsed:
        if parsed.get("structure_notes"):
            st.caption(parsed["structure_notes"])
        st.write(parsed["treatment"])

    elif "notes" in parsed:
        for item in parsed.get("notes", []):
            st.markdown(f"- **{item.get('issue', '')}**: {item.get('detail', '')}")

    elif "confusing_points" in parsed:
        for item in parsed.get("confusing_points", []):
            st.markdown(f"- **{item.get('issue', '')}**: {item.get('detail', '')}")
        if parsed.get("emotional_response"):
            st.markdown(f"*Emotional response:* {parsed['emotional_response']}")

    elif "screenplay" in parsed:
        st.header(parsed.get("title", "Untitled"))
        st.write(parsed["screenplay"])

    else:
        st.json(parsed)


for step_num in range(1, 7):
    step_name = roles.STEP_NAMES[step_num]
    artifacts = db.get_artifacts_for_step(conn, run_id, step_num)

    with st.expander(f"Step {step_num} — {step_name} ({len(artifacts)} artifacts)", expanded=bool(artifacts)):
        if not artifacts:
            st.caption("Not run yet.")
            continue
        for role_key, row in artifacts.items():
            with st.container(border=True):
                render_artifact(role_key, row)
