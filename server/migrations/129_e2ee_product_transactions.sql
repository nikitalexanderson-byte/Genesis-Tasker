-- Only technical object identities and authorization metadata. Names, bodies,
-- filenames, previews, schedules and rule content remain client ciphertext.
CREATE TABLE e2ee_product_entities (
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 generation INTEGER NOT NULL,
 entity_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 revision INTEGER NOT NULL,
 domain TEXT NOT NULL,
 object_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 parent_id TEXT,
 author_id TEXT NOT NULL,
 deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
 metadata_json TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(scope_id,generation,entity_id)
);
CREATE TABLE e2ee_product_history (
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 generation INTEGER NOT NULL,
 entity_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 object_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 metadata_json TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 signed_command TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(scope_id,generation,entity_id,revision)
);
CREATE TABLE e2ee_product_proposals (
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 generation INTEGER NOT NULL,
 proposal_id TEXT NOT NULL,
 entity_id TEXT NOT NULL,
 base_revision INTEGER NOT NULL,
 object_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 metadata_json TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 signed_command TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(scope_id,generation,proposal_id)
);
CREATE TABLE e2ee_product_attestations (
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 generation INTEGER NOT NULL,
 proposal_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 signed_command TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(scope_id,generation,proposal_id,user_id)
);
CREATE TABLE e2ee_service_intents (
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL,
 action TEXT NOT NULL,
 intent_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 result_json TEXT NOT NULL,
 PRIMARY KEY(scope_id,actor_id,action,intent_id)
);
CREATE TRIGGER e2ee_product_version_immutable BEFORE UPDATE ON e2ee_objects
WHEN OLD.object_id GLOB 'product-version:*'
BEGIN SELECT RAISE(ABORT,'E2EE_PRODUCT_VERSION_IMMUTABLE'); END;
