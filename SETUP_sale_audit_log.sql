-- Run this once in the Supabase SQL editor before deploying this update.
--
-- Append-only record of every completed sale that gets permanently
-- deleted from the admin panel. No update/delete function is ever
-- built against this table on purpose -- it exists specifically to
-- survive the deletion of the sale it documents, so that a sale can
-- still be shown to an auditor or the FTA even after it no longer
-- exists in pos_sales/orders.
--
-- `snapshot` holds the full row (every column) exactly as it stood at
-- the moment of deletion, captured by the delete function BEFORE the
-- delete runs -- this is what lets the record stand in for the row
-- that is about to be gone.

create table if not exists sale_audit_log (
  id uuid primary key default gen_random_uuid(),
  target_type text not null, -- 'pos_sale' today; 'order' if an order-delete is ever added
  target_id uuid not null,
  snapshot jsonb not null,
  reason text not null,
  performed_by text,
  performed_at timestamptz default now()
);

create index if not exists idx_sale_audit_log_target on sale_audit_log (target_type, target_id);
create index if not exists idx_sale_audit_log_performed_at on sale_audit_log (performed_at);
