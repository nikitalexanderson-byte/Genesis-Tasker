-- Only counters for allowlisted navigation features; no task or project content.
CREATE TABLE IF NOT EXISTS feature_usage (
    user_id TEXT NOT NULL,
    feature_id TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('web', 'android')),
    open_count INTEGER NOT NULL DEFAULT 0 CHECK (open_count >= 0),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (user_id, feature_id, platform),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS feature_usage_feature_idx ON feature_usage(feature_id);
