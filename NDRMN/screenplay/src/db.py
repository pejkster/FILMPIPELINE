import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "db" / "screenplay.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def create_run(conn, label=None) -> int:
    cur = conn.execute("INSERT INTO runs (label) VALUES (?)", (label,))
    conn.commit()
    return cur.lastrowid


def get_run(conn, run_id):
    return conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()


def get_runs(conn):
    return conn.execute("SELECT * FROM runs ORDER BY id DESC").fetchall()


def artifact_exists(conn, run_id, step, role) -> bool:
    row = conn.execute(
        "SELECT 1 FROM artifacts WHERE run_id = ? AND step = ? AND role = ?",
        (run_id, step, role),
    ).fetchone()
    return row is not None


def get_artifact(conn, run_id, step, role):
    return conn.execute(
        "SELECT * FROM artifacts WHERE run_id = ? AND step = ? AND role = ?",
        (run_id, step, role),
    ).fetchone()


def insert_artifact(conn, run_id, step, role, artifact_type, content):
    conn.execute(
        "INSERT INTO artifacts (run_id, step, role, artifact_type, content) "
        "VALUES (?, ?, ?, ?, ?)",
        (run_id, step, role, artifact_type, content),
    )
    conn.commit()


def get_artifacts_for_step(conn, run_id, step):
    rows = conn.execute(
        "SELECT * FROM artifacts WHERE run_id = ? AND step = ? ORDER BY id",
        (run_id, step),
    ).fetchall()
    return {row["role"]: row for row in rows}


def get_all_artifacts(conn, run_id):
    return conn.execute(
        "SELECT * FROM artifacts WHERE run_id = ? ORDER BY step, id",
        (run_id,),
    ).fetchall()
