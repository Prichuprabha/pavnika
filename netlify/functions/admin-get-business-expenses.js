// netlify/functions/admin-get-business-expenses.js
//
// POST { adminToken }
// - Returns every business_expenses row, most recent first.
// - CORS-enabled (see _cors.js) so the offline Finance app -- run
//   from your own computer, not deployed to pavnika.ae -- can read
//   these directly for its Dashboard/Reports, the same way it already
//   reads orders and business settings. Still requires a valid
//   adminToken either way.
// - Response fields are the friendly camelCase names the admin panel
//   and the offline Finance app both already use for an expense
//   (date/category/description/amount/origCurrency/origAmount/fxRate),
//   not the raw snake_case DB columns, so neither caller has to
//   translate.
// - If the table hasn't been created yet (SETUP_business_expenses.sql
//   not run), returns expenses: [] rather than erroring.

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

function toFriendly(row) {
  return {
    id: row.id,
    date: row.expense_date,
    category: row.category,
    description: row.description || '',
    amount: Number(row.amount_aed),
    origCurrency: row.orig_currency || null,
    origAmount: row.orig_amount !== null && row.orig_amount !== undefined ? Number(row.orig_amount) : null,
    fxRate: row.fx_rate !== null && row.fx_rate !== undefined ? Number(row.fx_rate) : null,
    createdAt: row.created_at,
    createdBy: row.created_by || null,
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null
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
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/business_expenses?select=*&order=expense_date.desc`,
      { headers: supabaseHeaders() }
    );
    if (!res.ok) {
      console.error('admin-get-business-expenses: Supabase error', res.status, await res.text());
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ expenses: [] }) };
    }
    const rows = await res.json();
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ expenses: rows.map(toFriendly) }) };
  } catch (err) {
    console.error('admin-get-business-expenses error:', err);
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ expenses: [] }) };
  }
};
