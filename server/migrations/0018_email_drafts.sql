-- Emails the owner orders from the chat/WhatsApp: request → draft (here) → the owner approves → send through Microsoft 365.
CREATE TABLE email_drafts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  to_address    TEXT,                                -- null = the client's email
  subject       TEXT,
  body          TEXT NOT NULL,
  document_ids  TEXT,                                -- JSON array of documents attached as PDF
  as_reply      INTEGER NOT NULL DEFAULT 1,          -- reply in the client's last email thread if there is one
  status        TEXT NOT NULL DEFAULT 'draft',       -- draft | sent | discarded
  error         TEXT,
  sent_at       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
