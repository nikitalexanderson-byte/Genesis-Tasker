-- Additive. No subscriptions, schedules, historical notifications or personal content are imported.
CREATE TABLE habit_reminder_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_plan TEXT,
    plan_hash TEXT,
    workspace_version INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    needs_refresh INTEGER NOT NULL DEFAULT 1 CHECK(needs_refresh IN (0,1)),
    updated_at TEXT NOT NULL
);
CREATE TABLE habit_reminder_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_key TEXT NOT NULL,
    encrypted_subscription TEXT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    request_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    time_zone TEXT NOT NULL,
    max_per_day INTEGER NOT NULL DEFAULT 128 CHECK(max_per_day IN (4,12,24,64,128)),
    snooze_minutes INTEGER NOT NULL DEFAULT 10 CHECK(snooze_minutes IN (5,10,15,30,60)),
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id,device_key)
);
CREATE TABLE habit_reminder_deliveries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES habit_reminder_devices(id) ON DELETE CASCADE,
    profile_revision INTEGER NOT NULL,
    event_key TEXT NOT NULL,
    encrypted_target TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','cancelled','failed')),
    sent_at TEXT,
    reserved_at TEXT,
    snooze_of TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(device_id,event_key)
);
CREATE INDEX habit_reminder_deliveries_ready ON habit_reminder_deliveries(user_id,state,scheduled_at);
CREATE INDEX habit_reminder_deliveries_budget ON habit_reminder_deliveries(device_id,state,reserved_at);
