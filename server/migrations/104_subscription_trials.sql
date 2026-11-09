-- A trial is a separate non-monetary grant. Paid plans, receipts and credits are untouched.
CREATE TABLE subscription_trials (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    grant_id TEXT NOT NULL UNIQUE CHECK(length(grant_id) BETWEEN 1 AND 100),
    plan TEXT NOT NULL CHECK(plan IN ('standart','premium','business')),
    starts_at INTEGER NOT NULL CHECK(typeof(starts_at)='integer' AND starts_at>0),
    ends_at INTEGER NOT NULL CHECK(typeof(ends_at)='integer' AND ends_at=starts_at+259200),
    revoked_at INTEGER CHECK(revoked_at IS NULL OR (typeof(revoked_at)='integer' AND revoked_at>0))
);

-- Single-use identity claims deliberately survive deletion of the account and grant.
-- Only server-keyed hashes, an opaque grant ID and a timestamp are retained.
CREATE TABLE subscription_trial_claims (
    identity_hash TEXT PRIMARY KEY CHECK(length(identity_hash)=64 AND identity_hash NOT GLOB '*[^0-9a-f]*'),
    grant_id TEXT NOT NULL CHECK(length(grant_id) BETWEEN 1 AND 100),
    used_at INTEGER NOT NULL CHECK(typeof(used_at)='integer' AND used_at>0)
);
CREATE INDEX subscription_trial_claims_grant ON subscription_trial_claims(grant_id);

CREATE TRIGGER subscription_trial_window_immutable BEFORE UPDATE ON subscription_trials
WHEN NEW.user_id IS NOT OLD.user_id OR NEW.grant_id IS NOT OLD.grant_id OR NEW.plan IS NOT OLD.plan
 OR NEW.starts_at IS NOT OLD.starts_at OR NEW.ends_at IS NOT OLD.ends_at
 OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
BEGIN
 SELECT RAISE(ABORT,'GENESIS_TRIAL_IMMUTABLE');
END;
CREATE TRIGGER subscription_trial_claim_immutable_update BEFORE UPDATE ON subscription_trial_claims
BEGIN
 SELECT RAISE(ABORT,'GENESIS_TRIAL_CLAIM_IMMUTABLE');
END;
CREATE TRIGGER subscription_trial_claim_immutable_delete BEFORE DELETE ON subscription_trial_claims
BEGIN
 SELECT RAISE(ABORT,'GENESIS_TRIAL_CLAIM_IMMUTABLE');
END;
