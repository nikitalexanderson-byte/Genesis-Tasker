-- Only counters, periods, reveal windows and immutable ciphertext references.
-- Seeds, dealt cards and reflections stay exclusively in client ciphertext.
CREATE TABLE e2ee_stoicheion_heads (
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('daily','spread','timeline')),
 period_key TEXT NOT NULL,
 state_json TEXT NOT NULL,
 PRIMARY KEY(scope_id,kind,period_key)
);
CREATE TRIGGER e2ee_stoicheion_version_immutable BEFORE UPDATE ON e2ee_objects
WHEN OLD.domain='stoicheion' AND OLD.object_id GLOB 'stoicheion-live:*'
BEGIN SELECT RAISE(ABORT,'E2EE_STOICHEION_IMMUTABLE'); END;
