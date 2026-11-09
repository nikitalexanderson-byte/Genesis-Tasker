-- Additive money-recovery outbox. Existing order/receipt CHECK constraints stay unchanged.
ALTER TABLE billing_orders ADD COLUMN encrypted_receipt TEXT;
CREATE TABLE billing_settlements (
    order_id TEXT PRIMARY KEY REFERENCES billing_orders(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('capture-pending','refund-required','refund-pending','completed','refunded','cancelled','failed')),
    reason TEXT,
    capture_action TEXT CHECK (capture_action IN ('capture','cancel')),
    reference_hash TEXT,
    captured_at TEXT,
    promised_ends_at TEXT,
    deficit_minor INTEGER NOT NULL DEFAULT 0 CHECK (deficit_minor >= 0),
    refund_amount_minor INTEGER CHECK (refund_amount_minor > 0),
    refund_base_minor INTEGER CHECK (refund_base_minor >= 0),
    refund_key TEXT UNIQUE,
    encrypted_refund_request TEXT,
    refund_id TEXT,
    refund_started_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX billing_settlements_due ON billing_settlements(state,next_attempt_at);

-- Account/order cascades cannot erase money whose capture/refund outcome is still unresolved.
CREATE TRIGGER billing_unsettled_order_delete BEFORE DELETE ON billing_orders
WHEN (OLD.status='pending' AND OLD.upgrade_credit_minor>0)
    OR EXISTS(SELECT 1 FROM billing_settlements s WHERE s.order_id=OLD.id AND s.state NOT IN ('completed','refunded','cancelled'))
BEGIN
    SELECT RAISE(ABORT,'BILLING_SETTLEMENT_REQUIRED');
END;
