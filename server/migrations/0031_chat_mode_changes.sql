-- Mode changes of the owner's WhatsApp line ("modo build" / "modo edit" commands, idle timeout, restart), audited via insertRow.
CREATE TABLE IF NOT EXISTS chat_mode_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line TEXT NOT NULL DEFAULT 'owner',
  from_mode TEXT,
  to_mode TEXT NOT NULL,
  reason TEXT NOT NULL,            -- command | confirm | timeout | restart
  wa_prompt_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
