-- Additive preparation for 3.2.2. No account, subscription or Google token is replaced.
ALTER TABLE users ADD COLUMN data_generation INTEGER NOT NULL DEFAULT 0 CHECK(data_generation >= 0);
CREATE TABLE backup_stages (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 payload_hash TEXT NOT NULL, generation INTEGER NOT NULL, revision_hash TEXT NOT NULL,
 payload_enc TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE backup_notices (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, version TEXT NOT NULL, accepted_at TEXT NOT NULL,
 PRIMARY KEY(user_id,version)
);
CREATE INDEX backup_stages_owner ON backup_stages(user_id, expires_at);
CREATE TABLE backup_receipts (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, operation_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL, generation INTEGER NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(user_id, operation_id)
);
CREATE TABLE backup_safety_snapshots (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 snapshot_enc TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE personal_recovered_tasks (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
 revision INTEGER NOT NULL, iv TEXT NOT NULL, ciphertext TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id, id)
);
CREATE TABLE personal_recovered_task_deletions (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
 revision INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,id)
);
