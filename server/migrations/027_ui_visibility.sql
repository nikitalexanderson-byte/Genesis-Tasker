-- Account-wide navigation and Today layout preferences. Existing accounts keep every item visible.
ALTER TABLE users ADD COLUMN ui_visibility_json TEXT NOT NULL DEFAULT '{}';
