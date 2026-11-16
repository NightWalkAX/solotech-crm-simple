-- PWA push notifications: one row per browser/device that allowed notifications (server/push.js).
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_ok_at TEXT,
  last_error TEXT
);
