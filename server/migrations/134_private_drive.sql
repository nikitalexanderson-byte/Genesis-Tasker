-- Drive grants are identity credentials, separate from Calendar/Tasks and
-- excluded from content restore. Operation records contain only opaque IDs,
-- sizes and ciphertext hashes. No archive plaintext or recovery key is kept.
CREATE TABLE private_drive_connections (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 connection_id TEXT NOT NULL,
 google_sub TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 access_token_enc TEXT,
 refresh_token_enc TEXT,
 expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE private_drive_operations (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 operation_id TEXT NOT NULL,
 connection_id TEXT NOT NULL,
 file_id TEXT NOT NULL,
 backup_id TEXT NOT NULL,
 file_hash TEXT NOT NULL,
 file_bytes INTEGER NOT NULL,
 upload_uri_enc TEXT,
 verified_at TEXT,
 created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,operation_id),
 UNIQUE(user_id,file_id)
);
