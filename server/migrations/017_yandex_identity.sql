ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'google';
ALTER TABLE users ADD COLUMN yandex_uid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_yandex_uid_unique
    ON users(yandex_uid) WHERE yandex_uid IS NOT NULL;
