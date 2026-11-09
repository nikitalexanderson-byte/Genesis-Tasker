-- Additive: old web/native clients keep their existing account preferences.
ALTER TABLE users ADD COLUMN advice_preferences_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE daily_advice_days (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_key TEXT NOT NULL,
    advice_id TEXT NOT NULL,
    entry_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    viewed_at TEXT,
    dismissed_at TEXT,
    PRIMARY KEY (user_id, day_key)
);
CREATE INDEX daily_advice_history ON daily_advice_days(user_id, advice_id, viewed_at);
