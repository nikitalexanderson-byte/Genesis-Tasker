-- Additive. Legacy advice parsers keep their original JSON and can be restored without database rollback.
ALTER TABLE users ADD COLUMN advice_notifications_json TEXT NOT NULL DEFAULT '{}';
CREATE TABLE advice_notification_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint_hash TEXT NOT NULL UNIQUE,
    encrypted_subscription TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX advice_notification_devices_user ON advice_notification_devices(user_id);
CREATE TABLE advice_notification_days (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_key TEXT NOT NULL,
    advice_id TEXT NOT NULL,
    collection TEXT NOT NULL CHECK(collection IN ('aurora','philosophers')),
    scheduled_time TEXT NOT NULL,
    time_zone TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(user_id,day_key)
);
CREATE TABLE advice_notification_deliveries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES advice_notification_devices(id) ON DELETE CASCADE,
    day_key TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','cancelled','failed')),
    sent_at TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(device_id,day_key)
);
CREATE INDEX advice_notification_deliveries_pending ON advice_notification_deliveries(user_id,state);
