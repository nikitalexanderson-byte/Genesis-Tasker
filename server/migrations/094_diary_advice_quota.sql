-- Server-verified references, separate from encrypted personal diary content.
CREATE TABLE personal_diary_advice_references (
    user_id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    advice_id TEXT NOT NULL,
    PRIMARY KEY(user_id,note_id),
    UNIQUE(user_id,advice_id),
    FOREIGN KEY(user_id,note_id) REFERENCES personal_diary_notes(user_id,id) ON DELETE CASCADE
);
