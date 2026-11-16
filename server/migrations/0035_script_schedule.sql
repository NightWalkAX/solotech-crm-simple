-- Social Media Content calendar: the day a script's video goes out and whether it counts as value or ad (7 value / 3 ads).
ALTER TABLE social_scripts ADD COLUMN publish_on TEXT;   -- YYYY-MM-DD, Guyana date; NULL = not scheduled
ALTER TABLE social_scripts ADD COLUMN kind TEXT;         -- value | ad; NULL = not set
CREATE INDEX social_scripts_publish_on ON social_scripts(publish_on);
