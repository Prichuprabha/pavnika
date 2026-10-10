-- Run this once in the Supabase SQL editor before deploying this
-- update. Logs every manual hand-edit made to a customer's
-- gift_card_balance -- the ONLY place a balance can be changed
-- outside of an actual return or checkout redemption. There are two
-- places this can happen (both admin-gated): the admin.html Customers
-- tab (admin-adjust-gift-card-balance.js) and the POS Settings ->
-- Customer Database page (pos-update-customer.js) -- "source" below
-- records which one. Every row keeps the before/after balance, the
-- delta, who made the change, why, and from where, so a manual
-- correction (e.g. undoing an over-credit from a since-fixed bug)
-- still leaves a full trail, the same way order_returns/pos_returns
-- do for ordinary refunds.

create table if not exists gift_card_adjustments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references pos_customers(id),
  previous_balance numeric not null,
  new_balance numeric not null,
  delta numeric not null,
  reason text not null,
  source text not null default 'admin', -- 'admin' (admin.html Customers tab) or 'pos' (POS Settings -> Customer Database)
  processed_by text,
  created_at timestamptz default now()
);

-- Safe to re-run: adds the column if you already ran an earlier
-- version of this file that didn't have "source" yet.
alter table gift_card_adjustments add column if not exists source text not null default 'admin';

create index if not exists idx_gift_card_adjustments_customer_id on gift_card_adjustments (customer_id);
