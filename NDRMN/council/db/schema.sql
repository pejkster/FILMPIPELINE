PRAGMA foreign_keys = ON;

CREATE TABLE topics (
    id      INTEGER PRIMARY KEY,
    slug    TEXT NOT NULL UNIQUE,
    name    TEXT NOT NULL
);

CREATE TABLE models (
    id              INTEGER PRIMARY KEY,
    lab             TEXT NOT NULL,
    name            TEXT NOT NULL,
    openrouter_id   TEXT NOT NULL UNIQUE
);

-- One row per pipeline invocation that should be kept distinct from any other
-- (e.g. a full council session run today vs. one rerun next month after a
-- prompt tweak). label is optional, purely a human-friendly identifier.
CREATE TABLE runs (
    id          INTEGER PRIMARY KEY,
    label       TEXT,
    started_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (run, model, topic, round). Round 1 rows are the initial
-- statements (revision_score = 0 by convention, rationale = NULL). Round 2+
-- rows come from the revision prompt and always carry a rationale.
CREATE TABLE statements (
    id              INTEGER PRIMARY KEY,
    run_id          INTEGER NOT NULL REFERENCES runs(id),
    model_id        INTEGER NOT NULL REFERENCES models(id),
    topic_id        INTEGER NOT NULL REFERENCES topics(id),
    round           INTEGER NOT NULL,
    text            TEXT NOT NULL,
    rationale       TEXT,
    revision_score  INTEGER NOT NULL CHECK (revision_score IN (0, 1, 2)),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (run_id, model_id, topic_id, round)
);

-- One row per (reviewer, target statement). run_id/topic_id/round are
-- denormalized copies of the target statement's own values, kept here purely
-- to filter without a join.
CREATE TABLE feedback (
    id                  INTEGER PRIMARY KEY,
    run_id              INTEGER NOT NULL REFERENCES runs(id),
    reviewer_model_id   INTEGER NOT NULL REFERENCES models(id),
    statement_id        INTEGER NOT NULL REFERENCES statements(id),
    topic_id            INTEGER NOT NULL REFERENCES topics(id),
    round               INTEGER NOT NULL,
    score               INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    text                TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_statements_run_topic_round ON statements(run_id, topic_id, round);
CREATE INDEX idx_feedback_run_topic_round ON feedback(run_id, topic_id, round);
CREATE INDEX idx_feedback_statement ON feedback(statement_id);

-- Dirk/Nejc's own 1-5 star rating of a statement, via the browsing webapp.
-- No accounts: reviewer_name is self-selected in the UI. One rating per
-- (statement, reviewer) — re-rating updates rather than duplicates.
CREATE TABLE human_reviews (
    id              INTEGER PRIMARY KEY,
    statement_id    INTEGER NOT NULL REFERENCES statements(id),
    reviewer_name   TEXT NOT NULL,
    score           INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (statement_id, reviewer_name)
);

CREATE INDEX idx_human_reviews_statement ON human_reviews(statement_id);
