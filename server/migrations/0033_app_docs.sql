-- App Lab design docs per project (server/appdocs.js): one JSON document per project and kind, drawn by the UI as diagrams.
-- project = "apps.<name>" | "demos.<slug>" (may not exist on disk yet: design comes before the build).
-- kind: db (ER diagram) | infra (infrastructure) | ux (screens + navigation, each with a UI preview) | usecases (happy paths over the ux screens).
CREATE TABLE app_docs (
  id INTEGER PRIMARY KEY,
  project TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('db', 'infra', 'ux', 'usecases')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project, kind)
);
