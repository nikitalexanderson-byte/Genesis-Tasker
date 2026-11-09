CREATE TABLE shared_space_project_categories (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    color TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX shared_space_project_categories_space_idx ON shared_space_project_categories(space_id, position);
ALTER TABLE shared_projects ADD COLUMN category_id TEXT REFERENCES shared_space_project_categories(id) ON DELETE SET NULL;
CREATE INDEX shared_projects_category_idx ON shared_projects(space_id, category_id);
CREATE TRIGGER shared_projects_category_insert BEFORE INSERT ON shared_projects
WHEN NEW.category_id IS NOT NULL AND (NEW.is_inbox = 1 OR NEW.kind <> 'project' OR NOT EXISTS (
    SELECT 1 FROM shared_space_project_categories WHERE id = NEW.category_id AND space_id = NEW.space_id
)) BEGIN SELECT RAISE(ABORT, 'INVALID_PROJECT_CATEGORY'); END;
CREATE TRIGGER shared_projects_category_update BEFORE UPDATE OF category_id, space_id, kind, is_inbox ON shared_projects
WHEN NEW.category_id IS NOT NULL AND (NEW.is_inbox = 1 OR NEW.kind <> 'project' OR NOT EXISTS (
    SELECT 1 FROM shared_space_project_categories WHERE id = NEW.category_id AND space_id = NEW.space_id
)) BEGIN SELECT RAISE(ABORT, 'INVALID_PROJECT_CATEGORY'); END;
