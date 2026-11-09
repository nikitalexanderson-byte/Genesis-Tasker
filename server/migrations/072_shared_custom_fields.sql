-- Definitions and values are additive. Archiving never removes historical values.
CREATE TABLE shared_custom_fields (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES shared_projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('text','number','date','select','multi','checkbox','url')),
    definition_json TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    required INTEGER NOT NULL DEFAULT 0 CHECK(required IN (0,1)),
    show_card INTEGER NOT NULL DEFAULT 1 CHECK(show_card IN (0,1)),
    show_list INTEGER NOT NULL DEFAULT 0 CHECK(show_list IN (0,1)),
    archived_at TEXT,
    predecessor_id TEXT REFERENCES shared_custom_fields(id) ON DELETE SET NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX shared_custom_fields_scope ON shared_custom_fields(space_id,project_id,position,id);
CREATE TABLE shared_custom_field_values (
    task_id TEXT NOT NULL REFERENCES shared_tasks(id) ON DELETE CASCADE,
    field_id TEXT NOT NULL REFERENCES shared_custom_fields(id) ON DELETE CASCADE,
    value_json TEXT NOT NULL,
    PRIMARY KEY(task_id,field_id)
);
CREATE INDEX shared_custom_field_values_field ON shared_custom_field_values(field_id,task_id);
CREATE TABLE shared_custom_field_versions (
    field_id TEXT NOT NULL REFERENCES shared_custom_fields(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    definition_json TEXT NOT NULL,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(field_id,revision)
);
CREATE TABLE shared_custom_field_receipts (
    actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    space_id TEXT NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
    payload_hash TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    PRIMARY KEY(actor_id,operation_id)
);
