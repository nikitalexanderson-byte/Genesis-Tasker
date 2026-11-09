-- Additive. Keep collection choices out of legacy advice_preferences_json so code rollback can read it.
ALTER TABLE users ADD COLUMN advice_collections_json TEXT NOT NULL DEFAULT '["aurora"]';
