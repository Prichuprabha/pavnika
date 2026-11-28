-- Step 42: marketing opt-in + cart activity tracking
-- Run once in Supabase > SQL Editor.
ALTER TABLE verified_visitors
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_opt_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS cart_updated_at timestamptz;

-- Step 43: log of every cart-offer email sent (used to enforce the
-- 30-day pause between offers and to show "Offers Sent" in admin).
CREATE TABLE IF NOT EXISTS cart_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  discount_percent integer NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  cart_total numeric,
  discount_amount numeric,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cart_offers_email_idx ON cart_offers (email, sent_at DESC);
ALTER TABLE cart_offers ENABLE ROW LEVEL SECURITY;

-- Step 45: a promo code can be tied to one customer's email.
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS email text;
