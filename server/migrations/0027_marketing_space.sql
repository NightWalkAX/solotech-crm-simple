-- Boards belong to a space: 'solotech' (Marketing tab) or 'ecom' (Marca e-commerce tab:
-- the Shopify + Printful brand). Blocks follow their board. The two tabs and their crm_* tools never see each other's boards.
ALTER TABLE marketing_boards ADD COLUMN space TEXT NOT NULL DEFAULT 'solotech';
CREATE INDEX marketing_boards_space ON marketing_boards(space, position);
