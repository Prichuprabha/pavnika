// netlify/functions/admin-update-order-status.js
//
// POST { adminToken, orderId, status }
// - Updates an order's status (e.g. paid, shipped, payment_error,
//   cancelled) from the admin Orders tab.

const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'payment_error', 'cancelled', 'refunded'];

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

  const orderId = body.orderId;
  const status = body.status;

  if (!orderId || ALLOWED_STATUSES.indexOf(status) === -1) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid order ID or status.' }) };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: status })
    });
    if (!res.ok) throw new Error(`Supabase error ${res.status}`);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update order: ' + err.message }) };
  }
};
