// Updates an existing customer's contact details from the Customer
// Database settings page. Deliberately does NOT accept gift_card_balance
// or loyalty_points here — those are only ever changed through the
// actual transaction flows (sales, returns, redemptions), never
// hand-edited, to keep them consistent with the underlying ledger of
// what actually happened.
const { verifyPosToken } = require('./_pos-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  var body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!verifyPosToken(body.posToken)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Session expired, please log in again' }) };
  }

  if (!body.customerId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing customer id' }) };
  }

  var name = (body.name || '').trim();
  var phone = (body.phone || '').trim();
  if (!name || !phone) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Name and mobile number are required' }) };
  }

  try {
    var res = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${encodeURIComponent(body.customerId)}`, {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        name: name,
        phone: phone,
        phone_country_code: (body.phoneCountryCode || '+971').trim(),
        email: (body.email || '').trim() || null,
        emirate: body.emirate || null,
        address: (body.address || '').trim() || null
      })
    });
    if (!res.ok) throw new Error(`Supabase update failed: ${res.status}`);
    var rows = await res.json();
    if (!rows.length) return { statusCode: 404, body: JSON.stringify({ error: 'Customer not found' }) };
    return { statusCode: 200, body: JSON.stringify({ customer: rows[0] }) };
  } catch (e) {
    console.error('pos-update-customer error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not save changes, please try again' }) };
  }
};
