-- Run this once in the Supabase SQL editor before deploying this
-- update. Logs every processed return/refund made against a WEBSITE
-- order (admin-process-order-return.js) -- the online-order
-- equivalent of pos_returns, which already exists for in-store POS
-- sales. One row per return call, so an order can be returned in
-- stages over time (e.g. 2 of 3 items now, the last one later) and
-- each stage keeps its own record of what was returned, for how much,
-- and by which method.

create table if not exists order_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id),
  order_number text,
  items_returned jsonb not null,
  refund_amount numeric not null default 0,
  refund_method text not null, -- 'cash', 'bank_transfer', or 'gift_card'
  processed_by text,
  created_at timestamptz default now()
);

create index if not exists idx_order_returns_order_id on order_returns (order_id);
