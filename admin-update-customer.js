// netlify/functions/admin-update-customer.js
//
// POST { adminToken, customerId?, originalEmail?, name, email, phone }
// - Updates a customer's name/email/phone only — gift_card_balance is
//   deliberately never accepted here. It can only ever change through
//   an actual return or redemption (see admin-process-order-return.js,
//   create-nomod-checkout.js, resume-nomod-checkout.js), each of which
//   keeps its own record of why the balance moved; a free-text edit
//   here would bypass that trail entirely.
// - customerId present -> updates that existing pos_customers row.
// - customerId absent -> this is a customer who has only ever bought
//   online and has no pos_customers row yet (see admin-list-customers.js);
//   one is created now, with gift_card_balance starting at 0, exactly
//   as if their first return or in-store visit had created it.
// - originalEmail is used only to avoid creating a duplicate row if the
//   same online-only customer is edited twice in a row before the page
//   is refreshed — it does not identify who's allowed to be edited.
const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
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

  const name = (body.name || '').trim();
  const email = (body.email || '').trim();
  const phone = (body.phone || '').trim();
  if (!name && !email && !phone) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Nothing to update.' }) };
  }

  try {
    if (body.customerId) {
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${encodeURIComponent(body.customerId)}`, {
        method: 'PATCH',
        headers: Object.assign({}, supabaseHeaders(), { 'Prefer': 'return=representation' }),
        body: JSON.stringify({ name: name, email: email, phone: phone })
      });
      if (!patchRes.ok) throw new Error(`Update failed: ${patchRes.status}`);
      const updated = (await patchRes.json())[0];
      if (!updated) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Customer not found.' }) };
      }
      return { statusCode: 200, body: JSON.stringify({ success: true, customerId: updated.id }) };
    }

    // No pos_customers row yet — this is an online-only customer's
    // first edit. Create their record now rather than requiring one
    // to already exist.
    const createRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers`, {
      method: 'POST',
      headers: Object.assign({}, supabaseHeaders(), { 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        name: name || 'Customer',
        email: email || null,
        phone: phone.replace(/\D/g, '') || '0000000000',
        phone_country_code: '+971',
        gift_card_balance: 0
      })
    });
    if (!createRes.ok) throw new Error(`Create failed: ${createRes.status}`);
    const created = (await createRes.json())[0];
    return { statusCode: 200, body: JSON.stringify({ success: true, customerId: created.id }) };
  } catch (err) {
    console.error('admin-update-customer failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong: ' + err.message }) };
  }
};
