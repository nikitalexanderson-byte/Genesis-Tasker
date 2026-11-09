-- Prepared only: no payment status is inferred and no existing plan is changed.
-- NULL is not proof of an active paid subscription. Premium4Life has no expiry.
ALTER TABLE users ADD COLUMN subscription_valid_until TEXT DEFAULT NULL;
