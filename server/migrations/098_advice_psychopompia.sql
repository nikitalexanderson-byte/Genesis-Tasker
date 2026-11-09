-- Additive account consent. Keep the strict legacy advice_preferences_json and selection_json unchanged.
-- Runtime SQLite backup precedes migration through the existing application/deploy path.
-- Code rollback ignores this column; do not automatically roll back the database.
ALTER TABLE users ADD COLUMN advice_psychopompia_json TEXT NOT NULL DEFAULT '{}';
