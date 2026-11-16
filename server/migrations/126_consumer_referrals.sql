-- Consumer subscription discounts are independent of the private cash partner program.
CREATE TABLE consumer_referral_codes (
    owner_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);
CREATE TABLE consumer_referral_invites (
    token_hash TEXT PRIMARY KEY,
    owner_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT
);
CREATE TABLE consumer_referral_links (
    invitee_hash TEXT PRIMARY KEY,
    owner_hash TEXT NOT NULL,
    invitee_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    registered_month TEXT NOT NULL,
    registered_at TEXT NOT NULL,
    first_paid_at TEXT,
    first_provider TEXT,
    first_reference_hash TEXT,
    CHECK (invitee_hash <> owner_hash)
);
CREATE INDEX consumer_referral_owner ON consumer_referral_links(owner_hash,registered_month);
CREATE TABLE consumer_referral_uses (
    owner_hash TEXT NOT NULL,
    reward_month TEXT NOT NULL,
    order_id TEXT UNIQUE,
    grant_id TEXT UNIQUE,
    percent INTEGER NOT NULL CHECK (percent BETWEEN 1 AND 100),
    status TEXT NOT NULL CHECK (status IN ('reserved','used')),
    basis_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(owner_hash,reward_month)
);
CREATE TABLE consumer_referral_grants (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward_month TEXT NOT NULL,
    plan TEXT NOT NULL CHECK (plan IN ('standart','premium','business')),
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    UNIQUE(user_id,reward_month)
);
ALTER TABLE billing_orders ADD COLUMN referral_discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (referral_discount_minor >= 0);
ALTER TABLE billing_orders ADD COLUMN referral_reward_month TEXT;
