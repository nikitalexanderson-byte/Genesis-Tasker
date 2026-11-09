-- Coarse client categories only. No IP addresses, raw user agents or identifiers.
CREATE TABLE user_client_activity (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_kind TEXT NOT NULL CHECK (client_kind IN ('android_app', 'mobile_browser', 'desktop_browser')),
    last_seen_at TEXT NOT NULL,
    last_login_at TEXT,
    PRIMARY KEY (user_id, client_kind)
);
