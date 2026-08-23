// Verifies a specific POS user's password without issuing a new
// session token — used for confirming identity mid-transaction (e.g.
// switching who's credited as Sales Person on this bill), not for
// actually logging in as them.
const { verifyPosToken, verifyPassword } = require('./_pos-auth');

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

  // Requires an already-active POS session (someone must be logged in
  // to switch sales person mid-transaction) — this just confirms the
  // *target* user's password, it doesn't authenticate the request itself.
  if (!verifyPosToken(body.posToken)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Session expired, please log in again' }) };
  }

  var username = (body.username || '').trim();
  var password = body.password || '';
  if (!username || !password) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Username and password are required' }) };
  }

  try {
    var res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_users?username=eq.${encodeURIComponent(username)}&active=eq.true&select=*`,
      { headers: supabaseHeaders() }
    );
    if (!res.ok) throw new Error(`Supabase lookup failed: ${res.status}`);
    var rows = await res.json();
    var user = rows[0];

    if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Incorrect password' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ verified: true, displayName: user.display_name }) };
  } catch (e) {
    console.error('pos-verify-user-password error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
