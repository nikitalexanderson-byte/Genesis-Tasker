CREATE TABLE IF NOT EXISTS yandex_calendar_connections (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    login_enc TEXT NOT NULL,
    app_password_enc TEXT NOT NULL,
    calendar_path_enc TEXT NOT NULL,
    last_checked_at TEXT,
    connected_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS yandex_calendar_tasks (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    payload_enc TEXT NOT NULL,
    event_path_enc TEXT NOT NULL,
    event_etag TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, task_id)
);
