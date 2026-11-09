-- User-approved full lifetime access for accounts already present at the recorded cutoff.
-- A fixed cutoff keeps accounts created between preparation and a future deploy on Free.
-- Preserve the previous values for an explicit, separately approved rollback if ever needed.
CREATE TABLE subscription_lifetime_grants (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('existing-314', 'play-testing')),
    granted_at TEXT NOT NULL,
    evidence_hash TEXT,
    previous_plan TEXT NOT NULL,
    previous_valid_until TEXT,
    UNIQUE(user_id, source)
);

INSERT INTO subscription_lifetime_grants
    (id, user_id, source, granted_at, previous_plan, previous_valid_until)
SELECT 'existing-314:' || id, id, 'existing-314', '2026-10-31T22:23:45Z', subscription_plan, subscription_valid_until
FROM users
WHERE julianday(created_at) <= julianday('2026-10-31T22:23:45Z');

UPDATE users SET subscription_plan = 'premium4life', subscription_valid_until = NULL
WHERE id IN (SELECT user_id FROM subscription_lifetime_grants WHERE source = 'existing-314');
