-- Explicit exclusions keep removing an inherited project meaningful for older clients.
ALTER TABLE shared_member_project_grants ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0,1));
