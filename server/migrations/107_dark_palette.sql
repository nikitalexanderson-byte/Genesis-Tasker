-- Additive account preference; existing accounts retain the green palette.
ALTER TABLE users ADD COLUMN dark_palette TEXT NOT NULL DEFAULT 'green';
