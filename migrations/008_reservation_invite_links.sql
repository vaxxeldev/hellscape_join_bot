ALTER TABLE join_requests RENAME TO join_requests_legacy;
ALTER TABLE invite_links RENAME TO invite_links_legacy;

CREATE TABLE invite_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id),
  reservation_id INTEGER REFERENCES role_reservations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  invite_link TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'pending', 'used', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at TEXT,
  revoked_at TEXT,
  CHECK ((application_id IS NOT NULL) <> (reservation_id IS NOT NULL))
);

INSERT INTO invite_links (
  id, application_id, reservation_id, user_id, invite_link, status,
  expires_at, created_at, used_at, revoked_at
)
SELECT
  id, application_id, NULL, user_id, invite_link, status,
  expires_at, created_at, used_at, revoked_at
FROM invite_links_legacy;

-- Keep only the newest active application link if an old concurrent approval
-- managed to create duplicates before this constraint existed.
UPDATE invite_links
SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
WHERE status IN ('active', 'pending')
  AND application_id IS NOT NULL
  AND id NOT IN (
    SELECT MAX(id)
    FROM invite_links
    WHERE status IN ('active', 'pending') AND application_id IS NOT NULL
    GROUP BY application_id
  );

CREATE TABLE join_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id),
  reservation_id INTEGER REFERENCES role_reservations(id),
  user_id INTEGER REFERENCES users(id),
  invite_link_id INTEGER REFERENCES invite_links(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by_admin_id INTEGER,
  CHECK ((application_id IS NOT NULL) <> (reservation_id IS NOT NULL))
);

INSERT INTO join_requests (
  id, application_id, reservation_id, user_id, invite_link_id, status,
  created_at, reviewed_at, reviewed_by_admin_id
)
SELECT
  id, application_id, NULL, user_id, invite_link_id, status,
  created_at, reviewed_at, reviewed_by_admin_id
FROM join_requests_legacy;

DROP TABLE join_requests_legacy;
DROP TABLE invite_links_legacy;

CREATE INDEX idx_invite_links_status ON invite_links(status);
CREATE INDEX idx_invite_links_user_id ON invite_links(user_id);
CREATE INDEX idx_invite_links_reservation_id ON invite_links(reservation_id);
CREATE UNIQUE INDEX idx_invite_links_active_application
  ON invite_links(application_id)
  WHERE status IN ('active', 'pending') AND application_id IS NOT NULL;
CREATE UNIQUE INDEX idx_invite_links_active_reservation
  ON invite_links(reservation_id)
  WHERE status IN ('active', 'pending') AND reservation_id IS NOT NULL;

CREATE INDEX idx_join_requests_status ON join_requests(status);
CREATE INDEX idx_join_requests_user_id ON join_requests(user_id);
CREATE INDEX idx_join_requests_reservation_id ON join_requests(reservation_id);
