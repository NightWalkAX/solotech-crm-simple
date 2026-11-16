-- Quotes: client/issuer signature & acceptance block at the end of the PDF (1 = shown, the default). Ignored for invoices/receipts.
ALTER TABLE documents ADD COLUMN show_signature INTEGER NOT NULL DEFAULT 1;
