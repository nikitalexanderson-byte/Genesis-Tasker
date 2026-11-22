-- Recipient consent is technical routing only. This table grants no ACL/key.
CREATE TABLE IF NOT EXISTS e2ee_invitation_responses (
    invitation_id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES e2ee_scopes(scope_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK(state IN ('pending','declined','admitted')),
    accepted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS e2ee_invitation_responses_scope ON e2ee_invitation_responses(scope_id,state,invitation_id);
CREATE INDEX IF NOT EXISTS e2ee_invitation_responses_user ON e2ee_invitation_responses(user_id,state,invitation_id);
