-- Extend existing Google rows, retaining their IDs, integration credentials and owner.
ALTER TABLE users ADD COLUMN google_login_active INTEGER NOT NULL DEFAULT 1 CHECK(google_login_active IN (0,1));
ALTER TABLE users ADD COLUMN primary_google_identity_id TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN security_epoch INTEGER NOT NULL DEFAULT 0 CHECK(security_epoch >= 0);
ALTER TABLE linked_google_accounts ADD COLUMN login_active INTEGER NOT NULL DEFAULT 1 CHECK(login_active IN (0,1));
UPDATE users SET primary_google_identity_id=id;
CREATE TRIGGER google_initial_primary AFTER INSERT ON users WHEN NEW.primary_google_identity_id=''
BEGIN UPDATE users SET primary_google_identity_id=NEW.id WHERE id=NEW.id; END;
CREATE TRIGGER google_primary_owned BEFORE UPDATE OF primary_google_identity_id ON users
WHEN NOT (NEW.primary_google_identity_id=NEW.id AND NEW.google_login_active=1)
 AND NOT EXISTS(SELECT 1 FROM linked_google_accounts WHERE id=NEW.primary_google_identity_id AND owner_user_id=NEW.id AND login_active=1)
BEGIN SELECT RAISE(ABORT,'GOOGLE_PRIMARY_INVALID'); END;
CREATE TRIGGER google_link_cross_owner_insert BEFORE INSERT ON linked_google_accounts
WHEN EXISTS(SELECT 1 FROM users WHERE google_sub=NEW.google_sub)
BEGIN SELECT RAISE(ABORT,'GOOGLE_IDENTITY_OWNED'); END;
CREATE TRIGGER google_link_cross_owner_update BEFORE UPDATE OF google_sub,owner_user_id ON linked_google_accounts
WHEN EXISTS(SELECT 1 FROM users WHERE google_sub=NEW.google_sub)
BEGIN SELECT RAISE(ABORT,'GOOGLE_IDENTITY_OWNED'); END;
CREATE TRIGGER google_user_cross_owner_insert BEFORE INSERT ON users
WHEN EXISTS(SELECT 1 FROM linked_google_accounts WHERE google_sub=NEW.google_sub)
BEGIN SELECT RAISE(ABORT,'GOOGLE_IDENTITY_OWNED'); END;
CREATE TRIGGER google_user_cross_owner_update BEFORE UPDATE OF google_sub ON users
WHEN EXISTS(SELECT 1 FROM linked_google_accounts WHERE google_sub=NEW.google_sub)
BEGIN SELECT RAISE(ABORT,'GOOGLE_IDENTITY_OWNED'); END;
CREATE TRIGGER google_link_primary_active BEFORE UPDATE OF login_active ON linked_google_accounts
WHEN NEW.login_active=0 AND EXISTS(SELECT 1 FROM users WHERE primary_google_identity_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'GOOGLE_PRIMARY_INVALID'); END;
CREATE TRIGGER google_user_primary_active BEFORE UPDATE OF google_login_active ON users
WHEN NEW.google_login_active=0 AND NEW.primary_google_identity_id=NEW.id
BEGIN SELECT RAISE(ABORT,'GOOGLE_PRIMARY_INVALID'); END;
CREATE TRIGGER google_link_primary_delete BEFORE DELETE ON linked_google_accounts
WHEN EXISTS(SELECT 1 FROM users WHERE primary_google_identity_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'GOOGLE_PRIMARY_INVALID'); END;
CREATE TABLE google_security_events (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, actor_identity_id TEXT NOT NULL, target_identity_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE account_recovery_codes (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL,
 security_epoch INTEGER NOT NULL, used_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE account_recovery_requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 candidate_sub TEXT NOT NULL, candidate_email TEXT NOT NULL, security_epoch INTEGER NOT NULL,
 proof_kind TEXT NOT NULL CHECK(proof_kind IN ('code','manual')), proof_hash TEXT,
 state TEXT NOT NULL CHECK(state IN ('pending','approved','rejected','completed','invalidated')),
 reviewer_id TEXT, reason TEXT NOT NULL DEFAULT '', expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX recovery_requests_owner ON account_recovery_requests(user_id,state);
CREATE TABLE account_security_outbox (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, payload_enc TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0
);
