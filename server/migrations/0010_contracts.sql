-- Signed contracts and agreements (with clients or anyone else); files live in data/contracts/.
CREATE TABLE contracts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'contract',  -- contract | agreement
  client_id    INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  counterparty TEXT,                              -- other party when it isn't a CRM client (vendor, partner…)
  signed_on    TEXT,                              -- YYYY-MM-DD
  ends_on      TEXT,                              -- YYYY-MM-DD, empty = no end date
  notes        TEXT,
  file_path    TEXT,
  file_name    TEXT,
  file_type    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT
);
CREATE INDEX idx_contracts_client ON contracts(client_id);
