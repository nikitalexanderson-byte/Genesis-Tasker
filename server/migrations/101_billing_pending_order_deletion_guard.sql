-- Extend the existing guard without changing orders, receipts or account data.
-- A full-price checkout can still collect cash before its first webhook, including
-- while checkout creation is in flight and both provider references are NULL.
DROP TRIGGER billing_unsettled_order_delete;
CREATE TRIGGER billing_unsettled_order_delete BEFORE DELETE ON billing_orders
WHEN OLD.status='pending'
    OR EXISTS(SELECT 1 FROM billing_settlements s WHERE s.order_id=OLD.id AND s.state NOT IN ('completed','refunded','cancelled'))
BEGIN
    SELECT RAISE(ABORT,'BILLING_SETTLEMENT_REQUIRED');
END;
