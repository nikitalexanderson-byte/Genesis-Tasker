-- Additive, server-owned upgrade quotations. Legacy orders/receipts remain valid.
ALTER TABLE billing_orders ADD COLUMN list_amount_minor INTEGER;
ALTER TABLE billing_orders ADD COLUMN upgrade_credit_minor INTEGER NOT NULL DEFAULT 0 CHECK (upgrade_credit_minor >= 0);

-- One paid period can fund at most one open or completed upgrade.
-- Failed/cancelled upgrades release their reservation only after provider confirmation.
CREATE TABLE billing_upgrade_credits (
    source_provider TEXT NOT NULL,
    source_reference_hash TEXT NOT NULL,
    order_id TEXT NOT NULL REFERENCES billing_orders(id) ON DELETE CASCADE,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    quoted_at TEXT NOT NULL,
    source_starts_at TEXT NOT NULL,
    source_ends_at TEXT NOT NULL,
    source_value_minor INTEGER NOT NULL CHECK (source_value_minor > 0),
    PRIMARY KEY (source_provider, source_reference_hash),
    FOREIGN KEY (source_provider, source_reference_hash)
        REFERENCES billing_receipts(provider, reference_hash) ON DELETE CASCADE
);
CREATE INDEX billing_upgrade_credits_order ON billing_upgrade_credits(order_id);
