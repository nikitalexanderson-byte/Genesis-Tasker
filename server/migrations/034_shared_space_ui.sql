-- Additive web UI state and board placement. Existing native clients may omit all new fields.
CREATE TABLE shared_space_ui (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
    expanded_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, space_id)
);
ALTER TABLE shared_project_statuses ADD COLUMN color TEXT NOT NULL DEFAULT '#2d6c68';
ALTER TABLE shared_project_statuses ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE shared_projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'project' CHECK (kind IN ('project', 'task-list'));
ALTER TABLE shared_projects ADD COLUMN board_status_id TEXT REFERENCES shared_project_statuses(id) ON DELETE SET NULL;
ALTER TABLE shared_space_members ADD COLUMN all_projects INTEGER NOT NULL DEFAULT 0;
CREATE TABLE shared_space_invitations (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL COLLATE NOCASE,
    role TEXT NOT NULL CHECK (role IN ('member', 'guest')),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    revoked_at TEXT
);
CREATE INDEX shared_space_invitation_email ON shared_space_invitations(email, consumed_at, revoked_at);
