-- Tasks tab: rough size of each task (no exact times) and the last "sigue en pie" from the cleanup mode.
-- action_items.status gains 'dropped' (= "ya no aplica"; closed like done, done_at = when it was dropped).
ALTER TABLE action_items ADD COLUMN effort TEXT;       -- quick | medium | big; NULL = sin estimar
ALTER TABLE action_items ADD COLUMN reviewed_at TEXT;  -- ISO UTC; cleanup skips tasks reviewed in the last 7 days
