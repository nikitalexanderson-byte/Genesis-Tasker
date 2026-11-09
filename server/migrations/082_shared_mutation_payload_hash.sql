-- Legacy receipts and legacy named-column writers remain valid after this additive change.
ALTER TABLE shared_mutation_receipts ADD COLUMN payload_hash TEXT
    CHECK (payload_hash IS NULL OR length(payload_hash) = 64);
