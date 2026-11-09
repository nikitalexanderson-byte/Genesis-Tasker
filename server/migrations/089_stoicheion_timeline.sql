-- Additive namespace: old daily/nine-card rows and their constraints remain untouched.
CREATE TABLE IF NOT EXISTS stoicheion_timeline_draws (
    user_id TEXT NOT NULL,
    day_key TEXT NOT NULL,
    draw_kind TEXT NOT NULL CHECK (draw_kind = 'timeline'),
    seed_value INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count IN (1, 2)),
    first_draw_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, day_key, draw_kind),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
