-- "Contexto" button on tasks: Sonnet's explanation of what a task is about and what to do (cache, not audited).
CREATE TABLE action_contexts (
  action_id  INTEGER PRIMARY KEY REFERENCES action_items(id) ON DELETE CASCADE,
  body       TEXT,                                -- markdown in Spanish
  signature  TEXT NOT NULL,                       -- inputs fingerprint; changed → stale
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
