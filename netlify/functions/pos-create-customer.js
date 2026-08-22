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

  var name = (body.name || '').trim();
  var phone = (body.phone || '').trim();
  if (!name || !phone) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Name and mobile number are required' }) };
  }

  try {
    var res = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        name: name,
        phone: phone,
        phone_country_code: body.phoneCountryCode || '+971',
        email: body.email || null,
        emirate: body.emirate || null,
        address: body.address || null
      })
    });
    if (!res.ok) throw new Error(`Supabase insert failed: ${res.status}`);
    var rows = await res.json();
    return { statusCode: 200, body: JSON.stringify({ customer: rows[0] }) };
  } catch (e) {
    console.error('pos-create-customer error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong, please try again' }) };
  }
};
