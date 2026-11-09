-- Sidecar metadata preserves the two-column deletion receipt used by rollback/legacy server code.
CREATE TABLE shared_mindmap_deletion_scopes (
    space_id TEXT NOT NULL,
    map_id TEXT NOT NULL,
    project_id TEXT,
    PRIMARY KEY(space_id,map_id),
    FOREIGN KEY(space_id,map_id) REFERENCES shared_mindmap_deletions(space_id,map_id) ON DELETE CASCADE
);
