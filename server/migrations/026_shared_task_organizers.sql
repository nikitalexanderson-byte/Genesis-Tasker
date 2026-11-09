-- A workspace owner can delegate moving shared tasks without granting project administration.
ALTER TABLE shared_space_members ADD COLUMN can_organize_tasks INTEGER NOT NULL DEFAULT 0
    CHECK (can_organize_tasks IN (0, 1));

-- Space owners and administrators manage every existing project in their space.
INSERT OR IGNORE INTO shared_project_members (project_id, user_id, role, joined_at)
SELECT p.id, sm.user_id, 'manager', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM shared_projects p
JOIN shared_space_members sm ON sm.space_id = p.space_id
WHERE sm.role IN ('owner', 'admin');
