-- Social Media Content tab: video scripts read on the teleprompter pop-up (web/src/pages/Teleprompter.jsx).
-- content = one phrase per line; optional "[m:ss]" start time; "#" lines are notes the teleprompter skips.
CREATE TABLE social_scripts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  platform     TEXT,                                -- facebook | instagram | tiktok | youtube | linkedin | other
  status       TEXT NOT NULL DEFAULT 'draft',       -- draft | ready | recorded | published
  content      TEXT NOT NULL DEFAULT '',
  duration_sec INTEGER,                             -- planned video length; NULL = from words per minute
  wpm          INTEGER NOT NULL DEFAULT 150,        -- reading speed when there is no duration/timestamps
  notes        TEXT,                                -- caption, hashtags, shots, CTA
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
