// netlify/functions/admin-clear-promo-history.js
//
// POST { adminToken }
// - Permanently deletes promo codes that are USED or EXPIRED.
// - Never touches still-active codes: because validate-promo looks each
//   code up in this table, deleting an active row would revoke it
//   mid-flight for a customer currently typing it. Used/expired rows
//   are already unusable, so removing them is pure cleanup.

const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const session = verifyAdminToken(body.adminToken);
  if (!session) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authorized. Please sign in again.' }) };
  }

  try {
    const nowIso = new Date().toISOString();
    const url =
      `${SUPABASE_URL}/rest/v1/promo_codes` +
      `?or=(used.eq.true,expires_at.lt.${encodeURIComponent(nowIso)})`;

    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation' // so we can report how many were removed
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Clear promo history failed (Supabase ${res.status}):`, errText);
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not clear promo history.' }) };
    }

    const deletedRows = await res.json();
    console.log(`Cleared ${deletedRows.length} used/expired promo codes.`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, deleted: deletedRows.length }) };
  } catch (err) {
    console.error('Clear promo history error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error clearing promo history.' }) };
  }
};
