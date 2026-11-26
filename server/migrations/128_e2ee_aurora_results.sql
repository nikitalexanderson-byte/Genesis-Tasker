-- Content stays in signed client ciphertext. This table supplies only an
-- immutable billing reference, independently of legacy private-content fences.
CREATE TABLE e2ee_aurora_results (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 generation INTEGER NOT NULL,
 object_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 method_version TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(scope_id,generation,object_id)
);
CREATE TRIGGER e2ee_aurora_reference_immutable BEFORE UPDATE ON e2ee_aurora_results
BEGIN SELECT RAISE(ABORT,'AURORA_RESULT_IMMUTABLE'); END;
CREATE TRIGGER e2ee_aurora_object_immutable BEFORE UPDATE ON e2ee_objects
WHEN OLD.domain='aurora' AND OLD.object_id GLOB 'aurora-result-live:*'
BEGIN SELECT RAISE(ABORT,'AURORA_RESULT_IMMUTABLE'); END;
