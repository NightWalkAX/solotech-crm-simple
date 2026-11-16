-- Plans billed outside the CRM (e.g. through Remote or Deel): no INV number; the cycle is tracked here until paid,
-- and the payment lands in `income` (income_id) so Finanzas counts it once.
ALTER TABLE client_plans ADD COLUMN billing TEXT NOT NULL DEFAULT 'crm';   -- crm | external (default choice on Facturar)
ALTER TABLE client_plans ADD COLUMN billing_platform TEXT;                 -- e.g. Remote, Deel, Upwork

CREATE TABLE external_invoices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id      INTEGER REFERENCES client_plans(id) ON DELETE SET NULL,
  client_id    INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL,
  reference    TEXT,                               -- invoice number/id on that platform
  description  TEXT NOT NULL,                      -- "<plan name> — <period>"
  period_start TEXT,                               -- YYYY-MM-DD
  amount       REAL NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  issued_on    TEXT NOT NULL,                      -- YYYY-MM-DD
  status       TEXT NOT NULL DEFAULT 'issued',     -- issued | paid | void
  paid_on      TEXT,
  income_id    INTEGER REFERENCES income(id) ON DELETE SET NULL,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_external_invoices_plan ON external_invoices(plan_id);
CREATE INDEX idx_external_invoices_status ON external_invoices(status);
