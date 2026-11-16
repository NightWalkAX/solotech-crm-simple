-- Notas: knowledge the owner dictates (chat or WhatsApp) that isn't a client field or a task: business ideas, information,
-- methodology for a client, references. client_id set = it belongs to that client (shown on the client's page).
CREATE TABLE notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL DEFAULT 'info',          -- idea | info | methodology | reference
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  tags        TEXT,                                  -- comma separated
  source      TEXT NOT NULL DEFAULT 'ui',            -- ui | chat | whatsapp
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX notes_client ON notes(client_id);
