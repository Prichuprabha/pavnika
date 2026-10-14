// netlify/functions/admin-set-delivery-method.js
//
// POST { adminToken, channel, id, method, customCost? }
// - channel: 'online' (orders table) or 'shop' (pos_sales table)
// - method: 'partner' | 'own' | 'other'
// - For 'partner'/'own', looks up the CURRENT delivery_rates row and
//   snapshots that method's rate onto the order/sale as delivery_cost --
//   a one-time copy, not a live reference. Changing delivery_rates
//   later never changes an order/sale that already has a method set;
//   picking (or re-picking) a method here is the only thing that
//   updates it, using whatever rate is in force at that moment.
// - For 'other', there is no stored rate at all -- the caller supplies
//   customCost (typed in fresh each time, e.g. from the "how was this
//   delivered?" prompt shown when an order is marked Delivered), and
//   that exact value is snapshotted instead. This is what gives
//   "Other" the flexibility to vary per delivery.
// - Same-origin only (admin.html, from the order/sale detail drawer) --
//   no CORS needed here.

const { verifyAdminToken } = require('./_admin-auth');
const { fetchDeliveryRates } = require('./_order-shared');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_METHODS = ['partner', 'own', 'other'];
const RATE_FIELD = { partner: 'partner_rate', own: 'own_rate', other: 'other_rate' };
const TABLE_BY_CHANNEL = { online: 'orders', shop: 'pos_sales' };

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

  if (!verifyAdminToken(body.adminToken)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authorized. Please sign in again.' }) };
  }

  const table = TABLE_BY_CHANNEL[body.channel];
  const method = body.method;
  const id = body.id;
  if (!table || !id || ALLOWED_METHODS.indexOf(method) === -1) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid channel, ID, or delivery method.' }) };
  }

  let cost;
  if (method === 'other') {
    cost = Number(body.customCost);
    if (isNaN(cost) || cost < 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Enter a valid amount (0 or more) for Other.' }) };
    }
  }

  try {
    if (method !== 'other') {
      const rates = await fetchDeliveryRates();
      cost = Number(rates[RATE_FIELD[method]]) || 0;
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify({ delivery_method: method, delivery_cost: cost })
    });
    if (!res.ok) throw new Error(`Supabase error ${res.status}`);

    const updatedRows = await res.json();
    if (!updatedRows.length) {
      return { statusCode: 404, body: JSON.stringify({ error: 'No matching order/sale found — nothing was updated.' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, deliveryMethod: method, deliveryCost: cost }) };
  } catch (err) {
    console.error('admin-set-delivery-method error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not set delivery method: ' + err.message }) };
  }
};
