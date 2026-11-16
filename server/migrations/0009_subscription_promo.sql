-- Introductory pricing: first purchase date, number of seats/licences, discounted price until promo_until,
-- then `amount` (regular price). Prices are per unit; the cycle charge is price × quantity.
ALTER TABLE subscriptions ADD COLUMN started_on   TEXT;              -- YYYY-MM-DD first purchase
ALTER TABLE subscriptions ADD COLUMN quantity     INTEGER NOT NULL DEFAULT 1;
ALTER TABLE subscriptions ADD COLUMN promo_amount REAL;              -- per unit per cycle while promo lasts
ALTER TABLE subscriptions ADD COLUMN promo_until  TEXT;              -- YYYY-MM-DD: regular price applies from this day
