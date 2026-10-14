// netlify/functions/admin-save-delivery-rates.js
//
// POST { adminToken, partnerRate, ownRate }
// - Upserts the single delivery_rates row (id = 1), edited from the
//   admin panel's Delivery Rates tab.
// - Changing a rate here only affects orders/sales where the delivery
//   method is picked (or re-picked) AFTER this save -- every order or
//   sale that already has a method selected keeps its own snapshotted
//   delivery_cost untouched.
// - "Other" has no stored rate any more -- its amount is typed in fresh
//   for each order at the moment it's delivered (see
//   admin-set-delivery-method.js), so it's intentionally left out of
//   this payload and the other_rate column is left untouched.
// - Same-origin only (admin.html) -- no CORS needed here.

const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=representation'
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

  const session = verifyAdminToken(body.adminToken);
  if (!session) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authorized. Please sign in again.' }) };
  }

  const partnerRate = Number(body.partnerRate);
  const ownRate = Number(body.ownRate);
  if (isNaN(partnerRate) || partnerRate < 0 || isNaN(ownRate) || ownRate < 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Both rates must be numbers of 0 or more.' }) };
  }

  const row = {
    id: 1,
    partner_rate: partnerRate,
    own_rate: ownRate,
    updated_at: new Date().toISOString(),
    updated_by: session.displayName || session.username || null
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/delivery_rates`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify(row)
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('admin-save-delivery-rates: Supabase error', res.status, errText);
      throw new Error(`Supabase error ${res.status}`);
    }
    const saved = await res.json();
    return { statusCode: 200, body: JSON.stringify({ success: true, rates: saved[0] }) };
  } catch (err) {
    console.error('admin-save-delivery-rates error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not save delivery rates: ' + err.message }) };
  }
};
