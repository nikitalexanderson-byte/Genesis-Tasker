-- Additive metadata; old clients and code rollback continue to work with empty/default tags.
ALTER TABLE shared_projects ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE shared_tasks ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
