-- YouTube transcripts cache (server/youtube.js, crm_youtube_transcript): published captions or local Whisper.
-- Not audited: it is a cache, the transcript can always be fetched again.
CREATE TABLE youtube_transcripts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    TEXT NOT NULL UNIQUE,
  url         TEXT,
  title       TEXT,
  channel     TEXT,
  duration    INTEGER,                               -- seconds
  language    TEXT,
  source      TEXT,                                  -- captions | auto_captions | whisper
  status      TEXT NOT NULL DEFAULT 'processing',    -- processing | ready | error
  error       TEXT,
  segments    TEXT,                                  -- JSON [[start_seconds, text], ...]
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
