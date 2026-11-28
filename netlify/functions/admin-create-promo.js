// netlify/functions/admin-create-promo.js
//
// POST { adminToken, discountPercent }
// - Optional: validFor ('10m' default, '24h', '3d', '7d') and email
//   (ties the code to one customer; checked at checkout).
// - Generates a random single-use promo code, valid for 10 minutes
//   by default, and stores it in Supabase. Several codes can be active at once,
//   for different customers.

const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TTL = { '10m': 10 * 60 * 1000, '24h': 24 * 60 * 60 * 1000, '3d': 3 * 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000 };

function randomSuffix() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  var out = '';
  for (var i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
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

  const discount = parseInt(body.discountPercent, 10);
  if (!discount || discount < 1 || discount > 95) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please provide a valid discount percentage (1-95).' }) };
  }

  const code = 'SAVE' + discount + '-' + randomSuffix();
  const ttl = TTL[body.validFor] || TTL['10m'];
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  const boundEmail = body.email ? String(body.email).trim().toLowerCase() : null;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/promo_codes`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        code: code,
        discount_percent: discount,
        expires_at: expiresAt,
        used: false,
        active: true,
        ...(boundEmail ? { email: boundEmail } : {})
      })
    });
    if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
    const created = await res.json();

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, promo: created[0] })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create promo code: ' + err.message }) };
  }
};
