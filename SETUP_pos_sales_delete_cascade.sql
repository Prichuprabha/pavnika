-- Run this once in the Supabase SQL editor.
--
-- Fixes: deleting a row from pos_sales currently fails with a foreign
-- key violation if any pos_returns row references it, since that
-- constraint had no ON DELETE behavior defined. This adds CASCADE,
-- so deleting a sale automatically deletes its associated return
-- record too.
--
-- Worth knowing: this only removes the AUDIT RECORD of a return/
-- exchange. If that return had credited a customer's gift card
-- balance, deleting it here does NOT automatically reverse that
-- balance — pos_customers.gift_card_balance is a separate running
-- total that isn't touched by this cascade. The admin delete
-- confirmation popup warns about this explicitly before deleting.

ALTER TABLE pos_returns DROP CONSTRAINT pos_returns_original_sale_id_fkey;

ALTER TABLE pos_returns
  ADD CONSTRAINT pos_returns_original_sale_id_fkey
  FOREIGN KEY (original_sale_id)
  REFERENCES pos_sales(id)
  ON DELETE CASCADE;
