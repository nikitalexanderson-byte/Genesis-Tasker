-- Additive operation snapshots. Roll back code without dropping stored results or tasks.
CREATE TABLE shared_bulk_operations (
 id TEXT PRIMARY KEY,
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 payload TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'preview' CHECK(state IN ('preview','running','done','cancelled','failed')),
 error_code TEXT,
 batch_number INTEGER NOT NULL DEFAULT 0,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(actor_id,request_id)
);
CREATE INDEX shared_bulk_actor ON shared_bulk_operations(actor_id,created_at);
CREATE TABLE shared_bulk_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 operation_id TEXT NOT NULL REFERENCES shared_bulk_operations(id) ON DELETE CASCADE,
 task_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 root_id TEXT NOT NULL,
 expected_revision INTEGER NOT NULL,
 expected_parent_id TEXT,
 depth INTEGER NOT NULL DEFAULT 0,
 selected INTEGER NOT NULL CHECK(selected IN (0,1)),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','succeeded','skipped','failed','cancelled')),
 error_code TEXT,
 UNIQUE(operation_id,task_id)
);
CREATE INDEX shared_bulk_pending ON shared_bulk_items(operation_id,state,root_id,depth,id);
CREATE INDEX shared_bulk_report ON shared_bulk_items(operation_id,id);
CREATE INDEX shared_bulk_branch ON shared_bulk_items(operation_id,root_id,task_id);
