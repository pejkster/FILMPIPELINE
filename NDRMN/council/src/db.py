import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "db" / "council.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def get_topics(conn):
    return conn.execute("SELECT * FROM topics ORDER BY id").fetchall()


def get_models(conn):
    return conn.execute("SELECT * FROM models ORDER BY id").fetchall()


def create_run(conn, label=None) -> int:
    cur = conn.execute("INSERT INTO runs (label) VALUES (?)", (label,))
    conn.commit()
    return cur.lastrowid


def get_run(conn, run_id):
    return conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()


def statement_exists(conn, run_id, model_id, topic_id, round_) -> bool:
    row = conn.execute(
        "SELECT 1 FROM statements WHERE run_id = ? AND model_id = ? AND topic_id = ? AND round = ?",
        (run_id, model_id, topic_id, round_),
    ).fetchone()
    return row is not None


def insert_statement(conn, run_id, model_id, topic_id, round_, text, rationale, revision_score):
    cur = conn.execute(
        "INSERT INTO statements (run_id, model_id, topic_id, round, text, rationale, revision_score) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (run_id, model_id, topic_id, round_, text, rationale, revision_score),
    )
    conn.commit()
    return cur.lastrowid


def get_statements_for_round(conn, run_id, topic_id, round_):
    """Returns {model_id: row} for every statement recorded for this run/topic/round."""
    rows = conn.execute(
        "SELECT * FROM statements WHERE run_id = ? AND topic_id = ? AND round = ?",
        (run_id, topic_id, round_),
    ).fetchall()
    return {row["model_id"]: row for row in rows}


def feedback_exists(conn, run_id, reviewer_model_id, topic_id, round_) -> bool:
    row = conn.execute(
        "SELECT 1 FROM feedback WHERE run_id = ? AND reviewer_model_id = ? AND topic_id = ? AND round = ? LIMIT 1",
        (run_id, reviewer_model_id, topic_id, round_),
    ).fetchone()
    return row is not None


def insert_feedback(conn, run_id, reviewer_model_id, statement_id, topic_id, round_, score, text):
    conn.execute(
        "INSERT INTO feedback (run_id, reviewer_model_id, statement_id, topic_id, round, score, text) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (run_id, reviewer_model_id, statement_id, topic_id, round_, score, text),
    )
    conn.commit()


def get_feedback_for_statement(conn, statement_id):
    return conn.execute(
        "SELECT * FROM feedback WHERE statement_id = ? ORDER BY id",
        (statement_id,),
    ).fetchall()


def get_runs(conn):
    return conn.execute("SELECT * FROM runs ORDER BY id DESC").fetchall()


def get_latest_round(conn, run_id, topic_id):
    """Returns the highest round number recorded for this run/topic, or None if none yet."""
    row = conn.execute(
        "SELECT MAX(round) AS latest FROM statements WHERE run_id = ? AND topic_id = ?",
        (run_id, topic_id),
    ).fetchone()
    return row["latest"]


def get_statement(conn, run_id, model_id, topic_id, round_):
    return conn.execute(
        "SELECT * FROM statements WHERE run_id = ? AND model_id = ? AND topic_id = ? AND round = ?",
        (run_id, model_id, topic_id, round_),
    ).fetchone()


def get_human_review(conn, statement_id, reviewer_name):
    return conn.execute(
        "SELECT * FROM human_reviews WHERE statement_id = ? AND reviewer_name = ?",
        (statement_id, reviewer_name),
    ).fetchone()


def upsert_human_review(conn, statement_id, reviewer_name, score):
    conn.execute(
        "INSERT INTO human_reviews (statement_id, reviewer_name, score) VALUES (?, ?, ?) "
        "ON CONFLICT(statement_id, reviewer_name) DO UPDATE SET "
        "score = excluded.score, created_at = datetime('now')",
        (statement_id, reviewer_name, score),
    )
    conn.commit()


def get_topic_score_stats(conn, run_id, topic_id):
    """Aggregates all peer-feedback scores ever given on any round's statements
    for this topic within this run."""
    return conn.execute(
        "SELECT AVG(f.score) AS avg, MIN(f.score) AS min, MAX(f.score) AS max, COUNT(*) AS count "
        "FROM feedback f JOIN statements s ON s.id = f.statement_id "
        "WHERE f.run_id = ? AND s.topic_id = ?",
        (run_id, topic_id),
    ).fetchone()
