-- Additive; keep the legacy current-day row for installed clients and code rollback.
ALTER TABLE daily_advice_days ADD COLUMN draw_limit INTEGER NOT NULL DEFAULT 3;
ALTER TABLE daily_advice_days ADD COLUMN selection_json TEXT NOT NULL DEFAULT '{}';
UPDATE daily_advice_days SET selection_json=(SELECT advice_preferences_json FROM users WHERE users.id=daily_advice_days.user_id);
CREATE TABLE daily_advice_entries (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_key TEXT NOT NULL,
    slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 6),
    advice_id TEXT NOT NULL,
    entry_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    viewed_at TEXT,
    dismissed_at TEXT,
    PRIMARY KEY(user_id, day_key, slot),
    UNIQUE(user_id, day_key, advice_id)
);
INSERT INTO daily_advice_entries(user_id,day_key,slot,advice_id,entry_json,created_at,viewed_at,dismissed_at)
SELECT user_id,day_key,1,advice_id,entry_json,created_at,viewed_at,dismissed_at FROM daily_advice_days;
CREATE INDEX daily_advice_entries_history ON daily_advice_entries(user_id,viewed_at,day_key,slot);
