-- Per-order/per-sale delivery method + its snapshotted AED cost.
--
-- delivery_cost is a SNAPSHOT taken at the moment delivery_method is
-- set (from whatever delivery_rates held at that instant) -- it is
-- never recalculated later, even if delivery_rates changes afterwards.
-- That snapshot is what the offline Finance tool reads as an automatic
-- per-order expense; it never reads delivery_rates itself.
--
-- Online orders (orders table): no default -- delivery_method stays
-- NULL until an admin picks one on the order's detail page, same as
-- Update Status.
--
-- In-store sales (pos_sales table): defaults to 'own' at AED 0 the
-- moment a sale completes (see pos-complete-sale.js), since most POS
-- sales are picked up / self-delivered -- an admin can still change it
-- afterwards from the sale's detail drawer.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_cost numeric;

ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS delivery_method text DEFAULT 'own';
ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS delivery_cost numeric DEFAULT 0;
