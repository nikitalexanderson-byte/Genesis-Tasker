-- Additive one-off service billing. Existing subscriptions and their receipts are untouched.
CREATE TABLE future_modeling_results (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method_version TEXT NOT NULL,
    encrypted_result TEXT NOT NULL,
    result_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX future_modeling_result_owner ON future_modeling_results(user_id,created_at);
CREATE TABLE future_modeling_orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    result_id TEXT NOT NULL REFERENCES future_modeling_results(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK(provider IN ('yookassa','lemon-squeezy')),
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    product_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','cancelled','refunded')),
    checkout_url TEXT,
    provider_secret TEXT,
    encrypted_request TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    lease_token TEXT,
    lease_until TEXT,
    scan_cursor TEXT,
    confirmed_at TEXT,
    evidence_hash TEXT,
    UNIQUE(user_id,idempotency_key),
    UNIQUE(provider,provider_secret),
    CHECK((provider='yookassa' AND currency='RUB' AND amount_minor=222200)
       OR (provider='lemon-squeezy' AND currency='USD' AND amount_minor=2200))
);
CREATE UNIQUE INDEX future_modeling_one_active_order ON future_modeling_orders(result_id) WHERE status IN ('pending','paid');
CREATE INDEX future_modeling_order_owner ON future_modeling_orders(user_id,started_at);
-- Pending provider payments must be settled before their account or result can be deleted.
CREATE TRIGGER future_modeling_pending_delete BEFORE DELETE ON future_modeling_orders
WHEN OLD.status='pending' BEGIN SELECT RAISE(ABORT,'BILLING_PENDING_ORDER'); END;
