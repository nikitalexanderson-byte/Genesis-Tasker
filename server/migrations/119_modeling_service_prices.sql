-- Preserve frozen legacy invoices while admitting the approved 3.2.2 prices.
-- The migration runner wraps this rebuild in one transaction. No provider calls occur.
CREATE TABLE future_modeling_orders_v119 (
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
    CHECK((provider='yookassa' AND currency='RUB' AND amount_minor IN (222200,2000000))
       OR (provider='lemon-squeezy' AND currency='USD' AND amount_minor IN (2200,20000)))
);
INSERT INTO future_modeling_orders_v119 (
    id,user_id,result_id,provider,amount_minor,currency,product_id,idempotency_key,status,
    checkout_url,provider_secret,encrypted_request,started_at,updated_at,lease_token,
    lease_until,scan_cursor,confirmed_at,evidence_hash
)
SELECT id,user_id,result_id,provider,amount_minor,currency,product_id,idempotency_key,status,
    checkout_url,provider_secret,encrypted_request,started_at,updated_at,lease_token,
    lease_until,scan_cursor,confirmed_at,evidence_hash FROM future_modeling_orders;
DROP TRIGGER future_modeling_pending_delete;
DROP TABLE future_modeling_orders;
ALTER TABLE future_modeling_orders_v119 RENAME TO future_modeling_orders;
CREATE UNIQUE INDEX future_modeling_one_active_order ON future_modeling_orders(result_id) WHERE status IN ('pending','paid');
CREATE INDEX future_modeling_order_owner ON future_modeling_orders(user_id,started_at);
CREATE TRIGGER future_modeling_pending_delete BEFORE DELETE ON future_modeling_orders
WHEN OLD.status='pending' BEGIN SELECT RAISE(ABORT,'BILLING_PENDING_ORDER'); END;
