// netlify/functions/admin-get-delivery-rates.js
//
// POST { adminToken }
// - Returns the single delivery_rates row (id = 1): the three flat AED
//   amounts (Partner / Own / Other) shown and edited in the admin
//   panel's Delivery Rates tab, and read by pos-complete-sale.js /
//   admin-set-delivery-method.js whenever a delivery method is (re-)
//   picked on an order or sale.
// - Same-origin only (admin.html) -- no CORS. The offline Finance tool
//   never needs these rates directly: it only reads the delivery_cost
//   already snapshotted onto each order/sale via admin-get-orders and
//   admin-get-pos-sales.
// - If the table hasn't been created yet (SETUP_delivery_rates.sql not
//   run) or the row is missing, returns rates: null rather than
//   erroring.

const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  };
}

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

  if (!verifyAdminToken(body.adminToken)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authorized. Please sign in again.' }) };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/delivery_rates?id=eq.1&select=*`, { headers: supabaseHeaders() });
    if (!res.ok) {
      console.error('admin-get-delivery-rates: Supabase error', res.status, await res.text());
      return { statusCode: 200, body: JSON.stringify({ rates: null }) };
    }
    const rows = await res.json();
    return { statusCode: 200, body: JSON.stringify({ rates: rows[0] || null }) };
  } catch (err) {
    console.error('admin-get-delivery-rates error:', err);
    return { statusCode: 200, body: JSON.stringify({ rates: null }) };
  }
};
