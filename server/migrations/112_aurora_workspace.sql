-- Additive namespace: old workspace and Stoicheion writers cannot overwrite it.
-- Covered by the existing consistent SQLite runtime backup. Code rollback may
-- leave this table in place; no automatic database rollback or backfill.
CREATE TABLE aurora_workspaces (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK(revision > 0),
    iv TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
