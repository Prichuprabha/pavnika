// netlify/functions/validate-promo.js
//
// POST { code }
// - Checks the code exists, hasn't expired, hasn't already been used,
//   and is active, and returns the discount percentage if so.
// - Does NOT mark the code as used here — that only happens once a
//   payment actually succeeds (see verify-nomod-order.js). Consuming
//   it at apply-time would permanently burn a code even if the
//   customer abandons checkout or cancels payment on Nomod's page.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function headers() {
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
    return { statusCode: 400, body: JSON.stringify({ valid: false, error: 'Invalid request.' }) };
  }

  const code = (body.code || '').trim().toUpperCase();
  if (!code) {
    return { statusCode: 400, body: JSON.stringify({ valid: false, error: 'Please enter a code.' }) };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/promo_codes?code=eq.${encodeURIComponent(code)}`, {
      headers: headers()
    });
    if (!res.ok) throw new Error(`Supabase error ${res.status}`);
    const rows = await res.json();

    if (!rows.length) {
      return { statusCode: 200, body: JSON.stringify({ valid: false, error: 'That code was not found.' }) };
    }

    const promo = rows[0];

    if (promo.used) {
      return { statusCode: 200, body: JSON.stringify({ valid: false, error: 'That code has already been used.' }) };
    }
    if (!promo.active) {
      return { statusCode: 200, body: JSON.stringify({ valid: false, error: 'That code is no longer active.' }) };
    }
    if (new Date(promo.expires_at).getTime() < Date.now()) {
      return { statusCode: 200, body: JSON.stringify({ valid: false, error: 'That code has expired.' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ valid: true, discountPercent: promo.discount_percent, code: promo.code })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ valid: false, error: 'Something went wrong. Please try again.' }) };
  }
};
