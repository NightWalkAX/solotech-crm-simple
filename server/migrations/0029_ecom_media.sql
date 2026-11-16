-- Marca e-commerce folder: photos, videos, documents and links sent on the brand's WhatsApp line (server/ecom-media.js).
-- Files in data/ecom-media/<Fotos|Videos|Documentos>/, links also in Enlaces.md; the folder is copied to Google Drive.
CREATE TABLE ecom_media (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_prompt_id   INTEGER REFERENCES wa_prompts(id),
  kind           TEXT NOT NULL,          -- image | video | document | link
  file           TEXT,                   -- path relative to data/ecom-media
  mime           TEXT,
  size           INTEGER,
  url            TEXT,                   -- link kind
  caption        TEXT,                   -- WhatsApp caption, or the message the link came in
  transcript     TEXT,                   -- videos: audio transcribed with Whisper
  received_at    TEXT NOT NULL,          -- UTC
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
