CREATE TABLE chats (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,                               -- Claude Code session to --resume
  title      TEXT NOT NULL DEFAULT 'Nueva conversación',
  client_id  INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,                      -- user | assistant
  text       TEXT NOT NULL DEFAULT '',
  tools      TEXT NOT NULL DEFAULT '[]',         -- JSON [{name, input}]
  audit_ids  TEXT NOT NULL DEFAULT '[]',         -- JSON: audit_log rows written during this turn (undo)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_chat_messages_chat ON chat_messages(chat_id, id);
