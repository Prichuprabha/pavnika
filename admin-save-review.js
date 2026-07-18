// netlify/functions/log-cart-activity.js
//
// POST { productId }
// - Records that someone added a saree to their cart, purely for the
//   "X people have this in their cart" indicator. Fire-and-forget.

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
    return { statusCode: 400, body: '{}' };
  }

  const productId = (body.productId || '').trim();
  if (!productId) {
    return { statusCode: 400, body: '{}' };
  }

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/cart_activity`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ product_id: productId })
    });
  } catch (err) {
    console.error('log-cart-activity failed:', err);
  }

  return { statusCode: 200, body: '{}' };
};
