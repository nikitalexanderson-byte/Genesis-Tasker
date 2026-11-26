-- Additive, inactive until an explicitly authorized client migrates a scope.
-- No legacy keys/data are deleted. Crypto and writer/data generations are independent.
CREATE TABLE e2ee_scopes (
 scope_id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('personal','project','space')),
 resource_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('preparing','uploading','verified','active','retirement')),
 directory_revision INTEGER NOT NULL CHECK(directory_revision > 0),
 crypto_epoch INTEGER NOT NULL CHECK(crypto_epoch > 0),
 security_epoch INTEGER NOT NULL CHECK(security_epoch > 0),
 key_id TEXT NOT NULL,
 generation INTEGER NOT NULL CHECK(generation > 0),
 recovery_signing_key TEXT NOT NULL,
 recovery_receiving_key TEXT NOT NULL,
 recovery_kit TEXT NOT NULL,
 recovery_capsule TEXT NOT NULL,
 checkpoint_hash TEXT NOT NULL,
 seal_count INTEGER NOT NULL DEFAULT 0 CHECK(seal_count >= 0 AND seal_count <= 4294967296),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(kind, resource_id)
);
CREATE INDEX e2ee_scopes_owner ON e2ee_scopes(owner_id);
CREATE TABLE e2ee_devices (
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 device_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('owner','writer','commenter','reader')),
 signing_key TEXT NOT NULL,
 receiving_key TEXT NOT NULL,
 root_capsule TEXT NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
 enrolled_at TEXT NOT NULL,
 PRIMARY KEY(scope_id,device_id)
);
CREATE TABLE e2ee_challenges (
 id TEXT PRIMARY KEY,
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('owner','writer','commenter','reader')),
 session_hash TEXT NOT NULL,
 device_id TEXT NOT NULL,
 signing_key TEXT NOT NULL,
 receiving_key TEXT NOT NULL,
 nonce TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1))
);
CREATE INDEX e2ee_challenges_scope ON e2ee_challenges(scope_id,expires_at);
CREATE TABLE e2ee_events (
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 revision INTEGER NOT NULL,
 previous_hash TEXT NOT NULL,
 event_hash TEXT NOT NULL,
 signed_command TEXT NOT NULL,
 PRIMARY KEY(scope_id,revision)
);
CREATE TABLE e2ee_objects (
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 generation INTEGER NOT NULL,
 domain TEXT NOT NULL,
 object_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 envelope TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 PRIMARY KEY(scope_id,generation,domain,object_id)
);
CREATE TABLE e2ee_receipts (
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 operation_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 result TEXT NOT NULL,
 PRIMARY KEY(scope_id,operation_id)
);
CREATE TABLE e2ee_retired_manifests (
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 crypto_epoch INTEGER NOT NULL,
 generation INTEGER NOT NULL,
 manifest_hash TEXT NOT NULL,
 objects_json TEXT NOT NULL,
 PRIMARY KEY(scope_id,crypto_epoch)
);
CREATE TABLE e2ee_migrations (
 scope_id TEXT PRIMARY KEY REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 migration_id TEXT NOT NULL UNIQUE,
 device_id TEXT NOT NULL,
 source_hash TEXT NOT NULL,
 target_generation INTEGER NOT NULL,
 fence INTEGER NOT NULL,
 lease_until INTEGER NOT NULL,
 manifest_hash TEXT,
 verified_checkpoint TEXT
);
-- An active scope is monotone even if an older backend tries to write/reset it.
CREATE TRIGGER e2ee_no_downgrade BEFORE UPDATE ON e2ee_scopes
WHEN OLD.state IN ('active','retirement') AND (NEW.state NOT IN ('active','retirement')
 OR NEW.crypto_epoch < OLD.crypto_epoch OR NEW.security_epoch < OLD.security_epoch
 OR NEW.generation < OLD.generation OR NEW.directory_revision < OLD.directory_revision)
BEGIN SELECT RAISE(ABORT,'E2EE_DOWNGRADE_FORBIDDEN'); END;
