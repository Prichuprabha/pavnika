-- Run this once in the Supabase SQL editor.

-- Gift card balance customers can redeem on a future purchase —
-- credited automatically when an Exchange is processed.
ALTER TABLE pos_customers ADD COLUMN IF NOT EXISTS gift_card_balance numeric NOT NULL DEFAULT 0;

-- Marks a return as damaged-goods (the only case Return is valid for
-- now — undamaged returns should go through Exchange instead, since
-- only Exchange puts the item back into sellable stock).
ALTER TABLE pos_returns ADD COLUMN IF NOT EXISTS is_damaged boolean NOT NULL DEFAULT false;

-- How the customer was actually compensated for a damaged return:
-- 'gift_card', 'cash', or 'bank_transfer'. Cash/bank transfer are
-- handled manually outside the system — this just records which one
-- was chosen, for the receipt and for reporting.
ALTER TABLE pos_returns ADD COLUMN IF NOT EXISTS refund_method text;

ALTER TABLE pos_returns ADD COLUMN IF NOT EXISTS receipt_sent boolean NOT NULL DEFAULT false;
