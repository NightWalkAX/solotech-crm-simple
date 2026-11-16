-- Token usage and cost of each assistant turn (from the CLI's final `result` event; includes subagents).
ALTER TABLE chat_messages ADD COLUMN input_tokens       INTEGER;
ALTER TABLE chat_messages ADD COLUMN output_tokens      INTEGER;
ALTER TABLE chat_messages ADD COLUMN cache_read_tokens  INTEGER;
ALTER TABLE chat_messages ADD COLUMN cache_write_tokens INTEGER;
ALTER TABLE chat_messages ADD COLUMN cost_usd           REAL;
