const { verifyAdminToken } = require('./_admin-auth');
const { hashPassword } = require('./_pos-auth');

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

  if (!verifyAdminToken(body.adminToken)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Session expired, please log in again' }) };
  }

  var username = (body.username || '').trim();
  var password = body.password || '';
  var displayName = (body.displayName || '').trim() || username;

  if (!username || !password) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Username and password are required' }) };
  }
  if (password.length < 6) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Password must be at least 6 characters' }) };
  }

  try {
    var existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_users?username=eq.${encodeURIComponent(username)}&select=id`,
      { headers: supabaseHeaders() }
    );
    var existingRows = await existingRes.json();
    if (existingRows.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That username is already in use' }) };
    }

    var hashed = hashPassword(password);
    var res = await fetch(`${SUPABASE_URL}/rest/v1/pos_users`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        username: username,
        password_hash: hashed.hash,
        password_salt: hashed.salt,
        display_name: displayName,
        active: true,
        is_admin: !!body.isAdmin
      })
    });
    if (!res.ok) throw new Error(`Supabase insert failed: ${res.status}`);
    var rows = await res.json();
    var user = rows[0];
    return { statusCode: 200, body: JSON.stringify({ user: { id: user.id, username: user.username, display_name: user.display_name, active: user.active, is_admin: user.is_admin, created_at: user.created_at } }) };
  } catch (e) {
    console.error('admin-create-pos-user error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
