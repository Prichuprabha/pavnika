-- Run this once in the Supabase SQL editor before deploying this update.
--
-- Multi-row table holding Business Expenses (rent, salaries, packaging,
-- shipping, subscriptions -- anything that isn't a product cost).
-- Previously these lived only in the offline Finance tool's browser
-- localStorage, private to whichever computer entered them. This moves
-- them online so they're editable from the admin panel's new Company ->
-- Business Expenses section, and the offline Finance tool now just
-- reads this table (via admin-get-business-expenses, CORS-enabled)
-- instead of keeping its own local copy.
--
-- Amount is always stored in AED (amount_aed). An expense entered in a
-- foreign currency (INR, say) also keeps its original figure and the
-- exchange rate used, purely for display/audit -- amount_aed is always
-- what everything else (COGS/Dashboard/Reports) actually sums.

create table if not exists business_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null,
  description text,
  amount_aed numeric not null check (amount_aed > 0),
  orig_currency text, -- e.g. 'INR'; null when entered directly in AED
  orig_amount numeric,
  fx_rate numeric,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz,
  updated_by text
);

create index if not exists business_expenses_date_idx on business_expenses (expense_date desc);
