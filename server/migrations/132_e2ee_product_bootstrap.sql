-- A partial baseline must never appear to participants as an empty/complete
-- live project. Owner-signed parts activate together in one writer transaction.
CREATE TABLE e2ee_product_bootstraps (
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 generation INTEGER NOT NULL,
 bootstrap_id TEXT NOT NULL,
 source_manifest_hash TEXT NOT NULL,
 expected_count INTEGER NOT NULL CHECK(expected_count BETWEEN 1 AND 10000),
 state TEXT NOT NULL CHECK(state IN ('staging','active')),
 commit_packet TEXT,
 PRIMARY KEY(scope_id,generation),UNIQUE(bootstrap_id)
);
CREATE TABLE e2ee_product_bootstrap_parts (
 scope_id TEXT NOT NULL,
 generation INTEGER NOT NULL,
 bootstrap_id TEXT NOT NULL,
 part_index INTEGER NOT NULL CHECK(part_index BETWEEN 0 AND 255),
 proof_hash TEXT NOT NULL,
 signed_command TEXT NOT NULL,
 PRIMARY KEY(scope_id,generation,part_index),
 FOREIGN KEY(scope_id,generation) REFERENCES e2ee_product_bootstraps(scope_id,generation) ON DELETE CASCADE
);
CREATE TRIGGER e2ee_migrated_original_immutable BEFORE UPDATE ON e2ee_objects
WHEN OLD.object_id GLOB 'private-table:*' OR OLD.object_id GLOB 'private-path:*' OR OLD.object_id GLOB 'private-file:*'
BEGIN SELECT RAISE(ABORT,'E2EE_MIGRATED_ORIGINAL_IMMUTABLE'); END;
