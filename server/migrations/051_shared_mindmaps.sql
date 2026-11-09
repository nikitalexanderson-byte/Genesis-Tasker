-- Additive only. Existing personal documents and shared tasks remain untouched.
CREATE TABLE IF NOT EXISTS shared_mindmaps (
 space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
 id TEXT NOT NULL, revision INTEGER NOT NULL, content TEXT NOT NULL,
 updated_at TEXT NOT NULL, PRIMARY KEY(space_id,id)
);
CREATE TABLE IF NOT EXISTS shared_mindmap_versions (
 space_id TEXT NOT NULL, map_id TEXT NOT NULL, revision INTEGER NOT NULL,
 content TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(space_id,map_id,revision),
 FOREIGN KEY(space_id,map_id) REFERENCES shared_mindmaps(space_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS shared_mindmap_receipts (
 space_id TEXT NOT NULL, map_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL, revision INTEGER NOT NULL,
 PRIMARY KEY(space_id,map_id,operation_id),
 FOREIGN KEY(space_id,map_id) REFERENCES shared_mindmaps(space_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS shared_mindmap_deletions (
 space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
 map_id TEXT NOT NULL, PRIMARY KEY(space_id,map_id)
);
CREATE TABLE IF NOT EXISTS shared_mindmap_conversions (
 space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
 map_id TEXT NOT NULL, node_id TEXT NOT NULL, project_id TEXT NOT NULL,
 task_id TEXT NOT NULL, PRIMARY KEY(space_id,map_id,node_id)
);
