-- Already run in Supabase on [15Aug2026] — kept here for reference/disaster recovery, not auto-executed
-- Run this in Supabase's SQL editor before deploying this update.
-- Creates the two tables the new cart/wishlist sync functions read
-- and write. Since the site isn't publicized yet, this is a clean
-- cutover — no migration of existing localStorage data needed.

create table if not exists cart_items (
  id bigint generated always as identity primary key,
  email text not null,
  saree_id text not null,
  added_at timestamptz not null default now(),
  unique (email, saree_id)
);

create table if not exists wishlist_items (
  id bigint generated always as identity primary key,
  email text not null,
  saree_id text not null,
  added_at timestamptz not null default now(),
  unique (email, saree_id)
);

-- Speeds up the get-cart/get-wishlist lookups, which always filter by email.
create index if not exists cart_items_email_idx on cart_items (email);
create index if not exists wishlist_items_email_idx on wishlist_items (email);
