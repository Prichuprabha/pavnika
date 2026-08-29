-- Run this once in the Supabase SQL editor.

ALTER TABLE pos_users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Mark the existing Admin account as an actual admin.
UPDATE pos_users SET is_admin = true WHERE username = 'Admin';
