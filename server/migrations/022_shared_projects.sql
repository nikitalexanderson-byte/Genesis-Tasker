ALTER TABLE users ADD COLUMN shared_projects_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE shared_spaces (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE shared_space_members (
    space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
    joined_at TEXT NOT NULL,
    PRIMARY KEY (space_id, user_id)
);
CREATE INDEX shared_space_members_user_idx ON shared_space_members(user_id, space_id);

CREATE TABLE shared_projects (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES shared_projects(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    layout TEXT NOT NULL DEFAULT 'list' CHECK (layout IN ('list', 'board')),
    is_inbox INTEGER NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX shared_projects_space_idx ON shared_projects(space_id, archived_at, updated_at);
CREATE UNIQUE INDEX shared_projects_one_inbox_idx ON shared_projects(space_id) WHERE is_inbox = 1;

CREATE TABLE shared_project_members (
    project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'member', 'commenter', 'viewer')),
    joined_at TEXT NOT NULL,
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX shared_project_members_user_idx ON shared_project_members(user_id, project_id);

CREATE TABLE shared_project_statuses (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    position INTEGER NOT NULL,
    is_done INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX shared_project_statuses_project_idx ON shared_project_statuses(project_id, position);

CREATE TABLE shared_project_categories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    color TEXT NOT NULL,
    position INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX shared_project_categories_project_idx ON shared_project_categories(project_id, position);

CREATE TABLE shared_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
    status_id TEXT NOT NULL REFERENCES shared_project_statuses(id),
    category_id TEXT REFERENCES shared_project_categories(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    due_date TEXT,
    assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    completed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    completed_at TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX shared_tasks_project_status_idx ON shared_tasks(project_id, status_id, position);
CREATE INDEX shared_tasks_assignee_due_idx ON shared_tasks(assignee_id, due_date);

CREATE TABLE shared_comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES shared_tasks(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX shared_comments_task_idx ON shared_comments(task_id, created_at);

CREATE TABLE shared_invitations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
    email TEXT NOT NULL COLLATE NOCASE,
    role TEXT NOT NULL CHECK (role IN ('manager', 'member', 'commenter', 'viewer')),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    consumed_at TEXT,
    revoked_at TEXT
);
CREATE INDEX shared_invitations_project_idx ON shared_invitations(project_id, created_at);

CREATE TABLE shared_audit_events (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    object_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX shared_audit_events_project_idx ON shared_audit_events(project_id, created_at);
