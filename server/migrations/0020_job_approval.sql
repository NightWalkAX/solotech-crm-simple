-- Scheduled emails: when the owner approved this draft + send time. The scheduler only sends if the draft wasn't edited after it.
ALTER TABLE scheduled_jobs ADD COLUMN approved_at TEXT;
