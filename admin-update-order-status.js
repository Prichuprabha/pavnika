// netlify/functions/admin-update-order-status.js
//
// POST { adminToken, orderId, status?, paymentMethod? }
// - Updates an order's status (e.g. paid, shipped, payment_error,
//   cancelled) and/or its payment method (Cash, Bank Transfer,
//   Electronic) from the admin Orders tab — at least one of the two
//   must be given, but neither requires the other.
// - 'refunded', 'refunded_giftcard' and 'partially_refunded' are
//   deliberately NOT settable here (ALLOWED_STATUSES below) — they
//   used to be, with this function crediting the gift card / sending
//   a refund email directly, entirely independent of Process Return's
//   item-level, qty-aware, discount-prorated math. That let an order
//   get refunded twice, by two different paths, for two different
//   amounts. All refunds now go through admin-process-order-return.js
//   (Process Return in the order drawer) only, which sets these three
//   statuses itself once the refund is actually processed.
// - Payment method is deliberately just these three broad categories
//   (not, say, "Visa" vs "Mastercard", or which gateway was used) —
//   it exists so revenue can be split into cash collected, bank
//   transfers, and electronic/gateway payments (the latter being what
//   a % processing fee would apply to), not to replace the raw
//   payment_method detail Nomod itself already records at checkout.

const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'delivered_direct_pay', 'cod_pending', 'payment_error', 'cancelled'];
const ALLOWED_PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Electronic'];

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
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

  const orderId = body.orderId;
  const status = body.status;
  const paymentMethod = body.paymentMethod;
  const hasStatus = status !== undefined && status !== null && status !== '';
  const hasPaymentMethod = paymentMethod !== undefined && paymentMethod !== null && paymentMethod !== '';

  if (!orderId || (!hasStatus && !hasPaymentMethod)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid order ID, or nothing to update.' }) };
  }
  if (hasStatus && ALLOWED_STATUSES.indexOf(status) === -1) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid status.' }) };
  }
  if (hasPaymentMethod && ALLOWED_PAYMENT_METHODS.indexOf(paymentMethod) === -1) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid payment method.' }) };
  }

  try {
    const patch = {};
    if (hasStatus) patch.status = status;
    if (hasPaymentMethod) patch.payment_method = paymentMethod;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(patch)
    });
    if (!res.ok) throw new Error(`Supabase error ${res.status}`);

    const updatedRows = await res.json();
    if (!updatedRows.length) {
      // The HTTP request itself succeeded, but matched zero rows — this
      // would otherwise silently report "success" while nothing in the
      // database actually changed, which is exactly what made this bug
      // so hard to notice in the first place.
      return { statusCode: 404, body: JSON.stringify({ error: 'No order found with that ID — nothing was updated.' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, order: updatedRows[0] }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update order: ' + err.message }) };
  }
};
