-- Quotes/invoices: 1 = notes (terms) + signature block start on their own page after the lines and totals. Default 0 = flow.
ALTER TABLE documents ADD COLUMN terms_page INTEGER NOT NULL DEFAULT 0;
