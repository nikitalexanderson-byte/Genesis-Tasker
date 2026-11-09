ALTER TABLE shared_mindmaps ADD COLUMN project_id TEXT REFERENCES shared_projects(id) ON DELETE SET NULL;
ALTER TABLE shared_mindmap_versions ADD COLUMN project_id TEXT REFERENCES shared_projects(id) ON DELETE SET NULL;
CREATE INDEX shared_mindmap_project_idx ON shared_mindmaps(project_id);
CREATE INDEX shared_mindmap_version_project_idx ON shared_mindmap_versions(project_id);
