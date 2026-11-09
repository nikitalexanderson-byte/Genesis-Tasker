-- Opt-in rules. Task data and existing client contracts remain unchanged.
CREATE TABLE shared_project_workflows (
    project_id TEXT PRIMARY KEY REFERENCES shared_projects(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    definition_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE shared_project_workflow_versions (
    project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
    definition_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY(project_id,revision)
);
