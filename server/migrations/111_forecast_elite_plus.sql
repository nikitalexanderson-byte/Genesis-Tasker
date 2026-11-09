-- Permanent forecast privilege is independent of the user's subscription.
ALTER TABLE users ADD COLUMN forecast_elite_plus INTEGER NOT NULL DEFAULT 0 CHECK(forecast_elite_plus IN (0,1));
ALTER TABLE users ADD COLUMN forecast_privilege_revision INTEGER NOT NULL DEFAULT 0 CHECK(forecast_privilege_revision>=0);
CREATE TABLE forecast_privilege_events (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
    revision INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
