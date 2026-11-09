-- Creation receipts/identity only. Task content remains in its existing domain.
CREATE TABLE IF NOT EXISTS personal_task_creation_targets (
 user_id TEXT NOT NULL,
 task_id TEXT NOT NULL,
 target_key TEXT NOT NULL,
 recovery_token TEXT NOT NULL UNIQUE,
 attempted INTEGER NOT NULL DEFAULT 0,
 provider_id TEXT,
 provider_key TEXT UNIQUE,
 PRIMARY KEY(user_id, task_id),
 FOREIGN KEY(user_id, task_id) REFERENCES personal_task_creations(user_id, task_id) ON DELETE CASCADE
);
