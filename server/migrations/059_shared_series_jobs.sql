-- Additive. Existing tasks, ACLs, dates and receipts remain unchanged.
CREATE TABLE background_jobs (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, unique_key TEXT NOT NULL UNIQUE,
 payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending'
 CHECK(state IN ('pending','running','succeeded','failed','cancelled')),
 available_at TEXT NOT NULL, lease_until TEXT, lease_token TEXT,
 attempts INTEGER NOT NULL DEFAULT 0, error_code TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX background_jobs_due ON background_jobs(state,available_at,lease_until);
CREATE TABLE background_worker_state (
 id INTEGER PRIMARY KEY CHECK(id=1), started_at TEXT, completed_at TEXT
);
INSERT INTO background_worker_state(id) VALUES(1);
CREATE TABLE shared_task_series (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
 source_task_id TEXT REFERENCES shared_tasks(id) ON DELETE SET NULL,
 owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 rule_json TEXT NOT NULL, template_json TEXT NOT NULL,
 paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
 cursor_date TEXT NOT NULL, generated_count INTEGER NOT NULL DEFAULT 1,
 revision INTEGER NOT NULL DEFAULT 1, last_error TEXT, checked_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX shared_series_project ON shared_task_series(project_id);
CREATE INDEX shared_series_scan ON shared_task_series(paused,checked_at);
CREATE TABLE shared_series_instances (
 series_id TEXT NOT NULL REFERENCES shared_task_series(id) ON DELETE CASCADE,
 occurrence_key TEXT NOT NULL, task_id TEXT UNIQUE REFERENCES shared_tasks(id) ON DELETE SET NULL,
 original_date TEXT NOT NULL, ordinal INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('created','skipped')),
 created_at TEXT NOT NULL,
 PRIMARY KEY(series_id,occurrence_key)
);
CREATE INDEX shared_series_instance_order ON shared_series_instances(series_id,ordinal);
