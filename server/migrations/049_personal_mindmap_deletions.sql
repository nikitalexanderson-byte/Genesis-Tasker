-- Retain identity only so delayed saves cannot recreate deleted map content.
-- Older clients and code rollbacks continue to read personal_mindmaps unchanged.
CREATE TABLE IF NOT EXISTS personal_mindmap_deletions (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 map_id TEXT NOT NULL,
 deleted_at TEXT NOT NULL,
 PRIMARY KEY(user_id, map_id)
);
