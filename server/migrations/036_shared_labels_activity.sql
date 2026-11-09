CREATE TABLE shared_space_labels (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    color TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX shared_space_labels_space_idx ON shared_space_labels(space_id, position);
CREATE TABLE shared_project_labels (
    project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
    label_id TEXT NOT NULL REFERENCES shared_space_labels(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, label_id)
);
CREATE TABLE shared_task_labels (
    task_id TEXT NOT NULL REFERENCES shared_tasks(id) ON DELETE CASCADE,
    label_id TEXT NOT NULL REFERENCES shared_space_labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
);
CREATE INDEX shared_project_labels_label_idx ON shared_project_labels(label_id);
CREATE INDEX shared_task_labels_label_idx ON shared_task_labels(label_id);
CREATE TABLE shared_comment_mentions (
    comment_id TEXT NOT NULL REFERENCES shared_comments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX shared_comment_mentions_user_idx ON shared_comment_mentions(user_id, comment_id);
ALTER TABLE shared_audit_events ADD COLUMN task_id TEXT;
ALTER TABLE shared_audit_events ADD COLUMN board_id TEXT;
ALTER TABLE shared_audit_events ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}';
CREATE INDEX shared_audit_events_task_idx ON shared_audit_events(project_id, task_id, created_at, id);
CREATE INDEX shared_audit_events_board_idx ON shared_audit_events(project_id, board_id, created_at, id);
ALTER TABLE shared_tasks ADD COLUMN start_date TEXT;
ALTER TABLE shared_tasks ADD COLUMN start_time TEXT;
ALTER TABLE shared_tasks ADD COLUMN end_time TEXT;
CREATE TABLE shared_task_dependencies (
    task_id TEXT NOT NULL REFERENCES shared_tasks(id) ON DELETE CASCADE,
    predecessor_id TEXT NOT NULL REFERENCES shared_tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, predecessor_id),
    CHECK (task_id <> predecessor_id)
);
CREATE INDEX shared_task_dependencies_predecessor_idx ON shared_task_dependencies(predecessor_id);
