// netlify/functions/lookup-gift-card-balance.js
//
// POST { visitorToken }
// - Returns the current signed-in visitor's own store credit balance,
//   for the "Apply my store credit" checkbox on checkout.html.
// - Deliberately requires a genuine signed visitorToken (see
//   _visitor-auth.js) rather than the plain, forgeable pavnika_email
//   cookie the rest of checkout otherwise reads — this endpoint deals
//   in real money, so the email it looks up MUST come from inside the
//   cryptographically verified token, never from a value a visitor
//   could set themselves via document.cookie in the browser console.
// - Matches by email ONLY, not phone. Phone on the checkout form is
//   just typed in, unverified — matching by it here would let anyone
//   who knows a customer's phone number see (and later redeem) their
//   balance simply by typing that number into the order form.
// - Purely informational: the actual amount applied is always
//   recomputed and re-validated again in create-nomod-checkout.js at
//   the moment of payment, never trusted from this lookup.
const { verifyVisitorToken } = require('./_visitor-auth');
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

  const session = verifyVisitorToken(body.visitorToken);
  if (!session) {
    // Not an error — plenty of visitors reach checkout without ever
    // having verified (verification is optional until checkout), so
    // this is just "no credit to show," not a failure.
    return { statusCode: 200, body: JSON.stringify({ found: false, balance: 0 }) };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?email=eq.${encodeURIComponent(session.email)}&select=gift_card_balance`, { headers: supabaseHeaders() });
    if (!res.ok) throw new Error(`Supabase error ${res.status}`);
    const rows = await res.json();
    const balance = (rows[0] && Number(rows[0].gift_card_balance)) || 0;

    return { statusCode: 200, body: JSON.stringify({ found: balance > 0, balance: balance }) };
  } catch (err) {
    console.error('lookup-gift-card-balance failed:', err);
    return { statusCode: 200, body: JSON.stringify({ found: false, balance: 0 }) };
  }
};
