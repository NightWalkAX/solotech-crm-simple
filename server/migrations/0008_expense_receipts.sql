-- Proof of payment (PDF) attached to each expense; files live in data/receipts/.
ALTER TABLE expenses ADD COLUMN receipt_path TEXT;
ALTER TABLE expenses ADD COLUMN receipt_name TEXT;
