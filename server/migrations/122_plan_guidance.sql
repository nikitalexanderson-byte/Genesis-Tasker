-- Additive, account-scoped presentation state. No access rights or existing data change.
CREATE TABLE plan_guidance_state (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    return_visit_hash TEXT,
    last_return_notice_hash TEXT,
    last_shown_at TEXT,
    rotation INTEGER NOT NULL DEFAULT 0,
    lease_token TEXT,
    lease_until TEXT,
    lease_json TEXT,
    notice_json TEXT,
    read_at TEXT,
    updated_at TEXT NOT NULL
);
