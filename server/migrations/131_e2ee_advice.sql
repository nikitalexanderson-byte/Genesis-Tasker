-- Published selection identities and text stay inside the immutable object.
-- The server independently owns day/slot/collection capacity and replay receipts.
CREATE TABLE e2ee_advice_issues (
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 day_key TEXT NOT NULL,
 slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 9),
 collection TEXT NOT NULL CHECK(collection IN ('aurora','philosophers')),
 object_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 PRIMARY KEY(scope_id,day_key,slot),
 UNIQUE(scope_id,object_id)
);
CREATE TRIGGER e2ee_advice_version_immutable BEFORE UPDATE ON e2ee_objects
WHEN OLD.domain='workspace' AND OLD.object_id GLOB 'advice-live:*'
BEGIN SELECT RAISE(ABORT,'E2EE_ADVICE_IMMUTABLE'); END;
