ALTER TABLE shared_project_statuses ADD COLUMN task_title_lines INTEGER CHECK (task_title_lines BETWEEN 0 AND 3);
ALTER TABLE shared_project_statuses ADD COLUMN visible_task_count INTEGER CHECK (visible_task_count BETWEEN 0 AND 1000);
