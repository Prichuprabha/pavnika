// netlify/functions/admin-login.js
//
// POST { username, password }
// Verifies against the admin_users table (server-side only — the actual
// password/hash never reaches the browser) and, on success, returns a
// signed adminToken the admin panel uses to authenticate write requests.
// Same password-hashing approach as pos-login.js (scrypt, salted,
// timing-safe comparison) via the shared _pos-auth.js helper.

const { verifyPassword } = require('./_pos-auth');
const { signAdminToken } = require('./_admin-auth');

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
      `${SUPABASE_URL}/rest/v1/admin_users?username=eq.${encodeURIComponent(username)}&active=eq.true&select=*`,
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

    var token = signAdminToken(user.id, user.username, user.display_name);
    return {
      statusCode: 200,
      body: JSON.stringify({ token: token, displayName: user.display_name, username: user.username })
    };
  } catch (e) {
    console.error('admin-login error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong, please try again' }) };
  }
};
