-- Additive; no historical audit replay and no external subscriptions are created.
CREATE TABLE shared_task_watchers (
    task_id TEXT NOT NULL REFERENCES shared_tasks(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    watching INTEGER NOT NULL DEFAULT 1 CHECK(watching IN (0,1)),
    PRIMARY KEY(task_id,user_id)
);
CREATE INDEX shared_task_watchers_user ON shared_task_watchers(user_id,task_id);
CREATE TABLE shared_notification_events (
    event_id TEXT PRIMARY KEY REFERENCES shared_audit_events(id) ON DELETE CASCADE
);
CREATE TABLE shared_notification_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);
CREATE TABLE shared_notification_task_state (
    task_id TEXT PRIMARY KEY REFERENCES shared_tasks(id) ON DELETE CASCADE,
    due_date TEXT,
    due_version INTEGER NOT NULL DEFAULT 1,
    approval_version INTEGER NOT NULL DEFAULT 1,
    completed INTEGER NOT NULL DEFAULT 0,
    imported INTEGER NOT NULL DEFAULT 0 CHECK(imported IN (0,1))
);
-- Historical imports have no task.created event. Do not activate their reminders by installing B7.
INSERT INTO shared_notification_task_state(task_id,due_date,completed,imported)
SELECT t.id,t.due_date,CASE WHEN t.completed_at IS NULL THEN 0 ELSE 1 END,1 FROM shared_tasks t
WHERE t.project_id IN (SELECT project_id FROM shared_audit_events WHERE action='project.imported')
AND t.id NOT IN (SELECT object_id FROM shared_audit_events WHERE action='task.created' AND object_id IS NOT NULL);
CREATE TABLE shared_notification_recipients (
    event_id TEXT NOT NULL REFERENCES shared_audit_events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    task_id TEXT REFERENCES shared_tasks(id) ON DELETE CASCADE,
    due_version INTEGER,
    approval_version INTEGER,
    PRIMARY KEY(event_id,user_id)
);
CREATE INDEX shared_notification_recipients_user ON shared_notification_recipients(user_id,event_id);
CREATE TABLE shared_notification_receipts (
    task_id TEXT NOT NULL REFERENCES shared_tasks(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    version INTEGER NOT NULL,
    event_id TEXT REFERENCES shared_audit_events(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(task_id,user_id,kind,version)
);
CREATE TABLE shared_push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint_hash TEXT NOT NULL UNIQUE,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_error TEXT
);
CREATE INDEX shared_push_subscriptions_user ON shared_push_subscriptions(user_id,id);
CREATE TABLE shared_notification_outbox (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK(channel IN ('push','email')),
    target_id TEXT NOT NULL,
    bucket_key TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','cancelled','failed')),
    available_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    error_code TEXT,
    UNIQUE(user_id,channel,target_id,bucket_key)
);
CREATE INDEX shared_notification_outbox_user ON shared_notification_outbox(user_id,created_at,id);
CREATE TABLE shared_notification_delivery_items (
    delivery_id TEXT NOT NULL REFERENCES shared_notification_outbox(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    target_id TEXT NOT NULL,
    PRIMARY KEY(event_id,user_id,channel,target_id),
    FOREIGN KEY(event_id,user_id) REFERENCES shared_notification_recipients(event_id,user_id) ON DELETE CASCADE
);
CREATE INDEX shared_notification_delivery_items_delivery ON shared_notification_delivery_items(delivery_id,event_id);
CREATE TABLE shared_notification_scan_state (
    id INTEGER PRIMARY KEY CHECK(id=1),
    task_cursor TEXT NOT NULL DEFAULT '',
    user_cursor TEXT NOT NULL DEFAULT ''
);
INSERT INTO shared_notification_scan_state(id) VALUES(1);
