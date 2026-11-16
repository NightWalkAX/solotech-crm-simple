-- Deleting a chat from the panel only hides it: its chat_messages keep the token cost that Finanzas counts as OpEx.
ALTER TABLE chats ADD COLUMN deleted_at TEXT;
