-- Independent of workspace_blobs: old clients cannot erase these documents.
CREATE TABLE IF NOT EXISTS personal_mindmaps (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 schema_version INTEGER NOT NULL,
 revision INTEGER NOT NULL,
 ciphertext TEXT NOT NULL,
 iv TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id, id)
);
CREATE TABLE IF NOT EXISTS personal_mindmap_versions (
 user_id TEXT NOT NULL,
 map_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 schema_version INTEGER NOT NULL,
 ciphertext TEXT NOT NULL,
 iv TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id, map_id, revision),
 FOREIGN KEY(user_id, map_id) REFERENCES personal_mindmaps(user_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS personal_mindmap_receipts (
 user_id TEXT NOT NULL,
 map_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 revision INTEGER NOT NULL,
 PRIMARY KEY(user_id, map_id, operation_id),
 FOREIGN KEY(user_id, map_id) REFERENCES personal_mindmaps(user_id, id) ON DELETE CASCADE
);
-- Only operation identity, never task text. An uncertain external POST is not repeated blindly.
CREATE TABLE IF NOT EXISTS personal_task_creations (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 task_id TEXT NOT NULL,
 state TEXT NOT NULL,
 PRIMARY KEY(user_id, task_id)
);
