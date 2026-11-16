-- Second WhatsApp prompt line (settings.wa_ecom): a second person, restricted to the Marca e-commerce tab.
-- 'jose' = the owner's own line (settings.wa_prompts), 'ecom' = the brand line. Chats of that line have origin 'wa_ecom'.
ALTER TABLE wa_prompts ADD COLUMN line TEXT NOT NULL DEFAULT 'owner';
