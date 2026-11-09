-- Additive: legacy shared_private_* histories and account keys remain untouched.
CREATE TABLE messenger_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_id TEXT NOT NULL,
    public_key_json TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    revoked_at TEXT
);
CREATE INDEX messenger_devices_owner ON messenger_devices(user_id, revoked_at);
CREATE TABLE messenger_contacts (
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(owner_id, contact_id),
    CHECK(owner_id <> contact_id)
);
CREATE TABLE messenger_blocks (
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(owner_id, blocked_id),
    CHECK(owner_id <> blocked_id)
);
CREATE TABLE messenger_conversations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('direct','group','project','secret')),
    title TEXT NOT NULL DEFAULT '',
    creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES shared_projects(id) ON DELETE CASCADE,
    pair_key TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK((kind='project') = (project_id IS NOT NULL))
);
CREATE UNIQUE INDEX messenger_project_chat ON messenger_conversations(project_id) WHERE kind='project';
CREATE TABLE messenger_members (
    conversation_id TEXT NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('owner','member')),
    status TEXT NOT NULL CHECK(status IN ('active','pending','left')),
    device_id TEXT REFERENCES messenger_devices(id) ON DELETE SET NULL,
    key_id TEXT,
    public_key_json TEXT,
    last_read_seq INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL,
    PRIMARY KEY(conversation_id, user_id)
);
CREATE INDEX messenger_members_user ON messenger_members(user_id, status);
CREATE TABLE messenger_messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    conversation_id TEXT NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Cloud text: authenticated server encryption. Secret: opaque client envelope only.
    content TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE INDEX messenger_messages_chat ON messenger_messages(conversation_id, seq DESC);
CREATE INDEX messenger_messages_sender ON messenger_messages(sender_id, created_at);
CREATE TABLE messenger_rate_limits (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    window INTEGER NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY(user_id, action)
);
