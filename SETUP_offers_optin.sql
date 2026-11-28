-- Step 42: marketing opt-in + cart activity tracking
-- Run once in Supabase > SQL Editor.
ALTER TABLE verified_visitors
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_opt_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS cart_updated_at timestamptz;
