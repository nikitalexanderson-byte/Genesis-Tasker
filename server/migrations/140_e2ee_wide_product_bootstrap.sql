-- Widen the existing staged protocol without changing its signatures or IDs.
-- Preserve every accepted bootstrap, part, proof and activation packet.
CREATE TABLE e2ee_product_bootstraps_wide (
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 generation INTEGER NOT NULL,
 bootstrap_id TEXT NOT NULL,
 source_manifest_hash TEXT NOT NULL,
 expected_count INTEGER NOT NULL CHECK(expected_count BETWEEN 1 AND 100000),
 state TEXT NOT NULL CHECK(state IN ('staging','active')),
 commit_packet TEXT,
 PRIMARY KEY(scope_id,generation),UNIQUE(bootstrap_id)
);
INSERT INTO e2ee_product_bootstraps_wide SELECT * FROM e2ee_product_bootstraps;
CREATE TABLE e2ee_product_bootstrap_parts_wide (
 scope_id TEXT NOT NULL,
 generation INTEGER NOT NULL,
 bootstrap_id TEXT NOT NULL,
 part_index INTEGER NOT NULL CHECK(part_index BETWEEN 0 AND 4095),
 proof_hash TEXT NOT NULL,
 signed_command TEXT NOT NULL,
 PRIMARY KEY(scope_id,generation,part_index),
 FOREIGN KEY(scope_id,generation) REFERENCES e2ee_product_bootstraps_wide(scope_id,generation) ON DELETE CASCADE
);
INSERT INTO e2ee_product_bootstrap_parts_wide SELECT * FROM e2ee_product_bootstrap_parts;
DROP TABLE e2ee_product_bootstrap_parts;
DROP TABLE e2ee_product_bootstraps;
ALTER TABLE e2ee_product_bootstraps_wide RENAME TO e2ee_product_bootstraps;
ALTER TABLE e2ee_product_bootstrap_parts_wide RENAME TO e2ee_product_bootstrap_parts;
