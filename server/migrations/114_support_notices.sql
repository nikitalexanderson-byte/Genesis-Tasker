CREATE TABLE support_notices (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 surface TEXT NOT NULL CHECK(surface IN ('web','android','phone')),
 shown_at TEXT NOT NULL,
 next_at TEXT NOT NULL,
 PRIMARY KEY(user_id,surface)
);
