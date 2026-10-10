// netlify/functions/admin-adjust-gift-card-balance.js
//
// POST { adminToken, customerId, newBalance, reason }
//
// One of two admin-gated places a gift_card_balance can be
// hand-edited outside of an actual return (admin-process-order-return.js,
// pos-process-return.js) or checkout redemption -- this one is for
// the admin.html Customers tab. The other is pos-update-customer.js
// (POS Settings -> Customer Database), which does the same thing for
// POS staff. admin-update-customer.js still refuses to touch this
// field at all, since a plain contact-details edit there has no
// reason field and shouldn't be able to silently move money.
//
// Both of this function's siblings write to the same gift_card_adjustments
// table (one row per adjustment: before/after/delta/reason/who/source),
// so a hand-edit from EITHER place is still fully accountable, never
// silent, however it was made.
//
// A reason is required (not just a nicety -- enforced below) because
// an unexplained balance change is exactly the kind of thing that's
// impossible to make sense of later.
const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  const customerId = body.customerId;
  const newBalance = Math.round((Number(body.newBalance) || 0) * 100) / 100;
  const reason = (body.reason || '').trim();

  if (!customerId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing customer.' }) };
  }
  if (!Number.isFinite(newBalance) || newBalance < 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Enter a valid balance of 0 or more.' }) };
  }
  if (!reason) {
    return { statusCode: 400, body: JSON.stringify({ error: 'A reason is required so this change has a record of why.' }) };
  }

  try {
    const custRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${encodeURIComponent(customerId)}&select=id,gift_card_balance`, { headers: supabaseHeaders() });
    if (!custRes.ok) throw new Error(`Supabase error ${custRes.status}`);
    const custRows = await custRes.json();
    if (!custRows.length) return { statusCode: 404, body: JSON.stringify({ error: 'Customer not found.' }) };
    const previousBalance = Number(custRows[0].gift_card_balance) || 0;
    const delta = Math.round((newBalance - previousBalance) * 100) / 100;

    if (delta === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That’s already the current balance -- nothing to change.' }) };
    }

    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${encodeURIComponent(customerId)}`, {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify({ gift_card_balance: newBalance })
    });
    if (!patchRes.ok) throw new Error(`Update failed: ${patchRes.status}`);

    const logRes = await fetch(`${SUPABASE_URL}/rest/v1/gift_card_adjustments`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        customer_id: customerId,
        previous_balance: previousBalance,
        new_balance: newBalance,
        delta: delta,
        reason: reason,
        source: 'admin',
        processed_by: session.displayName
      })
    });
    if (!logRes.ok) throw new Error(`Logging the adjustment failed: ${logRes.status}`);
    const logRecord = (await logRes.json())[0];

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, previousBalance: previousBalance, newBalance: newBalance, delta: delta, adjustmentRecord: logRecord })
    };
  } catch (err) {
    console.error('admin-adjust-gift-card-balance failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong: ' + err.message }) };
  }
};
