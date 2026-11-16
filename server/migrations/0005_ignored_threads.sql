-- Chats the owner ignored from the Inbox (bots, spam, providers): hidden and never stored again.
CREATE TABLE ignored_threads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_key  TEXT NOT NULL UNIQUE,           -- WA: phone digits; email: address (same as messages.thread_key)
  channel     TEXT,
  label       TEXT,                           -- sender name when ignored, to recognise it later
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
