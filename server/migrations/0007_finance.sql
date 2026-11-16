-- Finance: USD→GYD rates (Demerara Bank), recurring OpEx (subscriptions) and actual spend (expenses).
CREATE TABLE fx_rates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  currency   TEXT NOT NULL DEFAULT 'USD',
  buy        REAL,                                -- bank buys USD (non-cash "Others")
  sell       REAL NOT NULL,                       -- bank sells USD (non-cash "Others"): rate used for spend
  source     TEXT NOT NULL DEFAULT 'demerarabank.com',
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_fx_rates_at ON fx_rates(currency, fetched_at);

CREATE TABLE subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  vendor     TEXT,
  kind       TEXT NOT NULL DEFAULT 'fixed',      -- fixed | variable (usage-based: amount = monthly estimate)
  amount     REAL NOT NULL DEFAULT 0,             -- per cycle, in `currency` (cents allowed: USD prices)
  currency   TEXT NOT NULL DEFAULT 'USD',
  cycle      TEXT NOT NULL DEFAULT 'monthly',     -- weekly | monthly | quarterly | yearly
  next_due   TEXT,                                -- YYYY-MM-DD
  active     INTEGER NOT NULL DEFAULT 1,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE expenses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  spent_on        TEXT NOT NULL,                  -- YYYY-MM-DD
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
  description     TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'variable', -- fixed | variable
  amount          REAL NOT NULL,                  -- in `currency`
  currency        TEXT NOT NULL DEFAULT 'USD',
  fx_rate         REAL,                           -- GYD per unit at the moment it was recorded (1 for GYD)
  amount_gyd      INTEGER NOT NULL,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_expenses_date ON expenses(spent_on);

-- Chat turns: API cost in GYD at the rate of the moment, and which mode ran it.
ALTER TABLE chat_messages ADD COLUMN fx_rate  REAL;
ALTER TABLE chat_messages ADD COLUMN cost_gyd INTEGER;
ALTER TABLE chat_messages ADD COLUMN mode     TEXT;
