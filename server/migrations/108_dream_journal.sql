-- Plaintext scheduling metadata only; title and dream text remain encrypted.
CREATE TABLE personal_diary_dreams (
    user_id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    dream_day TEXT NOT NULL,
    time_zone TEXT NOT NULL,
    PRIMARY KEY(user_id, note_id),
    FOREIGN KEY(user_id, note_id) REFERENCES personal_diary_notes(user_id, id) ON DELETE CASCADE
);
