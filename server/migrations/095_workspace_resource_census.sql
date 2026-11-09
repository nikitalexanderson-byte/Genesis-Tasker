-- Opaque resource IDs only. No task/habit titles, content, history or encryption keys.
CREATE TABLE workspace_resource_census (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    projects_json TEXT NOT NULL,
    habits_json TEXT NOT NULL,
    workspace_version INTEGER NOT NULL
);
