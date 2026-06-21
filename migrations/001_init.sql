PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  is_banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  username_text TEXT NOT NULL,
  code_word_entered TEXT NOT NULL,
  code_word_valid INTEGER NOT NULL,
  about_text TEXT NOT NULL,
  life_channel_subscribed INTEGER NOT NULL,
  info_channel_subscribed INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'joined')),
  reviewed_by_admin_id INTEGER,
  reject_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

CREATE TABLE IF NOT EXISTS invite_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  invite_link TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'used', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_invite_links_status ON invite_links(status);
CREATE INDEX IF NOT EXISTS idx_invite_links_user_id ON invite_links(user_id);

CREATE TABLE IF NOT EXISTS join_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id),
  user_id INTEGER REFERENCES users(id),
  invite_link_id INTEGER REFERENCES invite_links(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by_admin_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_join_requests_status ON join_requests(status);
CREATE INDEX IF NOT EXISTS idx_join_requests_user_id ON join_requests(user_id);

CREATE TABLE IF NOT EXISTS admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target_user_id INTEGER,
  application_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role_name TEXT NOT NULL,
  username_text TEXT NOT NULL,
  reserve_until TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'used')),
  reviewed_by_admin_id INTEGER,
  reject_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_role_reservations_user_id ON role_reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_role_reservations_status ON role_reservations(status);

CREATE TABLE IF NOT EXISTS user_states (
  telegram_id INTEGER PRIMARY KEY,
  flow TEXT NOT NULL,
  step TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
