-- Prospective only: never backfill historical users or registrations.
CREATE TABLE email_registration_lifecycle (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 email TEXT NOT NULL, enrolled_at TEXT NOT NULL, deadline_at TEXT NOT NULL
);
CREATE INDEX email_registration_deadlines ON email_registration_lifecycle(deadline_at);
CREATE TABLE email_verification_dismissals (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 dismissed_until TEXT NOT NULL
);
