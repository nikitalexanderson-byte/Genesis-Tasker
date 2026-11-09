-- A member chooses their own Google destinations. The team task remains authoritative.
CREATE TABLE shared_google_preferences (
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    tasks_enabled INTEGER NOT NULL DEFAULT 0,
    calendar_enabled INTEGER NOT NULL DEFAULT 0,
    google_task_list_id TEXT,
    last_sync_attempt_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, user_id),
    FOREIGN KEY (project_id, user_id) REFERENCES shared_project_members(project_id, user_id) ON DELETE CASCADE
);
CREATE INDEX shared_google_preferences_user_idx ON shared_google_preferences(user_id, project_id);

CREATE TABLE shared_google_projection_links (
    task_id TEXT NOT NULL REFERENCES shared_tasks(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    destination TEXT NOT NULL CHECK (destination IN ('tasks', 'calendar')),
    google_id TEXT NOT NULL,
    synced_revision INTEGER NOT NULL DEFAULT 0,
    synced_at TEXT NOT NULL,
    PRIMARY KEY (task_id, user_id, destination)
);
CREATE INDEX shared_google_projection_links_user_idx ON shared_google_projection_links(user_id, destination);
