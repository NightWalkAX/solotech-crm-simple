-- Marketing tab: the marketing strategy, built visually (mostly by the chat in Edit mode) as boards of blocks.
-- Blocks are deleted one by one before their board (audited, so undo restores them); no ON DELETE CASCADE on purpose.
CREATE TABLE marketing_boards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE marketing_blocks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id    INTEGER NOT NULL REFERENCES marketing_boards(id),
  kind        TEXT NOT NULL DEFAULT 'markdown',      -- markdown | html (sandboxed iframe)
  title       TEXT,
  content     TEXT NOT NULL DEFAULT '',
  width       TEXT NOT NULL DEFAULT 'full',          -- full | half | third
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX marketing_blocks_board ON marketing_blocks(board_id, position);
