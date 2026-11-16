-- Site-pitch sessions: the chat builds a demo and the preview window shows the demo folder live.
ALTER TABLE chats ADD COLUMN pitch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN demo_slug TEXT;
