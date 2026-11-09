-- Independent opaque document. Legacy workspace writers cannot erase this archive.
-- Included in the existing consistent SQLite backup. Code rollback leaves it intact.
CREATE TABLE stoicheion_workspaces (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK(revision > 0),
    iv TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
