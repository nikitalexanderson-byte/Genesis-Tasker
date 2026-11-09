CREATE TABLE IF NOT EXISTS android_download_activity (
    user_id TEXT PRIMARY KEY,
    request_count INTEGER NOT NULL DEFAULT 0,
    first_requested_at TEXT NOT NULL,
    last_requested_at TEXT NOT NULL,
    last_requested_version TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS android_client_reports (
    user_id TEXT NOT NULL,
    installation_id TEXT NOT NULL,
    app_version TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_server_sync_at TEXT,
    server_sync_status TEXT NOT NULL DEFAULT 'unknown',
    google_sync_status TEXT NOT NULL DEFAULT 'unknown',
    PRIMARY KEY (user_id, installation_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS android_client_reports_last_seen_idx
    ON android_client_reports(user_id, last_seen_at DESC);
