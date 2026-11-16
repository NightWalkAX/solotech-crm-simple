-- Debts both ways: money owed to the owner (receivable) and money the owner owes (payable), personal or business.
-- Kept outside Finanzas income/OpEx: lending or repaying money is not revenue or spend.
CREATE TABLE debts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  direction    TEXT NOT NULL,                     -- receivable (me deben) | payable (yo debo)
  client_id    INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  counterparty TEXT,                              -- who, when it isn't a CRM client
  description  TEXT NOT NULL,
  amount       REAL NOT NULL,                     -- original principal, in `currency`
  currency     TEXT NOT NULL DEFAULT 'GYD',
  started_on   TEXT,                              -- YYYY-MM-DD
  due_date     TEXT,                              -- YYYY-MM-DD, empty = no date
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT
);
CREATE INDEX idx_debts_client ON debts(client_id);

-- Partial payments; the balance is amount - sum(payments). A debt with payments can't be deleted.
CREATE TABLE debt_payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id    INTEGER NOT NULL REFERENCES debts(id),
  paid_on    TEXT NOT NULL,                       -- YYYY-MM-DD
  amount     REAL NOT NULL,                       -- in the debt's currency
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_debt_payments_debt ON debt_payments(debt_id);
