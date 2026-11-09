-- Soft deletion keeps real IDs, dependencies, members and file data until expiry.
CREATE TABLE IF NOT EXISTS shared_trash (
 kind TEXT NOT NULL CHECK(kind IN ('task','project')), object_id TEXT NOT NULL,
 space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL, root_id TEXT NOT NULL,
 deleted_at TEXT NOT NULL, expires_at TEXT NOT NULL, retention_days INTEGER NOT NULL CHECK(retention_days BETWEEN 1 AND 30),
 previous_archived_at TEXT, PRIMARY KEY(kind,object_id)
);
CREATE INDEX IF NOT EXISTS shared_trash_space ON shared_trash(space_id,expires_at);
