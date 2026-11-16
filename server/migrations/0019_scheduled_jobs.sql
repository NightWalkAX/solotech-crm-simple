-- Programados: jobs the owner orders from the chat (scheduled emails, hunts, reminders, briefings), run by server/scheduler.js.
CREATE TABLE scheduled_jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT NOT NULL,                    -- email | reminder | hunt | briefing | task
  title           TEXT NOT NULL,
  prompt          TEXT,                             -- instructions for Claude (hunt/briefing/task) or the reminder text
  cron            TEXT,                             -- recurring: 5-field cron in Guyana time (UTC-4); null = one-shot
  run_at          TEXT,                             -- one-shot: UTC 'YYYY-MM-DD HH:MM:SS'
  next_run_at     TEXT,                             -- UTC; null when nothing is pending
  mode            TEXT,                             -- chat mode for Claude jobs (null = automatic)
  deliver         TEXT NOT NULL DEFAULT 'whatsapp', -- whatsapp (the owner's phone + panel) | panel
  email_draft_id  INTEGER REFERENCES email_drafts(id) ON DELETE SET NULL,
  client_id       INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'active',   -- active | paused | done | cancelled
  run_count       INTEGER NOT NULL DEFAULT 0,
  last_run_at     TEXT,
  last_status     TEXT,                             -- done | error | missed
  last_error      TEXT,
  last_chat_id    INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX scheduled_jobs_due ON scheduled_jobs (status, next_run_at);

CREATE TABLE scheduled_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id       INTEGER NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
  due_at       TEXT,                                -- UTC slot this run belongs to
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at  TEXT,
  status       TEXT NOT NULL DEFAULT 'running',     -- running | done | error | missed
  chat_id      INTEGER,
  output       TEXT,
  error        TEXT
);
CREATE INDEX scheduled_runs_job ON scheduled_runs (job_id, id);
