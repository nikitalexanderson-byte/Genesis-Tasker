-- Additive server-only donation evidence. Card fields and sender IP are never stored.
CREATE TABLE donation_intents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
);
CREATE INDEX donation_intents_user ON donation_intents(user_id, created_at);
CREATE TABLE donation_receipts (
    transaction_hash TEXT PRIMARY KEY,
    intent_id TEXT REFERENCES donation_intents(id) ON DELETE SET NULL,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
    currency TEXT NOT NULL CHECK(length(currency) = 3),
    paid_at TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    evidence_hash TEXT NOT NULL
);
CREATE INDEX donation_receipts_user ON donation_receipts(user_id);
