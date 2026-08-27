-- Run this once in the Supabase SQL editor.
-- Stores parked/held sales so a transaction can be paused and resumed
-- later, or fully deleted, from the new Hold/Parked Sales page.

create table if not exists pos_held_sales (
  id uuid primary key default gen_random_uuid(),
  cart_json jsonb not null,
  customer_json jsonb,
  discount_type text default 'percent',
  discount_value numeric default 0,
  coupon_code text,
  notes text,
  held_by text,
  created_at timestamptz default now()
);

-- Parked sales older than 48 hours are meant to be cleaned up
-- automatically per the confirmed behavior — this index makes that
-- cleanup query fast once it's built.
create index if not exists idx_pos_held_sales_created_at on pos_held_sales (created_at);
