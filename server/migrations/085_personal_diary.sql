-- Opaque, owner-scoped notes. Legacy workspace writers cannot erase this namespace.
-- Existing consistent SQLite backups include this table; code rollback leaves it intact.
CREATE TABLE personal_diary_notes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision > 0),
    schema_version INTEGER NOT NULL,
    iv TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id, id)
);
