-- Newsletter tab: The AI Bro Detox campaigns, sent through Resend to the blog's confirmed subscribers
-- (the list lives in Cloudflare D1, table subscribers; read through wrangler).
CREATE TABLE newsletter_campaigns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  subject       TEXT NOT NULL,
  preheader     TEXT,                                -- preview line shown next to the subject in the inbox
  body_md       TEXT NOT NULL,                       -- markdown, rendered into the Detox email shell
  status        TEXT NOT NULL DEFAULT 'draft',       -- draft | scheduled | sending | sent | failed | discarded
  scheduled_at  TEXT,                                -- UTC 'YYYY-MM-DD HH:MM:SS' (status scheduled)
  approved_at   TEXT,                                -- when the owner OKed this exact version to go out (send or schedule)
  test_sent_at  TEXT,
  recipients    INTEGER,
  sent_count    INTEGER NOT NULL DEFAULT 0,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  started_at    TEXT,
  sent_at       TEXT,
  stats         TEXT,                                -- JSON {delivered, opened, clicked, bounced, complained, checked_at} from Resend
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per recipient of a campaign: written before each batch goes out, so a restart resumes without double sends.
CREATE TABLE newsletter_sends (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id   INTEGER NOT NULL REFERENCES newsletter_campaigns(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  batch         INTEGER NOT NULL,
  resend_id     TEXT,
  status        TEXT NOT NULL DEFAULT 'queued',      -- queued | sent | failed
  last_event    TEXT,                                -- Resend last_event: delivered | opened | clicked | bounced | complained …
  error         TEXT,
  sent_at       TEXT,
  UNIQUE (campaign_id, email)
);
CREATE INDEX idx_newsletter_sends_campaign ON newsletter_sends(campaign_id, status);
