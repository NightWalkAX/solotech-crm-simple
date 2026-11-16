-- the owner's own WhatsApp number as a prompt line: texts and voice notes → CRM chat turn → reply (text + report files) on WhatsApp.
CREATE TABLE wa_prompts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_message_id  TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL,                    -- text | audio | other
  body           TEXT,                             -- text, or the transcript of a voice note
  media_url      TEXT,
  media_path     TEXT,                             -- downloaded voice note (data/wa-media/)
  status         TEXT NOT NULL DEFAULT 'queued',   -- queued | transcribing | running | done | error | skipped
  error          TEXT,
  chat_id        INTEGER REFERENCES chats(id),
  received_at    TEXT NOT NULL,                    -- UTC
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
-- 'whatsapp' = the chat's turns come from the owner's phone and its replies go back there.
ALTER TABLE chats ADD COLUMN origin TEXT;
