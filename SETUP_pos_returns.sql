-- Run this once in the Supabase SQL editor.
-- Logs every processed return or exchange, linked back to the
-- original sale it came from.

create table if not exists pos_returns (
  id uuid primary key default gen_random_uuid(),
  original_sale_id uuid references pos_sales(id),
  bill_number text not null,
  items_returned jsonb not null,
  refund_amount numeric not null default 0,
  action_type text not null, -- 'return' or 'exchange'
  processed_by text,
  created_at timestamptz default now()
);

create index if not exists idx_pos_returns_original_sale on pos_returns (original_sale_id);
