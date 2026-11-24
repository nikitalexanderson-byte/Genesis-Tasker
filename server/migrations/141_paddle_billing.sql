-- Applied by the billing migration runner with foreign keys checked before commit.
CREATE TABLE billing_orders_paddle_new (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('google-play', 'lemon-squeezy', 'paddle', 'yookassa')),
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
    list_amount_minor INTEGER,
    upgrade_credit_minor INTEGER NOT NULL DEFAULT 0 CHECK (upgrade_credit_minor >= 0),
    encrypted_receipt TEXT,
    referral_discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (referral_discount_minor >= 0),
    referral_reward_month TEXT,
    UNIQUE(user_id, idempotency_key)
);
INSERT INTO billing_orders_paddle_new
    (id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,checkout_url,provider_secret,
     play_profile_hash,status,created_at,updated_at,list_amount_minor,upgrade_credit_minor,encrypted_receipt,
     referral_discount_minor,referral_reward_month)
SELECT id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,checkout_url,provider_secret,
       play_profile_hash,status,created_at,updated_at,list_amount_minor,upgrade_credit_minor,encrypted_receipt,
       referral_discount_minor,referral_reward_month FROM billing_orders;
DROP TABLE billing_orders;
ALTER TABLE billing_orders_paddle_new RENAME TO billing_orders;
CREATE INDEX billing_orders_user ON billing_orders(user_id, created_at);
CREATE UNIQUE INDEX billing_paddle_transaction ON billing_orders(provider_secret) WHERE provider = 'paddle' AND provider_secret IS NOT NULL;

CREATE TABLE billing_receipts_paddle_new (
    provider TEXT NOT NULL CHECK (provider IN ('google-play', 'lemon-squeezy', 'paddle', 'yookassa')),
    reference_hash TEXT NOT NULL,
    order_id TEXT NOT NULL REFERENCES billing_orders(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('paid', 'refunded', 'cancelled')),
    confirmed_at TEXT NOT NULL,
    provider_valid_until TEXT,
    evidence_hash TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    refunded_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount_minor >= 0),
    PRIMARY KEY(provider, reference_hash)
);
INSERT INTO billing_receipts_paddle_new
    (provider,reference_hash,order_id,state,confirmed_at,provider_valid_until,evidence_hash,verified_at,refunded_amount_minor)
SELECT provider,reference_hash,order_id,state,confirmed_at,provider_valid_until,evidence_hash,verified_at,refunded_amount_minor
FROM billing_receipts;
DROP TABLE billing_receipts;
ALTER TABLE billing_receipts_paddle_new RENAME TO billing_receipts;
CREATE INDEX billing_receipts_order ON billing_receipts(order_id);

CREATE TRIGGER billing_unsettled_order_delete BEFORE DELETE ON billing_orders
WHEN OLD.status='pending'
    OR EXISTS(SELECT 1 FROM billing_settlements s WHERE s.order_id=OLD.id AND s.state NOT IN ('completed','refunded','cancelled'))
BEGIN
    SELECT RAISE(ABORT,'BILLING_SETTLEMENT_REQUIRED');
END;

CREATE TABLE billing_paddle_checkout (
    order_id TEXT PRIMARY KEY REFERENCES billing_orders(id) ON DELETE CASCADE,
    lease_id TEXT,
    lease_until INTEGER NOT NULL DEFAULT 0,
    checked_at INTEGER NOT NULL DEFAULT 0
);
