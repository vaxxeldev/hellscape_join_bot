ALTER TABLE role_reservations ADD COLUMN code_word_entered TEXT NOT NULL DEFAULT '';
ALTER TABLE role_reservations ADD COLUMN code_word_valid INTEGER NOT NULL DEFAULT 0;
