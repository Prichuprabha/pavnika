-- Run this in Supabase's SQL editor before deploying this update.
-- Stage 2 of the general "quantity" capability: adds a qty column to
-- cart_items. Purely additive -- existing rows get qty=1 automatically
-- (the column default), and nothing currently reads or writes
-- anything other than 1, so this has no visible effect until the
-- Stage 3 quantity-picker UI ships.

alter table cart_items
  add column if not exists qty integer not null default 1;

-- Postgres has no "IF NOT EXISTS" for ADD CONSTRAINT, so guard it the
-- same way "create table if not exists" above does it implicitly --
-- skip if a constraint of this name is already there (safe to re-run).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cart_items_qty_positive'
  ) then
    alter table cart_items add constraint cart_items_qty_positive check (qty >= 1);
  end if;
end $$;
