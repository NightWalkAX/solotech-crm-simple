-- Core CRM schema. Money is stored in minor-free integers of the document currency (GYD has no cents in practice; USD stored as whole dollars too).

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE clients (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT UNIQUE,                 -- short unique id
  company          TEXT NOT NULL,
  contact_name     TEXT,
  phone            TEXT,
  whatsapp         TEXT,
  email            TEXT,
  address          TEXT,
  website_url      TEXT,                        -- their original site
  demo_url         TEXT,                        -- demo built for them
  facebook_url     TEXT,
  sector           TEXT,
  characterization TEXT,                        -- who they are / what they sell
  pain_points      TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  stage            TEXT NOT NULL DEFAULT 'evaluated',
  temperature      TEXT,                        -- manual override: cold|warm|hot (NULL = automatic)
  source           TEXT,                        -- site-pitch | referral | facebook_ads | website_form | event | hunter | other
  referrer_id      INTEGER REFERENCES clients(id),
  site_score       INTEGER,
  verdict          TEXT,                        -- GO | MAYBE | NO
  est_price        INTEGER,
  est_currency     TEXT,
  est_monthly      TEXT,
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_clients_stage ON clients(stage);

CREATE TABLE interactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,                    -- whatsapp | email | call | meeting | note | system
  direction   TEXT,                             -- in | out | NULL
  summary     TEXT NOT NULL,
  body        TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_interactions_client ON interactions(client_id, occurred_at);

CREATE TABLE action_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  notes      TEXT,
  kind       TEXT NOT NULL DEFAULT 'task',      -- task | followup | delivery
  due_date   TEXT,                              -- YYYY-MM-DD
  status     TEXT NOT NULL DEFAULT 'open',      -- open | done
  done_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_actions_due ON action_items(status, due_date);

CREATE TABLE documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT NOT NULL,                 -- quote | invoice | receipt
  number         TEXT NOT NULL UNIQUE,          -- QUO-000001 | INV-000001 | REC-000001
  client_id      INTEGER NOT NULL REFERENCES clients(id),
  related_id     INTEGER REFERENCES documents(id), -- receipt -> invoice, invoice -> quote
  issue_date     TEXT NOT NULL,
  due_date       TEXT,
  status         TEXT NOT NULL DEFAULT 'draft', -- draft | issued | accepted | paid | void
  currency       TEXT NOT NULL DEFAULT 'GYD',
  subtotal       INTEGER NOT NULL DEFAULT 0,
  vat            INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0,
  paid           INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT,
  notes          TEXT,
  pdf_path       TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_documents_client ON documents(client_id);

CREATE TABLE document_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  qty         REAL NOT NULL DEFAULT 1,
  unit_price  INTEGER NOT NULL DEFAULT 0,
  vat_rate    REAL NOT NULL DEFAULT 0,          -- 0.14 standard, 0 exempt/zero
  vat_label   TEXT NOT NULL DEFAULT 'Exempt',
  amount      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl      TEXT NOT NULL,
  row_id   INTEGER,
  action   TEXT NOT NULL,                       -- insert | update | delete
  before   TEXT,
  after    TEXT,
  actor    TEXT NOT NULL DEFAULT 'ui',          -- ui | claude | import | system
  at       TEXT NOT NULL DEFAULT (datetime('now'))
);
