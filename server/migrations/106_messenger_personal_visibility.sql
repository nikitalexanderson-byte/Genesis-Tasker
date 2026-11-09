-- Personal list/history state only. Shared conversations and encrypted messages are preserved.
CREATE TABLE messenger_user_state (
    conversation_id TEXT NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),
    deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
    cleared_seq INTEGER NOT NULL DEFAULT 0 CHECK(cleared_seq >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(conversation_id,user_id)
);
