-- Only authenticated ciphertext chunks and opaque identifiers are stored here.
CREATE TABLE shared_private_files (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES shared_private_conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES shared_private_messages(id) ON DELETE CASCADE,
    chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 1 AND 41),
    byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 16 AND 10485776),
    created_at TEXT NOT NULL
);
CREATE INDEX shared_private_files_sender ON shared_private_files(sender_id);
CREATE TABLE shared_private_file_chunks (
    file_id TEXT NOT NULL REFERENCES shared_private_files(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL CHECK(chunk_index BETWEEN 0 AND 40),
    ciphertext TEXT NOT NULL,
    PRIMARY KEY(file_id, chunk_index)
);
