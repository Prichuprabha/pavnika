// netlify/functions/unsubscribe-offers.js
//
// POST { token }                 from the unsubscribe page
// POST ?t=<token>                one-click unsubscribe from a mail app
//                                (the List-Unsubscribe-Post standard)
// GET  ?t=<token>                just sends the person to the page
// Turns the customer's "send me offers" choice off.

const { verify } = require('./_unsub-token');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async function (event) {
  const qs = event.queryStringParameters || {};
  if (event.httpMethod === 'GET') {
    return { statusCode: 302, headers: { Location: '/unsubscribe.html?t=' + encodeURIComponent(qs.t || '') }, body: '' };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let token = qs.t || '';
  try {
    const b = JSON.parse(event.body || '{}');
    if (b && b.token) token = b.token;
  } catch (e) { /* one-click posts send form data; the token is in the URL */ }

  let email = null;
  try { email = verify(token); } catch (e) { console.error('unsubscribe verify failed:', e); }
  if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'This unsubscribe link is not valid.' }) };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/verified_visitors?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ marketing_opt_in: false, marketing_opt_in_at: null })
    });
    if (!res.ok) throw new Error('Supabase error ' + res.status + ': ' + await res.text());
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('unsubscribe-offers failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
