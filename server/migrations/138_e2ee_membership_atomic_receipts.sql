ALTER TABLE e2ee_membership_atomic_plans ADD COLUMN commit_hash TEXT;
CREATE TABLE e2ee_membership_atomic_receipt_pages (
 actor_id TEXT NOT NULL,
 intent_id TEXT NOT NULL,
 page_index INTEGER NOT NULL CHECK(page_index>=0 AND page_index<10000),
 kind TEXT NOT NULL CHECK(kind IN ('scopes','products')),
 item_count INTEGER NOT NULL CHECK(item_count>=1 AND item_count<=200),
 page_hash TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 PRIMARY KEY(actor_id,intent_id,page_index),
 FOREIGN KEY(actor_id,intent_id) REFERENCES e2ee_membership_atomic_plans(actor_id,intent_id) ON DELETE CASCADE
);
CREATE TRIGGER e2ee_membership_atomic_receipt_immutable BEFORE UPDATE ON e2ee_membership_atomic_receipt_pages
BEGIN SELECT RAISE(ABORT,'E2EE_MEMBERSHIP_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER e2ee_membership_atomic_commit_immutable BEFORE UPDATE ON e2ee_membership_atomic_plans
WHEN (OLD.commit_hash IS NOT NULL OR OLD.state<>'staged') AND NEW.commit_hash IS NOT OLD.commit_hash
BEGIN SELECT RAISE(ABORT,'E2EE_MEMBERSHIP_PLAN_IMMUTABLE'); END;
