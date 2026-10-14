-- Delivery rate settings (Partner / Own / Other) for the admin panel's
-- new "Delivery Rates" section. Single-row table, same pattern as
-- business_settings. These are flat AED amounts, editable any time --
-- changing a rate here only affects orders/sales where the delivery
-- method is picked (or re-picked) AFTER the change. Orders that already
-- have a method selected keep whatever rate was in force when they were
-- selected (see orders.delivery_cost / pos_sales.delivery_cost, added by
-- SETUP_delivery_tracking.sql), which is a plain snapshot, not a
-- reference to this table.

CREATE TABLE IF NOT EXISTS delivery_rates (
  id int PRIMARY KEY DEFAULT 1,
  partner_rate numeric NOT NULL DEFAULT 0,
  own_rate numeric NOT NULL DEFAULT 0,
  other_rate numeric NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  updated_by text,
  CONSTRAINT delivery_rates_single_row CHECK (id = 1)
);

INSERT INTO delivery_rates (id, partner_rate, own_rate, other_rate)
VALUES (1, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;
