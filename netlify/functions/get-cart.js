// netlify/functions/get-cart.js
//
// POST { visitorToken }
// - Verifies the token, then returns { items: [sareeId, sareeId, ...] }
//   for that email's saved cart. This is what lets the cart follow a
//   person to a different device, rather than staying on whichever
//   browser they first added something from.

const { verifyVisitorToken } = require('./_visitor-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  const payload = verifyVisitorToken(body.visitorToken);
  if (!payload) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not verified or session expired.' }) };
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cart_items?email=eq.${encodeURIComponent(payload.email)}&select=saree_id`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );
    if (!res.ok) throw new Error(`Supabase error ${res.status}`);
    const rows = await res.json();
    return { statusCode: 200, body: JSON.stringify({ items: rows.map(function (r) { return r.saree_id; }) }) };
  } catch (err) {
    console.error('get-cart failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong.' }) };
  }
};
