-- Private, manually assigned partners. Financial rows do not cascade with accounts or orders.
CREATE TABLE partner_policies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_bps INTEGER NOT NULL CHECK (share_bps = 5000),
    invitation_days INTEGER NOT NULL CHECK (invitation_days BETWEEN 1 AND 365),
    retention_days INTEGER CHECK (retention_days IS NULL),
    confirmed_at TEXT NOT NULL,
    actor_id TEXT NOT NULL
);
CREATE TABLE partner_settings (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    policy_id INTEGER REFERENCES partner_policies(id),
    revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO partner_settings(singleton) VALUES(1);
CREATE TABLE partners (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    label TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    accepts_invitations INTEGER NOT NULL DEFAULT 0 CHECK (accepts_invitations IN (0,1)),
    panel_enabled INTEGER NOT NULL DEFAULT 1 CHECK (panel_enabled IN (0,1)),
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
CREATE TABLE partner_invites (
    token_hash TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    policy_id INTEGER NOT NULL REFERENCES partner_policies(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT
);
CREATE INDEX partner_invites_expiry ON partner_invites(expires_at);
CREATE TABLE partner_visit_days (
    partner_id TEXT NOT NULL REFERENCES partners(id),
    day TEXT NOT NULL,
    visits INTEGER NOT NULL DEFAULT 0 CHECK (visits >= 0),
    PRIMARY KEY(partner_id,day)
);
CREATE TABLE partner_clients (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    policy_id INTEGER NOT NULL REFERENCES partner_policies(id),
    source TEXT NOT NULL CHECK (source IN ('google-registration','owner-review')),
    bound_at TEXT NOT NULL,
    ended_at TEXT
);
CREATE UNIQUE INDEX partner_clients_current_user ON partner_clients(user_id) WHERE ended_at IS NULL;
CREATE INDEX partner_clients_owner ON partner_clients(partner_id,bound_at,id);
CREATE TABLE partner_payments (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    client_id TEXT NOT NULL REFERENCES partner_clients(id),
    policy_id INTEGER NOT NULL REFERENCES partner_policies(id),
    order_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider = 'yookassa'),
    reference_hash TEXT NOT NULL,
    plan TEXT NOT NULL,
    period_months INTEGER NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL CHECK (currency = 'RUB'),
    confirmed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    refunded_minor INTEGER NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0 AND refunded_minor <= amount_minor),
    revision INTEGER NOT NULL DEFAULT 0,
    verification_context TEXT NOT NULL,
    UNIQUE(provider,reference_hash),
    UNIQUE(order_id)
);
CREATE INDEX partner_payments_owner ON partner_payments(partner_id,confirmed_at,id);
CREATE TABLE partner_calculations (
    id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL REFERENCES partner_payments(id),
    revision INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('payment','refund','estimate','confirmation','correction')),
    state TEXT NOT NULL CHECK (state IN ('preliminary','confirmed')),
    refunded_minor INTEGER NOT NULL CHECK (refunded_minor >= 0),
    fee_minor INTEGER CHECK (fee_minor IS NULL OR fee_minor >= 0),
    tax_minor INTEGER CHECK (tax_minor IS NULL OR tax_minor >= 0),
    base_minor INTEGER,
    share_minor INTEGER,
    share_bps INTEGER NOT NULL CHECK (share_bps = 5000),
    actor_id TEXT,
    reason TEXT NOT NULL,
    evidence_hash TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(payment_id,revision),
    CHECK ((base_minor IS NULL) = (share_minor IS NULL)),
    CHECK (state <> 'confirmed' OR (fee_minor IS NOT NULL AND tax_minor IS NOT NULL AND share_minor IS NOT NULL))
);
CREATE TABLE partner_payouts (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    paid_on TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    note TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX partner_payouts_owner ON partner_payouts(partner_id,paid_on,id);
CREATE TABLE partner_payout_corrections (
    id TEXT PRIMARY KEY,
    payout_id TEXT NOT NULL REFERENCES partner_payouts(id),
    delta_minor INTEGER NOT NULL CHECK (delta_minor <> 0),
    reason TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE partner_mutation_receipts (
    actor_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(actor_id,request_id)
);
CREATE TABLE partner_audit (
    id TEXT PRIMARY KEY,
    partner_id TEXT REFERENCES partners(id),
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_id TEXT,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX partner_audit_owner ON partner_audit(partner_id,created_at,id);

CREATE TRIGGER partner_policy_no_update BEFORE UPDATE ON partner_policies BEGIN SELECT RAISE(ABORT,'PARTNER_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER partner_policy_no_delete BEFORE DELETE ON partner_policies BEGIN SELECT RAISE(ABORT,'PARTNER_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER partner_calculation_no_update BEFORE UPDATE ON partner_calculations BEGIN SELECT RAISE(ABORT,'PARTNER_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER partner_calculation_no_delete BEFORE DELETE ON partner_calculations BEGIN SELECT RAISE(ABORT,'PARTNER_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER partner_payout_no_update BEFORE UPDATE ON partner_payouts BEGIN SELECT RAISE(ABORT,'PARTNER_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER partner_payout_no_delete BEFORE DELETE ON partner_payouts BEGIN SELECT RAISE(ABORT,'PARTNER_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER partner_payout_correction_no_update BEFORE UPDATE ON partner_payout_corrections BEGIN SELECT RAISE(ABORT,'PARTNER_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER partner_payout_correction_no_delete BEFORE DELETE ON partner_payout_corrections BEGIN SELECT RAISE(ABORT,'PARTNER_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER partner_audit_no_update BEFORE UPDATE ON partner_audit BEGIN SELECT RAISE(ABORT,'PARTNER_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER partner_audit_no_delete BEFORE DELETE ON partner_audit BEGIN SELECT RAISE(ABORT,'PARTNER_HISTORY_IMMUTABLE'); END;
