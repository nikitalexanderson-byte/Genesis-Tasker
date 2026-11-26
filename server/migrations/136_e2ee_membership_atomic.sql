-- Immutable staged pages keep wide ACL/product changes inside one final writer.
-- Staging grants no access and does not execute the uploaded commands.
CREATE TABLE e2ee_membership_atomic_plans (
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 intent_id TEXT NOT NULL,
 personal_scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 plan_hash TEXT NOT NULL,
 manifest_json TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'staged' CHECK(state IN ('staged','committed','cancelled')),
 batch_hash TEXT,
 result_json TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(actor_id,intent_id)
);
CREATE TABLE e2ee_membership_atomic_pages (
 actor_id TEXT NOT NULL,
 intent_id TEXT NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('plan','packets')),
 page_index INTEGER NOT NULL CHECK(page_index>=0 AND page_index<10000),
 kind TEXT NOT NULL,
 item_count INTEGER NOT NULL CHECK(item_count>=1 AND item_count<=200),
 page_hash TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(actor_id,intent_id,phase,page_index),
 FOREIGN KEY(actor_id,intent_id) REFERENCES e2ee_membership_atomic_plans(actor_id,intent_id) ON DELETE CASCADE
);
CREATE TABLE e2ee_membership_atomic_cancellations (
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 intent_id TEXT NOT NULL,
 plan_hash TEXT NOT NULL,
 personal_scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
 device_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(actor_id,intent_id)
);
CREATE TRIGGER e2ee_membership_atomic_page_immutable BEFORE UPDATE ON e2ee_membership_atomic_pages
BEGIN SELECT RAISE(ABORT,'E2EE_MEMBERSHIP_PAGE_IMMUTABLE'); END;
CREATE TRIGGER e2ee_membership_atomic_plan_immutable BEFORE UPDATE ON e2ee_membership_atomic_plans
WHEN NEW.actor_id<>OLD.actor_id OR NEW.intent_id<>OLD.intent_id OR NEW.personal_scope_id<>OLD.personal_scope_id
 OR NEW.plan_hash<>OLD.plan_hash OR NEW.manifest_json<>OLD.manifest_json
 OR (OLD.state<>'staged' AND (NEW.state<>OLD.state OR NEW.batch_hash IS NOT OLD.batch_hash OR NEW.result_json IS NOT OLD.result_json))
BEGIN SELECT RAISE(ABORT,'E2EE_MEMBERSHIP_PLAN_IMMUTABLE'); END;
CREATE TRIGGER e2ee_membership_atomic_cancel_immutable BEFORE UPDATE ON e2ee_membership_atomic_cancellations
BEGIN SELECT RAISE(ABORT,'E2EE_MEMBERSHIP_CANCELLED'); END;
