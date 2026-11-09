-- Explicitly authorized 3.2.2 consolidation. Existing manual grants gain the
-- permanent product plan; receipts, identities, projects and billing history stay intact.
CREATE TABLE elite_plus_plan_migration (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    previous_plan TEXT NOT NULL,
    previous_valid_until TEXT,
    migrated_at TEXT NOT NULL
);
INSERT INTO elite_plus_plan_migration(user_id,previous_plan,previous_valid_until,migrated_at)
SELECT id,subscription_plan,subscription_valid_until,strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM users WHERE forecast_elite_plus=1;
INSERT INTO subscription_access_state(user_id,revision,materialized_billing)
SELECT id,1,0 FROM users WHERE forecast_elite_plus=1
ON CONFLICT(user_id) DO UPDATE SET revision=revision+1,materialized_billing=0;
UPDATE users SET subscription_plan='premium4life',subscription_valid_until=NULL
WHERE forecast_elite_plus=1;
