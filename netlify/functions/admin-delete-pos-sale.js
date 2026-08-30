// Deletes a POS sale permanently, from the admin Orders page's Shop
// Orders tab. Relies on pos_returns' foreign key CASCADE (see
// SETUP_pos_sales_delete_cascade.sql) to also remove any associated
// return/exchange record automatically.
//
// Important, and this is exactly why the frontend shows a detailed
// warning before calling this: if that return had credited a
// customer's gift card, deleting the return's audit record here does
// NOT reverse that balance. pos_customers.gift_card_balance is a
// separate running total, untouched by this cascade — the customer
// keeps whatever credit they were given, only the record explaining
// where it came from is gone.
const { verifyAdminToken } = require('./_admin-auth');

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

  if (!verifyAdminToken(body.adminToken)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Session expired, please log in again' }) };
  }

  if (!body.saleId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing sale id' }) };
  }

  try {
    var res = await fetch(`${SUPABASE_URL}/rest/v1/pos_sales?id=eq.${encodeURIComponent(body.saleId)}`, {
      method: 'DELETE',
      headers: Object.assign({}, supabaseHeaders(), { 'Prefer': 'return=representation' })
    });
    if (!res.ok) {
      var errText = await res.text();
      console.error('admin-delete-pos-sale: Supabase delete failed:', errText);
      throw new Error(`Supabase delete failed: ${res.status}`);
    }
    var deleted = await res.json();
    if (!deleted.length) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Sale not found' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (e) {
    console.error('admin-delete-pos-sale error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not delete this sale' }) };
  }
};
