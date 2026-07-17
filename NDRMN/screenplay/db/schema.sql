PRAGMA foreign_keys = ON;

-- One row per pipeline invocation, so multiple attempts at this process can
-- be kept distinct and compared, same pattern as the council's runs table.
CREATE TABLE runs (
    id          INTEGER PRIMARY KEY,
    label       TEXT,
    started_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (run, step, role) — the output that role produced at that
-- step. content holds the raw JSON the model returned. Steps:
--   1 = grounding brief        (style_guardian, story_guardian, futurist, project_guardian)
--   2 = first draft, relay     (screenwriter, creative_director, editor)
--   3 = guardian review        (style_guardian, story_guardian, futurist, project_guardian)
--   4 = revision, relay        (screenwriter, creative_director, editor)
--   5 = guardian sign-off      (style_guardian, story_guardian, futurist, project_guardian)
--   6 = advisory + final       (producer, outside_critic, screenwriter)
CREATE TABLE artifacts (
    id              INTEGER PRIMARY KEY,
    run_id          INTEGER NOT NULL REFERENCES runs(id),
    step            INTEGER NOT NULL,
    role            TEXT NOT NULL,
    artifact_type   TEXT NOT NULL,
    content         TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (run_id, step, role)
);

CREATE INDEX idx_artifacts_run_step ON artifacts(run_id, step);
