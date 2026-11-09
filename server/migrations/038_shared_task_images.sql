-- Private image bytes are authenticated ciphertext in the runtime SQLite backup.
-- Additive migration: older clients and code rollback keep working; do not drop data.
CREATE TABLE shared_task_images (
    task_id TEXT PRIMARY KEY REFERENCES shared_tasks(id) ON DELETE CASCADE,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 3145728),
    ciphertext TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
