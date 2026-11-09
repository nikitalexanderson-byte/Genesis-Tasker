-- Opt-in sidecar definitions. Existing tasks and historical events are not replayed.
CREATE TABLE shared_automation_rules (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    definition_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
    revision INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    cursor_date TEXT,
    scan_after_id TEXT NOT NULL DEFAULT '',
    checked_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX shared_automation_project ON shared_automation_rules(project_id,deleted_at,created_at,id);
CREATE INDEX shared_automation_scan ON shared_automation_rules(enabled,deleted_at,checked_at,id);
CREATE TABLE shared_automation_runs (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL REFERENCES shared_automation_rules(id) ON DELETE CASCADE,
    rule_revision INTEGER NOT NULL,
    trigger_key TEXT NOT NULL,
    task_id TEXT,
    task_revision INTEGER,
    chain_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN('pending','succeeded','skipped','cancelled','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    result_json TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT,
    UNIQUE(rule_id,trigger_key)
);
CREATE INDEX shared_automation_run_history ON shared_automation_runs(rule_id,created_at,id);
CREATE INDEX shared_automation_chain ON shared_automation_runs(chain_id);
CREATE TABLE shared_automation_operations (
    actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(actor_id,operation_id)
);
