// netlify/functions/admin-get-orders.js
//
// POST { adminToken }
// - Returns all orders, most recent first, for the admin Orders tab.
// - Each order also carries a `returns` array (possibly empty) of its
//   order_returns rows, so the Orders tab can grey out items already
//   returned and net refunded amounts out of revenue, without a
//   second round trip from the browser.

const { verifyAdminToken } = require('./_admin-auth');

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

  const session = verifyAdminToken(body.adminToken);
  if (!session) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authorized. Please sign in again.' }) };
  }

  try {
    const headers = {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    };

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?select=*&order=created_at.desc&limit=500`,
      { headers: headers }
    );
    if (!res.ok) throw new Error(`Supabase error ${res.status}`);
    const orders = await res.json();

    // Best-effort: if this lookup fails for any reason, orders still
    // load — they just show without their return history rather than
    // not loading at all.
    let returnsByOrder = {};
    try {
      const returnsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/order_returns?select=order_id,items_returned,refund_amount,refund_method,processed_by,created_at&order=created_at.asc`,
        { headers: headers }
      );
      if (returnsRes.ok) {
        const returns = await returnsRes.json();
        returns.forEach(function (r) {
          if (!returnsByOrder[r.order_id]) returnsByOrder[r.order_id] = [];
          returnsByOrder[r.order_id].push(r);
        });
      }
    } catch (e) {
      console.error('Could not load order_returns (orders will show without return history):', e);
    }

    orders.forEach(function (o) {
      o.returns = returnsByOrder[o.id] || [];
    });

    return { statusCode: 200, body: JSON.stringify({ orders: orders }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load orders: ' + err.message }) };
  }
};
