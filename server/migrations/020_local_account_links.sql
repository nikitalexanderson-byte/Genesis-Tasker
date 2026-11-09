-- Yandex ID and VK ID may share one GENESIS workspace. Google stays isolated.
-- Member user rows remain intact to preserve their calendar/task data and rollback.
CREATE TABLE IF NOT EXISTS linked_local_accounts (
    member_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK(provider IN ('yandex', 'vk')),
    provider_uid TEXT NOT NULL,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    position INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider, provider_uid),
    CHECK(member_user_id <> owner_user_id)
);
CREATE INDEX IF NOT EXISTS linked_local_accounts_owner_idx
    ON linked_local_accounts(owner_user_id, position, created_at);
