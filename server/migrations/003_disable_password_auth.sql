UPDATE users
SET password_hash = NULL,
    password_set_at = NULL
WHERE password_hash IS NOT NULL OR password_set_at IS NOT NULL;
