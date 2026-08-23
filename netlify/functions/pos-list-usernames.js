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

  try {
    var res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_users?active=eq.true&select=username,display_name&order=display_name.asc`,
      { headers: supabaseHeaders() }
    );
    if (!res.ok) throw new Error(`Supabase query failed: ${res.status}`);
    var users = await res.json();
    return { statusCode: 200, body: JSON.stringify({ users: users }) };
  } catch (e) {
    console.error('pos-list-usernames error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
