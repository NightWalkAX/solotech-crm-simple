-- App Lab scratchpad (space 'uilab' of marketing_boards): UI pieces Claude draws for an app demo, approved or rejected by the owner.
-- review: pending | approved | rejected (NULL on Marketing / Marca e-commerce blocks); review_note = the owner's reason or change request.
ALTER TABLE marketing_blocks ADD COLUMN review TEXT;
ALTER TABLE marketing_blocks ADD COLUMN review_note TEXT;
