-- Additive: old clients and the existing private photo endpoint remain compatible.
CREATE TABLE IF NOT EXISTS shared_task_attachments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES shared_tasks(id) ON DELETE CASCADE,
    filename_ciphertext TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
    ciphertext TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS shared_task_attachments_task ON shared_task_attachments(task_id);
