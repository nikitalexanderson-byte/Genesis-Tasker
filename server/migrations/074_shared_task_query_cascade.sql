-- SQLite applies SET NULL to task parents/categories during project cascades.
-- At that point the project can already be gone; never recreate its paging row.
DROP TRIGGER shared_query_task_update;
CREATE TRIGGER shared_query_task_update AFTER UPDATE ON shared_tasks BEGIN
    INSERT INTO shared_task_query_versions(project_id,version)
        SELECT NEW.project_id,1 WHERE EXISTS(SELECT 1 FROM shared_projects WHERE id=NEW.project_id)
        ON CONFLICT(project_id) DO UPDATE SET version=version+1;
    UPDATE shared_task_query_versions SET version=version+1
        WHERE project_id=OLD.project_id AND OLD.project_id<>NEW.project_id;
END;
