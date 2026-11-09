-- Additive, opt-in planning. Estimates and sprint content retain content encryption.
CREATE TABLE shared_project_planning (
    project_id TEXT PRIMARY KEY REFERENCES shared_projects(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    estimate_unit TEXT NOT NULL DEFAULT 'points' CHECK(estimate_unit IN ('points','hours')),
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE shared_sprints (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'planning' CHECK(state IN ('planning','active','completed')),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    content_json TEXT NOT NULL,
    estimate_unit TEXT CHECK(estimate_unit IN ('points','hours')),
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX shared_sprints_project ON shared_sprints(project_id,state,start_date,id);
CREATE UNIQUE INDEX shared_sprints_one_active ON shared_sprints(project_id) WHERE state='active';
CREATE TABLE shared_task_planning (
    task_id TEXT PRIMARY KEY REFERENCES shared_tasks(id) ON DELETE CASCADE,
    sprint_id TEXT REFERENCES shared_sprints(id) ON DELETE SET NULL,
    estimates_json TEXT NOT NULL
);
CREATE INDEX shared_task_planning_sprint ON shared_task_planning(sprint_id,task_id);
-- Old clients and every transfer path must leave project-specific sprint membership behind.
CREATE TRIGGER shared_task_planning_move AFTER UPDATE OF project_id ON shared_tasks
WHEN OLD.project_id<>NEW.project_id
BEGIN
    UPDATE shared_task_planning SET sprint_id=NULL WHERE task_id=NEW.id;
END;
CREATE TABLE shared_planning_receipts (
    actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
    operation TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(actor_id,request_id)
);
