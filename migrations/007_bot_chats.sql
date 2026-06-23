CREATE TABLE IF NOT EXISTS bot_chats (
  chat_id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT,
  username TEXT,
  status TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bot_chats_status ON bot_chats(status);
CREATE INDEX IF NOT EXISTS idx_bot_chats_type ON bot_chats(type);
