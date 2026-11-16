-- Day the money was actually received (receipts). Finanzas counts receipts on this day; empty = issue_date.
-- Lets a receipt issued later (e.g. REC-000001..3 issued 02/10/2026) land in the month the client paid.
ALTER TABLE documents ADD COLUMN paid_on TEXT;
