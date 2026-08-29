// Toggles a POS user's admin flag from the admin panel's POS Users
// section — controls access to the POS Settings section (Sales
// History, Customer Database).
const { verifyAdminToken } = require('./_admin-auth');

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

  if (!body.id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing user id' }) };
  }

  try {
    var res = await fetch(`${SUPABASE_URL}/rest/v1/pos_users?id=eq.${encodeURIComponent(body.id)}`, {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify({ is_admin: !!body.isAdmin })
    });
    if (!res.ok) throw new Error(`Supabase update failed: ${res.status}`);
    var rows = await res.json();
    if (!rows.length) return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };
    return { statusCode: 200, body: JSON.stringify({ user: rows[0] }) };
  } catch (e) {
    console.error('admin-toggle-pos-admin error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
