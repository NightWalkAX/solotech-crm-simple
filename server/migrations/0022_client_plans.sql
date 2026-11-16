-- Recurring income from clients (maintenance, hosting, support plans). Each cycle is billed with a normal invoice
-- (documents.plan_id points back to the plan); income still counts only when the receipt lands.
CREATE TABLE client_plans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,                        -- shown on the invoice line (English), e.g. "Website maintenance"
  amount     REAL NOT NULL DEFAULT 0,              -- per cycle, in `currency`
  currency   TEXT NOT NULL DEFAULT 'GYD',
  cycle      TEXT NOT NULL DEFAULT 'monthly',      -- monthly | quarterly | yearly
  started_on TEXT,                                 -- YYYY-MM-DD
  next_due   TEXT,                                 -- YYYY-MM-DD: start of the next cycle to bill
  active     INTEGER NOT NULL DEFAULT 1,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_client_plans_client ON client_plans(client_id);

ALTER TABLE documents ADD COLUMN plan_id INTEGER REFERENCES client_plans(id) ON DELETE SET NULL;
