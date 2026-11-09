-- Shared reference text only. Personal Physis records remain encrypted and untouched.
-- Additive migration; code rollback leaves these admin edits available for a later release.
CREATE TABLE IF NOT EXISTS physis_catalog_overrides (
    id TEXT PRIMARY KEY,
    entry_json TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
);
