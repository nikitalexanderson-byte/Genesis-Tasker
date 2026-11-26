-- Freezing this manifest still grants no ACL, key or product authority.
CREATE TABLE e2ee_membership_atomic_packet_manifests (
 actor_id TEXT NOT NULL,
 intent_id TEXT NOT NULL,
 plan_hash TEXT NOT NULL,
 batch_hash TEXT NOT NULL,
 manifest_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(actor_id,intent_id),
 FOREIGN KEY(actor_id,intent_id) REFERENCES e2ee_membership_atomic_plans(actor_id,intent_id) ON DELETE CASCADE
);
CREATE TRIGGER e2ee_membership_packet_manifest_immutable BEFORE UPDATE ON e2ee_membership_atomic_packet_manifests
BEGIN SELECT RAISE(ABORT,'E2EE_MEMBERSHIP_PAGE_IMMUTABLE'); END;
CREATE TRIGGER e2ee_membership_sealed_pages BEFORE INSERT ON e2ee_membership_atomic_pages
WHEN EXISTS(SELECT 1 FROM e2ee_membership_atomic_packet_manifests m WHERE m.actor_id=NEW.actor_id AND m.intent_id=NEW.intent_id)
BEGIN SELECT RAISE(ABORT,'E2EE_MEMBERSHIP_PLAN_LOCKED'); END;
