-- Additive: old tasks and member permissions keep their existing behavior.
CREATE TABLE shared_member_categories (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    permissions_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    UNIQUE(space_id, title)
);
ALTER TABLE shared_space_members ADD COLUMN member_category_id TEXT REFERENCES shared_member_categories(id) ON DELETE SET NULL;
CREATE TABLE shared_task_approvals (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES shared_tasks(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    approved_at TEXT,
    UNIQUE(task_id, user_id)
);
CREATE INDEX shared_task_approvals_task ON shared_task_approvals(task_id);
ALTER TABLE shared_tasks ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'task' CHECK(entry_type IN ('task', 'meeting', 'birthday', 'event'));
