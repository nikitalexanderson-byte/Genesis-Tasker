-- Receipts contain only explicitly disclosed-copy metadata, never a private
-- vault key, GENESIS content locator, task body, OAuth grant or live sync rule.
CREATE TABLE private_external_copies (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 operation_id TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google-tasks','google-calendar')),
 account_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('ready','attempted','complete')),
 external_id TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id,operation_id)
);
