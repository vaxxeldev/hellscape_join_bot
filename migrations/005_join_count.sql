ALTER TABLE users ADD COLUMN bot_join_count INTEGER NOT NULL DEFAULT 0;

UPDATE users SET bot_join_count = (
  SELECT COUNT(*) FROM applications a
  WHERE a.user_id = users.id AND a.status = 'joined'
);
