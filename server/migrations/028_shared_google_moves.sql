-- Preserve each member's Google copy during a cross-project move and queue stale copies for removal.
ALTER TABLE shared_google_projection_links ADD COLUMN google_list_id TEXT;
UPDATE shared_google_projection_links SET google_list_id = (
    SELECT p.google_task_list_id FROM shared_tasks t
    JOIN shared_google_preferences p ON p.project_id = t.project_id
        AND p.user_id = shared_google_projection_links.user_id
    WHERE t.id = shared_google_projection_links.task_id
) WHERE destination = 'tasks';

CREATE TABLE shared_google_projection_cleanup (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    destination TEXT NOT NULL CHECK (destination IN ('tasks', 'calendar')),
    google_id TEXT NOT NULL,
    google_list_id TEXT,
    created_at TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX shared_google_projection_cleanup_user_idx ON shared_google_projection_cleanup(user_id, created_at);
