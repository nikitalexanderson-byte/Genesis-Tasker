-- Durable deletion identities only; task content stays in Google / encrypted clients.
-- Additive migration. Code rollback leaves this table intact for a later fixed release.
CREATE TABLE IF NOT EXISTS task_deletions (
    user_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    PRIMARY KEY (user_id, task_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
