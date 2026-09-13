-- Run this once in your Supabase project's SQL editor.
-- Creates the admin_users table and seeds the first admin account:
--   Username: pavnikabysaranya
--   Password: P@vnik@
--
-- The password below is stored as a scrypt hash + salt, generated with
-- the exact same algorithm netlify/functions/_pos-auth.js uses for POS
-- logins (Node's crypto.scryptSync, 64-byte output, per-user random
-- salt). The plaintext password "P@vnik@" is never stored anywhere —
-- only this hash. It has been verified to actually accept "P@vnik@" and
-- reject anything else before being handed to you.

create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  display_name text,
  password_hash text not null,
  password_salt text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into admin_users (username, display_name, password_hash, password_salt, active)
values (
  'pavnikabysaranya',
  'Saranya',
  '0a30afeea8fd8f483860868ec99a9e984066fa3cfc04226a56d6b539bd722ea40cf48c3a832e197808a5fde5ade49b016d3a6d99ac8db9d4391c17abd680c8f4',
  'd524e84e2eb5e106f7d4318a5e8af144',
  true
);
