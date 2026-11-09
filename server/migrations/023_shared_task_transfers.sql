-- A private task is disclosed only after the owner explicitly previews and transfers it.
-- Keep the mapping when a shared task is later deleted so retries cannot publish it again.
CREATE TABLE shared_task_transfers (
    source_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_task_id TEXT NOT NULL,
    target_project_id TEXT NOT NULL,
    target_task_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_user_id, source_task_id)
);
CREATE INDEX shared_task_transfers_target_idx ON shared_task_transfers(target_project_id, target_task_id);
