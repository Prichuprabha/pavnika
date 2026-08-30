-- Run this once in the Supabase SQL editor, alongside the earlier
-- SETUP_pos_sales_delete_cascade.sql migration.
--
-- Fixes: deleting a pos_customers row would fail with the same kind
-- of foreign key error you hit with pos_returns, if that customer
-- has any pos_sales pointing at them via customer_id. Unlike the
-- returns table, this one uses SET NULL rather than CASCADE — a
-- customer's past sales represent real revenue history that
-- shouldn't disappear just because the customer record itself gets
-- deleted; the sale just becomes "no customer on file" instead.
--
-- Written defensively since the exact constraint name wasn't
-- directly confirmed against your live database — this looks it up
-- by the columns involved rather than assuming the name.

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT tc.constraint_name INTO constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  WHERE tc.table_name = 'pos_sales'
    AND kcu.column_name = 'customer_id'
    AND tc.constraint_type = 'FOREIGN KEY'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE pos_sales DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE pos_sales
    ADD CONSTRAINT pos_sales_customer_id_fkey
    FOREIGN KEY (customer_id)
    REFERENCES pos_customers(id)
    ON DELETE SET NULL;
END $$;
