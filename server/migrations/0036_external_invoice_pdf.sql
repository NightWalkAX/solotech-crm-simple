-- PDF of an invoice issued on another platform (Remote…); files live in data/receipts/ (backed up), kept on replace for undo.
ALTER TABLE external_invoices ADD COLUMN pdf_path TEXT;
ALTER TABLE external_invoices ADD COLUMN pdf_name TEXT;
