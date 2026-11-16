-- Real conversations (WhatsApp, email). `interactions` stays for notes/calls/meetings and summaries.
CREATE TABLE messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,   -- NULL = not matched to a client yet
  channel     TEXT NOT NULL,                  -- whatsapp | email
  direction   TEXT NOT NULL,                  -- in | out
  external_id TEXT UNIQUE,                    -- provider id (WA message id, Graph id) or import hash
  thread_key  TEXT NOT NULL,                  -- WA: phone digits; email: counterpart address
  sender      TEXT,
  subject     TEXT,
  body        TEXT NOT NULL DEFAULT '',
  sent_at     TEXT NOT NULL,                  -- UTC 'YYYY-MM-DD HH:MM:SS'
  status      TEXT NOT NULL DEFAULT 'received', -- received | sent | sent_manual | failed | imported
  source      TEXT NOT NULL DEFAULT 'manual', -- manual | export | whatsapp_api | graph
  read_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_client ON messages(client_id, sent_at);
CREATE INDEX idx_messages_thread ON messages(thread_key, sent_at);

-- AI reply options, cached per (client, channel, last inbound message) so they are generated once.
CREATE TABLE reply_suggestions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  for_message_id  INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  options         TEXT NOT NULL,              -- JSON [{label, text, subject?}]
  instructions    TEXT,                       -- extra guidance the owner gave when generating
  used_index      INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_suggestions_key ON reply_suggestions(client_id, channel, for_message_id);
