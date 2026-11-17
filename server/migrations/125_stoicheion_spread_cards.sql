-- Additive storage: existing weekly draws, historical sessions and installed clients remain intact.
CREATE TABLE stoicheion_spread_cards (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_key TEXT NOT NULL,
    source_seed INTEGER NOT NULL CHECK (source_seed BETWEEN 0 AND 4294967295),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    cards_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, day_key)
);
