-- Immutable encrypted requests precede provider I/O. Code rollback leaves inert additive data.
CREATE TABLE billing_yookassa_recovery (
    order_id TEXT PRIMARY KEY REFERENCES billing_orders(id) ON DELETE CASCADE,
    encrypted_request TEXT NOT NULL,
    started_at TEXT NOT NULL,
    next_check_at TEXT NOT NULL,
    checked_at TEXT,
    error_code TEXT,
    scan_cursor TEXT,
    lease_token TEXT,
    lease_until TEXT
);
CREATE INDEX billing_yookassa_recovery_due ON billing_yookassa_recovery(next_check_at,order_id);
