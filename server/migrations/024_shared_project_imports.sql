-- A complete private project tree is published atomically. The client keeps its
-- encrypted original until it verifies this receipt and finishes local cleanup.
CREATE TABLE shared_project_imports (
    source_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transfer_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    root_project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
    receipt_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_user_id, transfer_id)
);
CREATE INDEX shared_project_imports_root_idx ON shared_project_imports(root_project_id);
