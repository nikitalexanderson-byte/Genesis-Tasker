-- A recursive walk looks up children of one known parent within one project.
-- Together with branch-first CROSS JOINs this avoids rescanning the entire project per node.
CREATE INDEX shared_tasks_project_parent ON shared_tasks(project_id,parent_task_id,id);
