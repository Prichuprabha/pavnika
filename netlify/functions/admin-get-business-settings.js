// netlify/functions/admin-get-business-settings.js
//
// POST { adminToken }
// - Returns the single business_settings row (id = 1): the company/
//   tax details shown in the admin panel's Company Settings tab, and
//   read from directly by the invoice email (_order-shared.js).
// - CORS-enabled (see _cors.js) so the offline Finance app -- run
//   from your own computer, not deployed to pavnika.ae -- can also
//   read this, e.g. to show the VAT/TRN position on its Reports tab.
//   Still requires a valid adminToken either way.
// - If the table hasn't been created yet (SETUP_business_settings.sql
//   not run) or the row is somehow missing, returns settings: null
//   rather than erroring.

const { verifyAdminToken } = require('./_admin-auth');
const { CORS_HEADERS, corsPreflight } = require('./_cors');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  };
}

exports.handler = async function (event) {
  var preflight = corsPreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!verifyAdminToken(body.adminToken)) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Not authorized. Please sign in again.' }) };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/business_settings?id=eq.1&select=*`, { headers: supabaseHeaders() });
    if (!res.ok) {
      console.error('admin-get-business-settings: Supabase error', res.status, await res.text());
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ settings: null }) };
    }
    const rows = await res.json();
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ settings: rows[0] || null }) };
  } catch (err) {
    console.error('admin-get-business-settings error:', err);
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ settings: null }) };
  }
};
