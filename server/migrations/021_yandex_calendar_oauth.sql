ALTER TABLE yandex_calendar_connections ADD COLUMN access_token_enc TEXT;
ALTER TABLE yandex_calendar_connections ADD COLUMN refresh_token_enc TEXT;
ALTER TABLE yandex_calendar_connections ADD COLUMN token_expires_at INTEGER;
