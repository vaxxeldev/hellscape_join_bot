ALTER TABLE role_reservations ADD COLUMN reservation_kind TEXT NOT NULL DEFAULT 'scheduled' CHECK (reservation_kind IN ('scheduled', 'waitlist'));
ALTER TABLE role_reservations ADD COLUMN waitlist_notified_at TEXT;

CREATE INDEX IF NOT EXISTS idx_role_reservations_kind_status ON role_reservations(reservation_kind, status);
CREATE INDEX IF NOT EXISTS idx_role_reservations_waitlist_queue ON role_reservations(reservation_kind, status, waitlist_notified_at, created_at);
