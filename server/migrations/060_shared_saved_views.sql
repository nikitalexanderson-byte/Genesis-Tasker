-- Additive; no existing tasks, calendars, permissions or histories are changed.
CREATE TABLE shared_saved_views (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 space_id TEXT REFERENCES shared_spaces(id) ON DELETE CASCADE,
 visibility TEXT NOT NULL CHECK(visibility IN ('personal','shared')),
 payload TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 CHECK(visibility = 'personal' OR space_id IS NOT NULL)
);
CREATE INDEX shared_saved_views_owner ON shared_saved_views(owner_id,deleted_at,updated_at);
CREATE INDEX shared_saved_views_space ON shared_saved_views(space_id,visibility,deleted_at,updated_at);
