-- An explicit cancellation is permanent for this attempt, not a lease timeout.
-- Shadow objects and original command receipts are retained.
CREATE TABLE e2ee_migration_cancellations (
 scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 migration_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 source_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(scope_id,migration_id)
);
INSERT INTO e2ee_migration_cancellations
 SELECT m.scope_id,m.migration_id,m.device_id,m.source_hash,strftime('%Y-%m-%dT%H:%M:%SZ','now')
 FROM e2ee_migrations m JOIN e2ee_scopes s ON s.scope_id=m.scope_id
 WHERE m.lease_until=0 AND s.state='preparing';
CREATE TRIGGER e2ee_cancelled_attempt_insert BEFORE INSERT ON e2ee_migrations
WHEN NEW.lease_until>0 AND EXISTS(SELECT 1 FROM e2ee_migration_cancellations c
 WHERE c.scope_id=NEW.scope_id AND c.migration_id=NEW.migration_id)
BEGIN SELECT RAISE(ABORT,'E2EE_MIGRATION_CANCELLED'); END;
CREATE TRIGGER e2ee_cancelled_attempt_update BEFORE UPDATE ON e2ee_migrations
WHEN NEW.lease_until>0 AND EXISTS(SELECT 1 FROM e2ee_migration_cancellations c
 WHERE c.scope_id=NEW.scope_id AND c.migration_id=NEW.migration_id)
BEGIN SELECT RAISE(ABORT,'E2EE_MIGRATION_CANCELLED'); END;
