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

  var session = verifyPosToken(body.posToken);
  if (!session) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Session expired, please log in again' }) };
  }

  if (!Array.isArray(body.cart) || !body.cart.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Cannot park an empty cart' }) };
  }

  try {
    var res = await fetch(`${SUPABASE_URL}/rest/v1/pos_held_sales`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        cart_json: body.cart,
        customer_json: body.customer || null,
        discount_type: body.discountType || 'percent',
        discount_value: body.discountValue || 0,
        coupon_code: body.couponCode || null,
        notes: body.notes || null,
        held_by: session.displayName
      })
    });
    if (!res.ok) throw new Error(`Supabase insert failed: ${res.status}`);
    var rows = await res.json();
    return { statusCode: 200, body: JSON.stringify({ heldSale: rows[0] }) };
  } catch (e) {
    console.error('pos-hold-sale error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
