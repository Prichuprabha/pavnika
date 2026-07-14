// netlify/functions/get-cart-interest.js
//
// POST { productIds: ["VW001", "SU003", ...] }
// - Returns how many cart-add events happened for each of those sarees
//   in the last hour, e.g. { "VW001": 3, "SU003": 1 }. IDs with zero
//   recent activity are simply omitted from the response.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WINDOW_MS = 60 * 60 * 1000; // last 1 hour

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({}) };
  }

  const productIds = Array.isArray(body.productIds) ? body.productIds.filter(Boolean) : [];
  if (!productIds.length) {
    return { statusCode: 200, body: JSON.stringify({}) };
  }

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const idList = productIds.map(function (id) { return encodeURIComponent(id); }).join(',');

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cart_activity?select=product_id&product_id=in.(${idList})&created_at=gte.${since}`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );
    if (!res.ok) throw new Error(`Supabase error ${res.status}`);
    const rows = await res.json();

    const counts = {};
    rows.forEach(function (r) {
      counts[r.product_id] = (counts[r.product_id] || 0) + 1;
    });

    return { statusCode: 200, body: JSON.stringify(counts) };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, body: JSON.stringify({}) };
  }
};
