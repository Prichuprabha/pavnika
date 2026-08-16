-- added to supabase this is for record only.
-- Run this in Supabase's SQL editor before deploying this update.
-- Adds a payment_method column to the orders table — previously the
-- payment method (Nomod card details, Bank Transfer, Cash) was only
-- ever used to build the confirmation email text and was never
-- actually saved on the order record itself. The new Orders drawer
-- needs to display it, so this makes it a real, persisted field.

alter table orders add column if not exists payment_method text;
