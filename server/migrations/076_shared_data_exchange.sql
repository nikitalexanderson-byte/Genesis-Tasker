-- Portable import receipts and preserved historical metadata; existing rows stay unchanged.
CREATE TABLE shared_data_imports (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    destination_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active' CHECK(state IN('active','undone','removed')),
    receipt_json TEXT NOT NULL,
    baseline_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    undone_at TEXT,
    UNIQUE(actor_id,operation_id)
);
CREATE UNIQUE INDEX shared_data_import_active ON shared_data_imports(space_id,destination_key,source_hash) WHERE state='active';
CREATE TABLE shared_data_import_records (
    import_id TEXT NOT NULL REFERENCES shared_data_imports(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    source_key TEXT NOT NULL,
    target_id TEXT,
    project_id TEXT REFERENCES shared_projects(id) ON DELETE CASCADE,
    initial_revision INTEGER,
    payload_json TEXT NOT NULL,
    PRIMARY KEY(import_id,kind,source_key)
);
CREATE INDEX shared_data_import_record_target ON shared_data_import_records(project_id,kind,target_id);
