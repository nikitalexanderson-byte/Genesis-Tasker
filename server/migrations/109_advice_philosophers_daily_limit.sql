-- Deploy saves a consistent SQLite snapshot before application migrations run.
-- Keep the new preference outside the legacy JSON so previous writers retain it.
ALTER TABLE users ADD COLUMN advice_philosophers_per_day INTEGER NOT NULL DEFAULT 1 CHECK(advice_philosophers_per_day BETWEEN 1 AND 3);

-- Keep the six-slot table and legacy current-day pointer intact for code rollback.
-- New clients read the union; slots 7–9 never become visible to previous code.
CREATE TABLE daily_advice_extra_entries (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_key TEXT NOT NULL,
    slot INTEGER NOT NULL CHECK(slot BETWEEN 7 AND 9),
    advice_id TEXT NOT NULL,
    entry_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    viewed_at TEXT,
    dismissed_at TEXT,
    PRIMARY KEY(user_id, day_key, slot),
    UNIQUE(user_id, day_key, advice_id)
);
CREATE INDEX daily_advice_extra_entries_history ON daily_advice_extra_entries(user_id,viewed_at,day_key,slot);
CREATE VIEW daily_advice_all_entries AS
SELECT * FROM daily_advice_entries
UNION ALL
SELECT * FROM daily_advice_extra_entries;
