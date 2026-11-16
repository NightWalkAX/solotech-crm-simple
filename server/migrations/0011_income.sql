-- Income that doesn't come from a CRM receipt (e.g. USDT payments, external receipt books).
-- Counted in Finanzas together with the receipts; never generates a document number.
CREATE TABLE income (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  received_on TEXT NOT NULL,                      -- YYYY-MM-DD
  payer       TEXT,
  description TEXT NOT NULL,
  amount      REAL NOT NULL,                      -- in `currency`
  currency    TEXT NOT NULL DEFAULT 'GYD',
  fx_rate     REAL,                               -- GYD per unit at the moment it was recorded (1 for GYD)
  amount_gyd  INTEGER NOT NULL,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_income_date ON income(received_on);
