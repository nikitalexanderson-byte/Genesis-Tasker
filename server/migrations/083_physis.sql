-- Additive opaque storage. No personal kind, date, product/drug/exercise reference,
-- key or plaintext is stored here. Code rollback leaves these tables untouched.
CREATE TABLE physis_owners (
    owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_cursor INTEGER NOT NULL DEFAULT 0 CHECK(current_cursor >= 0),
    min_cursor INTEGER NOT NULL DEFAULT 0 CHECK(min_cursor >= 0),
    vault_json TEXT,
    vault_revision INTEGER NOT NULL DEFAULT 0,
    key_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE physis_used_ids (
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    PRIMARY KEY(owner_id, id)
);
CREATE TABLE physis_records (
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision > 0),
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    envelope_json TEXT,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY(owner_id, id),
    FOREIGN KEY(owner_id, id) REFERENCES physis_used_ids(owner_id, id),
    CHECK((deleted_at IS NULL AND envelope_json IS NOT NULL) OR (deleted_at IS NOT NULL AND envelope_json IS NULL))
);
CREATE UNIQUE INDEX physis_records_cursor ON physis_records(owner_id, sequence);
CREATE INDEX physis_records_tombstones ON physis_records(owner_id, deleted_at);
CREATE TABLE physis_receipts (
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(owner_id, request_id)
);
CREATE INDEX physis_receipts_expiry ON physis_receipts(owner_id, created_at);
