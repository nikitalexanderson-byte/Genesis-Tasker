CREATE TABLE IF NOT EXISTS stoicheion_draws (
    user_id TEXT NOT NULL,
    day_key TEXT NOT NULL,
    draw_kind TEXT NOT NULL CHECK (draw_kind IN ('daily', 'spread')),
    seed_value INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count IN (1, 2)),
    first_draw_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, day_key, draw_kind),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS stoicheion_draws_user_day_idx
ON stoicheion_draws(user_id, day_key);
