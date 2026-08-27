-- Run this once in the Supabase SQL editor.
-- Adds support for split payments (e.g. half cash, half card) without
-- changing the existing payment_method column's meaning — that stays
-- as a human-readable summary (e.g. "Split: Cash, Card"), while the
-- new column holds the exact breakdown for reporting/reconciliation.

ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS payment_breakdown jsonb;
