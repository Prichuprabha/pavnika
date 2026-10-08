-- Run this in Supabase's SQL editor before deploying this update.
-- Adds a gift_card_applied column to the orders table, so the amount
-- of store credit redeemed on an order (online checkout, or a manual
-- order entered by admin) is actually persisted on the order record
-- itself -- not just implied by subtotal/discount/total not quite
-- adding up. Needed for:
--   - deductGiftCardIfApplied (verify-nomod-order.js) to know how much
--     to deduct from the customer's balance once payment is confirmed
--   - the invoice email and admin Orders view to show a "Store credit
--     applied" line
-- Defaults to 0 so every existing order (which never had this
-- concept) reads as "no credit applied", exactly matching their
-- actual history.

alter table orders add column if not exists gift_card_applied numeric not null default 0;
