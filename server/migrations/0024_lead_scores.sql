-- Lead temperature from the content of the conversation (server/leadscore.js), not from message counts.
-- Kept apart from clients so rescoring doesn't touch updated_at, the audit log or the chat's undo.
CREATE TABLE lead_scores (
  client_id   INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  temperature TEXT,                  -- hot | warm | cold (NULL = scoring failed, see error)
  score       INTEGER,               -- 0-100
  reason      TEXT,                  -- one line in Spanish, citing the conversation
  tip         TEXT,                  -- one line: how the owner's next message should go
  signature   TEXT NOT NULL,         -- last message id | last interaction id | stage it was scored for
  error       TEXT,
  scored_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
