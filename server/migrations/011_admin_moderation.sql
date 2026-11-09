ALTER TABLE user_metrics ADD COLUMN habit_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS blocked_identities (
    id TEXT PRIMARY KEY,
    google_sub_hash TEXT UNIQUE,
    email_hash TEXT UNIQUE,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS blocked_identities_created_at_idx ON blocked_identities(created_at);
