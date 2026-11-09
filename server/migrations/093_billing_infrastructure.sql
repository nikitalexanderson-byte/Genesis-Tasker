-- Server-side payment evidence. Neither a client redirect nor a local plan creates a grant.
CREATE TABLE billing_orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('google-play', 'lemon-squeezy', 'yookassa')),
    plan TEXT NOT NULL CHECK (plan IN ('standart', 'premium', 'business', 'premium4life')),
    period_months INTEGER NOT NULL CHECK ((plan = 'premium4life' AND period_months = 0) OR (plan <> 'premium4life' AND period_months IN (1, 6, 12))),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL CHECK (length(currency) = 3),
    product_id TEXT NOT NULL,
    checkout_url TEXT,
    provider_secret TEXT,
    play_profile_hash TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, idempotency_key)
);
CREATE INDEX billing_orders_user ON billing_orders(user_id, created_at);

CREATE TABLE billing_receipts (
    provider TEXT NOT NULL CHECK (provider IN ('google-play', 'lemon-squeezy', 'yookassa')),
    reference_hash TEXT NOT NULL,
    order_id TEXT NOT NULL REFERENCES billing_orders(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('paid', 'refunded', 'cancelled')),
    confirmed_at TEXT NOT NULL,
    provider_valid_until TEXT,
    evidence_hash TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    PRIMARY KEY(provider, reference_hash)
);
CREATE INDEX billing_receipts_order ON billing_receipts(order_id);

CREATE TABLE billing_periods (
    provider TEXT NOT NULL,
    reference_hash TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL CHECK (plan IN ('standart', 'premium', 'business')),
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    PRIMARY KEY(provider, reference_hash),
    FOREIGN KEY(provider, reference_hash) REFERENCES billing_receipts(provider, reference_hash) ON DELETE CASCADE
);
CREATE INDEX billing_periods_user ON billing_periods(user_id, starts_at, ends_at);

CREATE TABLE billing_play_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_hash TEXT NOT NULL UNIQUE,
    version_code INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT
);
CREATE INDEX billing_play_challenges_expiry ON billing_play_challenges(expires_at);

-- These non-reversible identity fingerprints deliberately outlive an account deletion.
-- No email, Google subject, token, workspace or billing credentials are retained here.
CREATE TABLE subscription_revocations (
    identity_hash TEXT PRIMARY KEY,
    revoked_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE subscription_access_state (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0,
    receipts_after TEXT,
    materialized_billing INTEGER NOT NULL DEFAULT 0,
    automatic_grants_blocked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE billing_payment_claims (
    provider TEXT NOT NULL,
    reference_hash TEXT NOT NULL,
    order_id TEXT NOT NULL,
    owner_hash TEXT NOT NULL,
    PRIMARY KEY(provider, reference_hash)
);
CREATE TABLE billing_lifetime_seats (
    seat INTEGER PRIMARY KEY CHECK (seat BETWEEN 1 AND 12),
    owner_hash TEXT UNIQUE,
    order_id TEXT UNIQUE,
    reserved_until TEXT,
    purchased_at TEXT,
    revoked_at TEXT
);
INSERT INTO billing_lifetime_seats(seat) VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12);
