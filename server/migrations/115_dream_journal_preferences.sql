-- Additive: old clients and code rollback keep the original diary settings layout.
CREATE TABLE dream_journal_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    today_mode TEXT NOT NULL CHECK(today_mode IN ('off','morning','all-day')),
    revision INTEGER NOT NULL CHECK(revision > 0),
    updated_at TEXT NOT NULL
);
