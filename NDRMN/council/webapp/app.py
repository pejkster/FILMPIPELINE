import sys
from pathlib import Path

import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import db  # noqa: E402

REVIEWER_NAMES = ["Dirk", "Nejc"]

st.set_page_config(page_title="Metanoia Council", layout="wide")

conn = db.get_connection()

# --- Sidebar ---
st.sidebar.title("Metanoia Council")

reviewer_name = st.sidebar.selectbox("Who are you?", REVIEWER_NAMES)

if st.sidebar.button("Refresh"):
    st.rerun()

runs = db.get_runs(conn)
if not runs:
    st.warning("No runs found yet.")
    st.stop()

run_labels = {f"Run {r['id']} — {r['label'] or 'untitled'}": r["id"] for r in runs}
run_choice = st.sidebar.selectbox("Run", list(run_labels.keys()))
run_id = run_labels[run_choice]

st.sidebar.divider()

from src.pdf_report import STATIC_DIR, build_report_pdf  # noqa: E402

report_filename = f"run{run_id}_report.pdf"
report_path = STATIC_DIR / report_filename

if not report_path.exists() and st.sidebar.button("Generate Report"):
    from src.report import generate_report_data  # noqa: E402

    status_box = st.sidebar.status("Generating report...", expanded=True)

    def _progress(topic_name, i, total):
        status_box.update(label=f"Analyzing {topic_name} ({i}/{total})...")

    run_row, results = generate_report_data(conn, run_id, progress_callback=_progress)
    build_report_pdf(run_row, results, report_path)
    status_box.update(label="Report ready", state="complete")

if report_path.exists():
    st.sidebar.markdown(
        f'<a href="app/static/{report_filename}" target="_blank">📄 Open Report</a>',
        unsafe_allow_html=True,
    )

topics = db.get_topics(conn)
topic_by_name = {t["name"]: t for t in topics}
topic_choice = st.sidebar.radio("Topic", list(topic_by_name.keys()))
topic = topic_by_name[topic_choice]

models = db.get_models(conn)
models_by_id = {m["id"]: m for m in models}

# --- Main area ---
st.title(topic["name"])

latest_round = db.get_latest_round(conn, run_id, topic["id"])

if latest_round is None:
    st.info("No statements recorded yet for this topic in this run.")
    st.stop()

statements = db.get_statements_for_round(conn, run_id, topic["id"], latest_round)

for model in models:
    stmt = statements.get(model["id"])
    if stmt is None:
        continue

    with st.container(border=True):
        st.subheader(f"{model['name']} ({model['lab']})")
        st.write(stmt["text"])

        # One block per round: that round's text (if not the current one already
        # shown above) plus the peer feedback that version received — feedback
        # always belongs to the round that *led to* a revision, never to the
        # newest round itself, so it has to be shown per-round, not just latest.
        round_blocks = []
        for r in range(1, latest_round + 1):
            hist = db.get_statement(conn, run_id, model["id"], topic["id"], r)
            if hist is None:
                continue
            round_feedback = db.get_feedback_for_statement(conn, hist["id"])
            round_blocks.append((r, hist, round_feedback))

        total_feedback = sum(len(fb) for _, _, fb in round_blocks)

        if latest_round > 1 or total_feedback > 0:
            with st.expander(f"History & peer feedback ({total_feedback} reviews)"):
                for r, hist, round_feedback in round_blocks:
                    label = "Original (round 1)" if r == 1 else f"Round {r}"
                    if r > 1:
                        label += f" — revision score {hist['revision_score']}"
                    st.markdown(f"**{label}**")

                    if r < latest_round:
                        st.write(hist["text"])
                    if hist["rationale"]:
                        st.caption(f"Rationale: {hist['rationale']}")

                    if round_feedback:
                        st.markdown(f"_Peer feedback on this version ({len(round_feedback)}):_")
                        for rev in round_feedback:
                            reviewer = models_by_id.get(rev["reviewer_model_id"])
                            reviewer_label = reviewer["name"] if reviewer else "Unknown"
                            st.markdown(f"- **{reviewer_label}** — {rev['score']}/5: {rev['text']}")
                    else:
                        st.caption("(no peer feedback recorded on this version)")

                    st.divider()

        rating_cols = st.columns(len(REVIEWER_NAMES))
        for col, name in zip(rating_cols, REVIEWER_NAMES):
            with col:
                st.caption(f"{name}'s rating")
                if name == reviewer_name:
                    rating_key = f"rating_{stmt['id']}_{name}"
                    if rating_key not in st.session_state:
                        existing = db.get_human_review(conn, stmt["id"], name)
                        st.session_state[rating_key] = (existing["score"] - 1) if existing else None
                    rating = st.feedback("stars", key=rating_key)
                    if rating is not None:
                        db.upsert_human_review(conn, stmt["id"], name, rating + 1)
                else:
                    other_review = db.get_human_review(conn, stmt["id"], name)
                    if other_review:
                        stars = "★" * other_review["score"] + "☆" * (5 - other_review["score"])
                        st.markdown(f"##### {stars}")
                    else:
                        st.caption("Not rated yet")
