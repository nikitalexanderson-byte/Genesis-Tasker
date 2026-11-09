ALTER TABLE users ADD COLUMN vk_uid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_vk_uid_unique
    ON users(vk_uid) WHERE vk_uid IS NOT NULL;

CREATE TABLE IF NOT EXISTS vk_tasks (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    payload_enc TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, task_id)
);

CREATE TABLE IF NOT EXISTS vk_native_tickets (
    ticket_hash TEXT PRIMARY KEY,
    flow_hash TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_new INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL
);
