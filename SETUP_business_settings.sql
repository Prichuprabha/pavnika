-- Run this once in the Supabase SQL editor before deploying this update.
--
-- Single-row table holding the company/tax details that are currently
-- hardcoded into the invoice email template (_order-shared.js) and
-- nowhere else. Centralizing them here means they're editable from
-- the new Finance tool's Company Settings tab, and the invoice email
-- reads from this table instead of a hardcoded string, so updating it
-- once updates every future invoice automatically.
--
-- Deliberately single-row: the app always reads/writes id = 1. There
-- is only one business behind this site, so a key-value or
-- multi-row design would just be unused flexibility.

create table if not exists business_settings (
  id int primary key default 1,
  legal_name text,
  trade_license_number text,
  licensing_authority text,
  registered_address text,
  vat_registered boolean not null default false,
  trn text, -- VAT Tax Registration Number; only meaningful when vat_registered is true
  corporate_tax_trn text,
  updated_at timestamptz default now(),
  updated_by text,
  constraint business_settings_singleton check (id = 1)
);

-- Seed the row with the details currently hardcoded in _order-shared.js,
-- so nothing changes on the live invoice email until someone actually
-- edits these in the Finance tool.
insert into business_settings (id, legal_name, trade_license_number, licensing_authority, registered_address, vat_registered)
values (
  1,
  'Pavnika Online Seller, trading as Pavnika by Saranya',
  '1563920',
  'Dubai Department of Economy & Tourism',
  'Al Barsha South 4, Dubai, United Arab Emirates',
  false
)
on conflict (id) do nothing;
