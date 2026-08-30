// Deletes a pos_customers record permanently, from the POS Settings
// Customer Database page. Admin-only.
//
// Relies on pos_sales.customer_id having ON DELETE SET NULL (see
// SETUP_pos_customers_delete_safe.sql) — this customer's past sales
// stay on record with their revenue intact, just detached from any
// customer, rather than being silently deleted along with them.
//
// Any gift card balance this customer had simply disappears along
// with the record — there's no other table tracking it separately,
// so the frontend warns about this explicitly before calling here.
const { verifyPosToken } = require('./_pos-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
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

  var session = verifyPosToken(body.posToken);
  if (!session) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Session expired, please log in again' }) };
  }
  if (!session.isAdmin) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  if (!body.customerId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing customer id' }) };
  }

  try {
    var res = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${encodeURIComponent(body.customerId)}`, {
      method: 'DELETE',
      headers: Object.assign({}, supabaseHeaders(), { 'Prefer': 'return=representation' })
    });
    if (!res.ok) {
      var errText = await res.text();
      console.error('pos-delete-customer: Supabase delete failed:', errText);
      throw new Error(`Supabase delete failed: ${res.status}`);
    }
    var deleted = await res.json();
    if (!deleted.length) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Customer not found' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (e) {
    console.error('pos-delete-customer error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not delete this customer' }) };
  }
};
