ALTER TABLE users
ADD COLUMN stoicheion_divination_disabled INTEGER NOT NULL DEFAULT 0
CHECK (stoicheion_divination_disabled IN (0, 1));
