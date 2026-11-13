-- Additive web protocol; retain the original seeded deal for older clients.
CREATE TABLE IF NOT EXISTS stoicheion_timeline_sessions (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_key TEXT NOT NULL,
    source_day_key TEXT NOT NULL,
    seed_value INTEGER NOT NULL CHECK (seed_value BETWEEN 0 AND 4294967295),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, period_key)
);
CREATE TABLE IF NOT EXISTS stoicheion_timeline_card_windows (
    user_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 2),
    first_revealed_at TEXT NOT NULL,
    rerolled_at TEXT,
    PRIMARY KEY (user_id, period_key, position),
    FOREIGN KEY (user_id, period_key) REFERENCES stoicheion_timeline_sessions(user_id, period_key) ON DELETE CASCADE
);
