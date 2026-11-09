-- Keep only an opaque ID/revision after deletion; remove the encrypted note itself.
-- Additive and compatible with the previous notes table and its positional INSERT.
CREATE TABLE personal_diary_deletions (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision > 1),
    local_only INTEGER NOT NULL DEFAULT 0 CHECK(local_only IN (0,1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id, id)
);

CREATE TABLE personal_diary_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    sync_enabled INTEGER NOT NULL CHECK(sync_enabled IN (0,1)),
    revision INTEGER NOT NULL CHECK(revision > 0),
    command_hash TEXT NOT NULL,
    removed_count INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);

-- A rolled-back server or a stale writer must never resurrect a deleted note ID.
CREATE TRIGGER personal_diary_prevent_deleted_insert BEFORE INSERT ON personal_diary_notes
WHEN EXISTS(SELECT 1 FROM personal_diary_deletions WHERE user_id=NEW.user_id AND id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'DIARY_NOTE_DELETED'); END;
CREATE TRIGGER personal_diary_prevent_disabled_insert BEFORE INSERT ON personal_diary_notes
WHEN EXISTS(SELECT 1 FROM personal_diary_settings WHERE user_id=NEW.user_id AND sync_enabled=0)
BEGIN SELECT RAISE(ABORT, 'DIARY_SYNC_DISABLED'); END;
CREATE TRIGGER personal_diary_prevent_disabled_update BEFORE UPDATE ON personal_diary_notes
WHEN EXISTS(SELECT 1 FROM personal_diary_settings WHERE user_id=NEW.user_id AND sync_enabled=0)
BEGIN SELECT RAISE(ABORT, 'DIARY_SYNC_DISABLED'); END;
CREATE TRIGGER personal_diary_prevent_deleted_update BEFORE UPDATE ON personal_diary_notes
WHEN EXISTS(SELECT 1 FROM personal_diary_deletions WHERE user_id=NEW.user_id AND id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'DIARY_NOTE_DELETED'); END;
