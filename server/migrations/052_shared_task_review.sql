CREATE TABLE IF NOT EXISTS shared_project_review_policies (
 project_id TEXT PRIMARY KEY REFERENCES shared_projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, policy_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shared_task_reviews (
 task_id TEXT NOT NULL REFERENCES shared_tasks(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('checked','confirmed','deletable')),
 task_revision INTEGER NOT NULL, reviewed_at TEXT NOT NULL,
 PRIMARY KEY(task_id,user_id,kind)
);
