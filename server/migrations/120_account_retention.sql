-- Additive only. The cohort is fixed at migration time, never inferred from a
-- future administrative lifetime grant. Financial evidence is rechecked at run time.
CREATE TABLE account_retention_state (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_activity_at TEXT NOT NULL,
    has_returned INTEGER NOT NULL DEFAULT 0 CHECK(has_returned IN (0,1)),
    first_visit_hash TEXT,
    activity_revision INTEGER NOT NULL DEFAULT 0,
    complimentary_elite_cohort INTEGER NOT NULL DEFAULT 0 CHECK(complimentary_elite_cohort IN (0,1)),
    free_since TEXT,
    next_check_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX account_retention_check ON account_retention_state(next_check_at,user_id);

INSERT INTO account_retention_state(user_id,last_activity_at,has_returned,complimentary_elite_cohort,next_check_at,created_at,updated_at)
SELECT u.id,
    -- Legacy last_seen may include a background request: retaining it is the
    -- conservative migration choice. New clients have separate foreground data.
    MAX(CASE WHEN datetime(u.created_at) IS NOT NULL THEN strftime('%Y-%m-%dT%H:%M:%SZ',u.created_at) ELSE strftime('%Y-%m-%dT%H:%M:%SZ','now') END,
        COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ',u.last_seen_at),''),
        COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ',u.last_login_at),''),
        COALESCE((SELECT MAX(strftime('%Y-%m-%dT%H:%M:%SZ',a.last_seen_at)) FROM user_client_activity a WHERE a.user_id=u.id),'')),
    CASE WHEN u.login_count>1 OR julianday(u.last_seen_at)>julianday(u.created_at)+1.0/1440
        OR julianday(u.last_login_at)>julianday(u.created_at)+1.0/1440
        OR EXISTS(SELECT 1 FROM user_client_activity a WHERE a.user_id=u.id AND julianday(a.last_seen_at)>julianday(u.created_at)+1.0/1440)
        THEN 1 ELSE 0 END,
    CASE WHEN u.subscription_plan='premium4life' AND COALESCE(s.materialized_billing,0)=0 THEN 1 ELSE 0 END,
    strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM users u LEFT JOIN subscription_access_state s ON s.user_id=u.id;

-- Dedicated mandatory service-mail outbox: optional notification opt-out never
-- bypasses a warning, and no accepted SMTP delivery means no automatic deletion.
CREATE TABLE account_retention_notices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rule TEXT NOT NULL CHECK(rule IN ('free-unreturned','free-inactive','former-paid-inactive','complimentary-elite-inactive','complimentary-elite-year')),
    policy_fingerprint TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    rule_deadline_at TEXT NOT NULL,
    promised_delete_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','accepted','cancelled','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TEXT NOT NULL,
    lease_token TEXT,
    lease_until TEXT,
    accepted_at TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id,policy_fingerprint)
);
CREATE INDEX account_retention_notice_work ON account_retention_notices(state,available_at,id);
CREATE INDEX account_retention_notice_user ON account_retention_notices(user_id,state);
