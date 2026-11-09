CREATE TABLE shared_project_comments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
    board_id TEXT REFERENCES shared_project_statuses(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    mention_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);
CREATE INDEX shared_project_comments_time ON shared_project_comments(project_id,board_id,created_at);
