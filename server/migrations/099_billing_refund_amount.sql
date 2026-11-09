-- Net provider-confirmed funding; legacy paid receipts retain their existing full value.
-- Additive schema only. Code rollback leaves this column in place; no automatic DB rollback.
ALTER TABLE billing_receipts ADD COLUMN refunded_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount_minor >= 0);
