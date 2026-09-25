// netlify/functions/admin-lookup-gift-card-balance.js
//
// POST { adminToken, email, phone }
// - Looks up a customer's current store credit (gift card) balance,
//   matched the same way every other gift-card flow in this codebase
//   matches a customer: by email first, then by the last 9 digits of
//   phone. Powers the "Apply store credit" checkbox on the Manual
//   Order page, purely for display before submitting — the actual
//   amount applied is always recomputed and re-validated server-side
//   at order-creation time (admin-create-manual-order.js), never
//   trusted from this lookup or from the browser.
const { verifyAdminToken } = require('./_admin-auth');
const { supabaseHeaders } = require('./_order-shared');

const SUPABASE_URL = process.env.SUPABASE_URL;

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

  const email = (body.email || '').trim();
  const phone = (body.phone || '').trim();
  if (!email && !phone) {
    return { statusCode: 200, body: JSON.stringify({ found: false, balance: 0 }) };
  }

  try {
    let matched = null;
    if (email) {
      const byEmailRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?email=eq.${encodeURIComponent(email)}&select=id,gift_card_balance`, { headers: supabaseHeaders() });
      const byEmail = await byEmailRes.json();
      if (byEmail.length) matched = byEmail[0];
    }
    if (!matched && phone) {
      const digitsOnly = phone.replace(/\D/g, '').slice(-9);
      if (digitsOnly) {
        const byPhoneRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?phone=ilike.${encodeURIComponent('%' + digitsOnly)}&select=id,gift_card_balance`, { headers: supabaseHeaders() });
        const byPhone = await byPhoneRes.json();
        if (byPhone.length) matched = byPhone[0];
      }
    }

    if (!matched) {
      return { statusCode: 200, body: JSON.stringify({ found: false, balance: 0 }) };
    }

    return { statusCode: 200, body: JSON.stringify({ found: true, balance: Number(matched.gift_card_balance) || 0 }) };
  } catch (err) {
    console.error('admin-lookup-gift-card-balance failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong: ' + err.message }) };
  }
};
