-- Impuestos: payments made to NIS / GRA. Estimates are derived (server/taxes.js), only real payments are stored.
CREATE TABLE tax_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,                     -- nis | income_advance | income_balance | penalty
  period       TEXT NOT NULL,                     -- nis: YYYY-MM · income_advance: YYYY-Qn · income_balance / penalty: YYYY
  paid_on      TEXT NOT NULL,                     -- YYYY-MM-DD
  amount_gyd   INTEGER NOT NULL,
  reference    TEXT,
  channel      TEXT,                              -- bank / portal / GTT Mobile Money…
  from_reserve INTEGER NOT NULL DEFAULT 1,        -- paid out of the tax reserve account
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tax_payments_period ON tax_payments(kind, period);

-- Money the owner moves out of the business: his salary, and deposits/withdrawals of the tax reserve account.
-- Not OpEx (a sole trader's own salary isn't a deductible expense) and not income.
CREATE TABLE owner_moves (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,                       -- salary | reserve_in | reserve_out
  moved_on   TEXT NOT NULL,                       -- YYYY-MM-DD
  amount_gyd INTEGER NOT NULL,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_owner_moves_date ON owner_moves(kind, moved_on);

-- Monthly business budget (Finanzas → Presupuesto). Actuals are derived per kind:
-- salary = owner_moves salary · reserve = reserve deposits · fixed / variable = expenses of that kind not tagged
-- to another line · tagged = expenses with budget_line_id.
CREATE TABLE budget_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,                       -- salary | reserve | fixed | variable | tagged
  amount_gyd INTEGER NOT NULL DEFAULT 0,          -- per month
  active     INTEGER NOT NULL DEFAULT 1,
  position   INTEGER NOT NULL DEFAULT 0,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

ALTER TABLE expenses ADD COLUMN budget_line_id INTEGER REFERENCES budget_lines(id) ON DELETE SET NULL;
