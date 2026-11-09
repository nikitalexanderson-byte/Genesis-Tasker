ALTER TABLE users ADD COLUMN subscription_plan TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_plan IN ('free', 'standart', 'premium', 'business', 'premium4life'));
