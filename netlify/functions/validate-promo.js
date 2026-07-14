// netlify/functions/validate-promo.js
//
// POST { code }
// - Checks the code exists, hasn't expired, hasn't already been used,
//   and is active. If valid, marks it used immediately (codes are
//   single-use — the act of successfully applying it consumes it) and
//   returns the discount percentage.

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

    // Valid — mark it used right away, since it's single-use.
    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/promo_codes?id=eq.${promo.id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ used: true })
    });
    if (!updateRes.ok) throw new Error(`Supabase update error ${updateRes.status}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ valid: true, discountPercent: promo.discount_percent, code: promo.code })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ valid: false, error: 'Something went wrong. Please try again.' }) };
  }
};
