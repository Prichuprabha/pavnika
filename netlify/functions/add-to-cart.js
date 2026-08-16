// netlify/functions/add-to-cart.js
//
// POST { visitorToken, sareeId }
// - Verifies the token, then upserts a row into cart_items for that
//   email + saree. Relies on the unique (email, saree_id) constraint
//   on the table so adding something already in the cart is a safe
//   no-op rather than a duplicate row.

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

  const sareeId = (body.sareeId || '').trim();
  if (!sareeId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'sareeId is required.' }) };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/cart_items?on_conflict=email,saree_id`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        // Upsert on the unique (email, saree_id) constraint — adding
        // an item already in the cart just does nothing, rather than
        // erroring or creating a duplicate row.
        'Prefer': 'resolution=ignore-duplicates'
      },
      body: JSON.stringify({ email: payload.email, saree_id: sareeId })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase error ${res.status}: ${text}`);
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('add-to-cart failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong.' }) };
  }
};
