CREATE TABLE shared_templates (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('task','project')),
    manifest_json TEXT NOT NULL,
    source_notices_json TEXT NOT NULL,
    project_count INTEGER NOT NULL,
    task_count INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX shared_templates_project ON shared_templates(project_id,deleted_at,updated_at,id);
-- No project FK: deleting a source must not erase its ACL evidence and expose the snapshot.
CREATE TABLE shared_template_sources (
    template_id TEXT NOT NULL REFERENCES shared_templates(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    PRIMARY KEY(template_id,project_id)
);
CREATE TABLE shared_template_operations (
    actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(actor_id,operation_id)
);
