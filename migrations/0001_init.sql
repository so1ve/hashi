CREATE TABLE users (
  chat_id INTEGER PRIMARY KEY,
  topic_id INTEGER UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  username TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  verification_message_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE message_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  private_chat_id INTEGER NOT NULL,
  private_message_id INTEGER NOT NULL,
  group_message_id INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  created_at INTEGER NOT NULL,
  UNIQUE (private_chat_id, private_message_id),
  UNIQUE (topic_id, group_message_id)
);

CREATE INDEX idx_message_links_chat_created
  ON message_links (private_chat_id, created_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE pending_edits (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  topic_id INTEGER NOT NULL DEFAULT 0,
  setting_key TEXT NOT NULL,
  prompt_message_id INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id, topic_id)
);
