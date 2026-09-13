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

  if (!body.id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing user id' }) };
  }

  try {
    // Refuse to delete the last remaining active admin — this table is
    // the only way into this panel now, so letting it hit zero would
    // lock everyone out with no way back in short of editing Supabase
    // directly.
    var countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/admin_users?active=eq.true&select=id`,
      { headers: supabaseHeaders() }
    );
    if (!countRes.ok) throw new Error(`Supabase query failed: ${countRes.status}`);
    var activeAdmins = await countRes.json();
    var isDeletingAnActiveAdmin = activeAdmins.some(function (u) { return u.id === body.id; });
    if (isDeletingAnActiveAdmin && activeAdmins.length <= 1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Can\u2019t delete the last remaining admin \u2014 create another admin account first.' }) };
    }

    var res = await fetch(`${SUPABASE_URL}/rest/v1/admin_users?id=eq.${encodeURIComponent(body.id)}`, {
      method: 'DELETE',
      headers: supabaseHeaders()
    });
    if (!res.ok) throw new Error(`Supabase delete failed: ${res.status}`);
    return { statusCode: 200, body: JSON.stringify({ deleted: true }) };
  } catch (e) {
    console.error('admin-delete-admin-user error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
