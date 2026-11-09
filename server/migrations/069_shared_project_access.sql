-- Additive, opt-in restrictions. Existing memberships and permission JSON are unchanged.
ALTER TABLE shared_space_members ADD COLUMN project_access_restricted INTEGER NOT NULL DEFAULT 0 CHECK(project_access_restricted IN (0,1));
ALTER TABLE shared_space_members ADD COLUMN project_access_revision INTEGER NOT NULL DEFAULT 1;
CREATE TABLE shared_member_project_grants (
    space_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('member','commenter','viewer')),
    include_descendants INTEGER NOT NULL DEFAULT 0 CHECK(include_descendants IN (0,1)),
    PRIMARY KEY(space_id,user_id,project_id),
    FOREIGN KEY(space_id,user_id) REFERENCES shared_space_members(space_id,user_id) ON DELETE CASCADE
);
CREATE INDEX shared_member_project_grants_project ON shared_member_project_grants(project_id,user_id);
CREATE TABLE shared_member_access_receipts (
    space_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload_hash TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(space_id,user_id,operation_id),
    FOREIGN KEY(space_id,user_id) REFERENCES shared_space_members(space_id,user_id) ON DELETE CASCADE
);
