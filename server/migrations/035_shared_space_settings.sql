-- Additive settings: NULL permissions retain existing role behavior for old clients.
-- The deploy workflow takes a consistent runtime backup before publishing server code.
-- Code rollback may leave these additive columns in place; do not restore the DB automatically.
ALTER TABLE shared_spaces ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE shared_spaces ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE shared_space_members ADD COLUMN permissions_json TEXT;
ALTER TABLE shared_space_invitations ADD COLUMN permissions_json TEXT;
-- Keep the legacy role CHECK and store additional invitation roles separately.
ALTER TABLE shared_space_invitations ADD COLUMN assigned_role TEXT NOT NULL DEFAULT ''
    CHECK (assigned_role IN ('', 'admin', 'member', 'guest'));
