-- Additive: old clients preserve omitted fields. No existing dates/statuses/ACLs change.
ALTER TABLE shared_tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3);
ALTER TABLE shared_tasks ADD COLUMN parent_task_id TEXT REFERENCES shared_tasks(id) ON DELETE SET NULL;
ALTER TABLE shared_tasks ADD COLUMN checklists_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE shared_tasks ADD COLUMN archived_at TEXT;
ALTER TABLE shared_tasks ADD COLUMN archive_root_id TEXT;
CREATE INDEX shared_tasks_parent ON shared_tasks(parent_task_id);
CREATE INDEX shared_tasks_page ON shared_tasks(project_id, archived_at, status_id, position, id);
CREATE INDEX shared_tasks_due_page ON shared_tasks(project_id, archived_at, due_date, id);

-- A cursor is invalidated if any task in its accessible project scope changes.
CREATE TABLE shared_task_query_versions (
    project_id TEXT PRIMARY KEY REFERENCES shared_projects(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO shared_task_query_versions(project_id) SELECT id FROM shared_projects;
CREATE TRIGGER shared_query_task_insert AFTER INSERT ON shared_tasks BEGIN
    INSERT INTO shared_task_query_versions VALUES(NEW.project_id,1)
    ON CONFLICT(project_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER shared_query_task_update AFTER UPDATE ON shared_tasks BEGIN
    INSERT INTO shared_task_query_versions VALUES(NEW.project_id,1)
    ON CONFLICT(project_id) DO UPDATE SET version=version+1;
    UPDATE shared_task_query_versions SET version=version+1 WHERE project_id=OLD.project_id AND OLD.project_id<>NEW.project_id;
END;
CREATE TRIGGER shared_query_task_delete AFTER DELETE ON shared_tasks BEGIN
    UPDATE shared_task_query_versions SET version=version+1 WHERE project_id=OLD.project_id;
END;
CREATE TRIGGER shared_query_trash_insert AFTER INSERT ON shared_trash BEGIN
    UPDATE shared_task_query_versions SET version=version+1 WHERE project_id=NEW.project_id;
END;
CREATE TRIGGER shared_query_trash_delete AFTER DELETE ON shared_trash BEGIN
    UPDATE shared_task_query_versions SET version=version+1 WHERE project_id=OLD.project_id;
END;
CREATE TRIGGER shared_query_approval_update AFTER UPDATE ON shared_task_approvals BEGIN
    UPDATE shared_task_query_versions SET version=version+1 WHERE project_id=(SELECT project_id FROM shared_tasks WHERE id=NEW.task_id);
END;
