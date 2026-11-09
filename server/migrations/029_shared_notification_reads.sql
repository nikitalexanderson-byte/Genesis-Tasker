CREATE TABLE shared_notification_reads (
    event_id TEXT NOT NULL REFERENCES shared_audit_events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TEXT NOT NULL,
    PRIMARY KEY (event_id, user_id)
);
CREATE INDEX shared_notification_reads_user_idx ON shared_notification_reads(user_id, read_at);
