-- The following bootstrap step encrypts existing task/comment/activity content atomically.
-- Original columns, relations, IDs and API response formats remain compatible.
CREATE TABLE shared_content_storage (
    version INTEGER PRIMARY KEY,
    initialized_at TEXT NOT NULL
);
