-- Existing conversations retain their previous access. New pairs require recipient consent.
CREATE TABLE shared_private_conversation_invitations (
    conversation_id TEXT PRIMARY KEY REFERENCES shared_private_conversations(id) ON DELETE CASCADE,
    initiator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TEXT NOT NULL,
    responded_at TEXT
);
CREATE INDEX shared_private_conversation_invitations_pending
    ON shared_private_conversation_invitations(status, created_at);
