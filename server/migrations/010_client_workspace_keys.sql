ALTER TABLE users ADD COLUMN workspace_key_mode TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE users ADD COLUMN workspace_key_wrapped TEXT;
ALTER TABLE users ADD COLUMN workspace_key_iv TEXT;
