// netlify/functions/add-to-cart.js
//
// POST { visitorToken, sareeId, qty }
// - Verifies the token, then upserts a row into cart_items for that
//   email + saree. Relies on the unique (email, saree_id) constraint
//   on the table -- a resend for something already in the cart
//   updates its qty (merge-duplicates) rather than erroring or
//   creating a duplicate row.
// - qty is optional and defaults to 1; nothing today sends anything
//   else, this is here for the Stage 3 quantity picker to use.

const { verifyVisitorToken } = require('./_visitor-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Records "the cart was just changed" for the abandoned-cart offers.
// Never allowed to break adding to cart.
async function touchCart(email) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/verified_visitors?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cart_updated_at: new Date().toISOString() })
    });
  } catch (e) { console.error('touchCart failed:', e); }
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

  const payload = verifyVisitorToken(body.visitorToken);
  if (!payload) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not verified or session expired.' }) };
  }

  const sareeId = (body.sareeId || '').trim();
  if (!sareeId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'sareeId is required.' }) };
  }

  const qtyNum = parseInt(body.qty, 10);
  const qty = (Number.isInteger(qtyNum) && qtyNum > 0) ? qtyNum : 1;

  try {
    // Only treat this as cart "activity" if it really changes the cart
    // (a new item or a different qty). Background syncs re-send items
    // that are already there and must not restart the idle clock.
    let changed = true;
    try {
      const ex = await fetch(`${SUPABASE_URL}/rest/v1/cart_items?email=eq.${encodeURIComponent(payload.email)}&saree_id=eq.${encodeURIComponent(sareeId)}&select=qty`, {
        headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
      });
      if (ex.ok) {
        const rows = await ex.json();
        if (rows.length && Number(rows[0].qty) === qty) changed = false;
      }
    } catch (e) { /* default to treating it as a change */ }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/cart_items?on_conflict=email,saree_id`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        // Upsert on the unique (email, saree_id) constraint. Changed
        // from ignore-duplicates to merge-duplicates so that if this
        // is ever called again for an item already in the cart (e.g.
        // a future "change quantity" flow), it updates qty instead of
        // silently doing nothing -- today nothing resends with a
        // different qty, so this is a no-behavior-change-yet switch.
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ email: payload.email, saree_id: sareeId, qty: qty })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase error ${res.status}: ${text}`);
    }
    if (changed) await touchCart(payload.email);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('add-to-cart failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong.' }) };
  }
};
