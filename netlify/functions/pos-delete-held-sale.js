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

  if (!verifyPosToken(body.posToken)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Session expired, please log in again' }) };
  }

  if (!body.id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing held sale id' }) };
  }

  try {
    var res = await fetch(`${SUPABASE_URL}/rest/v1/pos_held_sales?id=eq.${encodeURIComponent(body.id)}`, {
      method: 'DELETE',
      headers: supabaseHeaders()
    });
    if (!res.ok) throw new Error(`Supabase delete failed: ${res.status}`);
    return { statusCode: 200, body: JSON.stringify({ deleted: true }) };
  } catch (e) {
    console.error('pos-delete-held-sale error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
