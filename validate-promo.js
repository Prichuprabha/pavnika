// netlify/functions/admin-get-promos.js
//
// POST { adminToken }
// - Returns currently active (unexpired, unused) codes, and recent
//   history (used or expired) for the admin promo codes screen.

const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function supabaseFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
  return res.json();
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const session = verifyAdminToken(body.adminToken);
  if (!session) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authorized. Please sign in again.' }) };
  }

  try {
    const all = await supabaseFetch('promo_codes?select=*&order=created_at.desc&limit=100');
    const now = Date.now();

    const active = all.filter(function (p) {
      return p.active && !p.used && new Date(p.expires_at).getTime() > now;
    });
    const history = all.filter(function (p) {
      return !active.includes(p);
    }).slice(0, 30);

    return { statusCode: 200, body: JSON.stringify({ active: active, history: history }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load promo codes: ' + err.message }) };
  }
};
