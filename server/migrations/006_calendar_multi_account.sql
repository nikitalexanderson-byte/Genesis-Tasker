ALTER TABLE users ADD COLUMN calendar_mode TEXT NOT NULL DEFAULT 'sacred';
ALTER TABLE users ADD COLUMN sync_routing_mode TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE users ADD COLUMN sync_target_account_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN category_sync_map TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS linked_google_accounts (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    access_token_enc TEXT,
    refresh_token_enc TEXT,
    token_expires_at INTEGER,
    granted_scopes TEXT NOT NULL DEFAULT '',
    google_calendar_id TEXT,
    position INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS linked_google_accounts_owner_idx
ON linked_google_accounts(owner_user_id, position, created_at);
