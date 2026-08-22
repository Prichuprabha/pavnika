const { verifyPassword, signPosToken } = require('./_pos-auth');

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

    // Same error message whether the username doesn't exist or the
    // password is wrong — doesn't reveal which one it was, so this
    // can't be used to check which usernames are valid.
    if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid username or password' }) };
    }

    var token = signPosToken(user.id, user.username, user.display_name);
    return {
      statusCode: 200,
      body: JSON.stringify({ token: token, displayName: user.display_name, username: user.username })
    };
  } catch (e) {
    console.error('pos-login error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong, please try again' }) };
  }
};
