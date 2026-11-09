CREATE TABLE shared_space_presence (
    space_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (space_id, user_id, client_id),
    FOREIGN KEY (space_id, user_id) REFERENCES shared_space_members(space_id, user_id) ON DELETE CASCADE
);
CREATE TABLE shared_messaging_keys (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    key_id TEXT NOT NULL,
    public_key_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE shared_private_conversations (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
    user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    CHECK (user_a < user_b),
    UNIQUE (space_id, user_a, user_b)
);
CREATE TABLE shared_private_messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    conversation_id TEXT NOT NULL REFERENCES shared_private_conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload_json TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE INDEX shared_private_conversations_user_a ON shared_private_conversations(user_a, space_id);
CREATE INDEX shared_private_conversations_user_b ON shared_private_conversations(user_b, space_id);
CREATE INDEX shared_private_messages_conversation_seq ON shared_private_messages(conversation_id, seq DESC);
CREATE INDEX shared_private_messages_sender_time ON shared_private_messages(sender_id, created_at);
CREATE TABLE shared_private_message_reads (
    conversation_id TEXT NOT NULL REFERENCES shared_private_conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_seq INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
);
