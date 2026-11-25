CREATE TABLE billing_play_void_scan (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    checked_through INTEGER NOT NULL DEFAULT 0,
    page_token TEXT,
    window_end INTEGER,
    next_attempt_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO billing_play_void_scan (id) VALUES (1);
