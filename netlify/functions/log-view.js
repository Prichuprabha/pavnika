// netlify/functions/log-view.js
//
// POST { productId }
// - Records that a saree's detail popup was opened, for the admin
//   "most viewed sarees" stat. Fire-and-forget from the client — the
//   site doesn't wait on this or block on its result.

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
    await fetch(`${SUPABASE_URL}/rest/v1/saree_views`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ product_id: productId })
    });
  } catch (err) {
    console.error('log-view failed:', err);
  }

  // Always respond 200 quickly — a logging failure should never surface
  // to the visitor or affect the actual saree popup they're looking at.
  return { statusCode: 200, body: '{}' };
};
