-- Existing accounts keep their calendar choice and receive no retrospective tip.
ALTER TABLE users ADD COLUMN calendar_exploration_pending INTEGER NOT NULL DEFAULT 0
    CHECK (calendar_exploration_pending IN (0, 1));
