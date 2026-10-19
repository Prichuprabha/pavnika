// netlify/functions/admin-get-fx-rate.js
//
// POST { adminToken, currency }  (currency: 'INR' | 'USD' | any ISO code)
// - Looks up today's "1 <currency> = ? AED" rate from a free, no-key
//   exchange-rate API, for the Business Expenses form's Currency field
//   in the admin panel (Company -> Business Expenses). The amount typed
//   is still saved exactly as entered either way -- this only prefills
//   the Exchange Rate field so the admin doesn't have to look it up by
//   hand; the field stays a normal text input, so typing over the
//   fetched value always works.
// - Uses open.er-api.com (free, no API key, CORS-enabled) as the
//   primary source. If that's unreachable or doesn't carry AED, returns
//   { rate: null } rather than an error -- a missing live rate isn't a
//   failure the admin needs to see, it's just "enter it yourself".

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

  // Deliberately not gated behind verifyAdminToken: this calls no
  // Supabase/GitHub credentials and returns nothing but a public
  // exchange rate, so failing open here costs nothing and keeps a
  // flaky/expired admin session from blocking an otherwise-working form.
  const currency = (body.currency || '').trim().toUpperCase();
  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    return { statusCode: 200, body: JSON.stringify({ rate: null }) };
  }
  if (currency === 'AED') {
    return { statusCode: 200, body: JSON.stringify({ rate: 1 }) };
  }

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/' + encodeURIComponent(currency));
    if (!res.ok) {
      return { statusCode: 200, body: JSON.stringify({ rate: null }) };
    }
    const data = await res.json();
    const rate = data && data.rates && typeof data.rates.AED === 'number' ? data.rates.AED : null;
    return {
      statusCode: 200,
      body: JSON.stringify({
        rate: rate ? Math.round(rate * 1000000) / 1000000 : null,
        asOf: (data && data.time_last_update_utc) || null
      })
    };
  } catch (err) {
    console.error('admin-get-fx-rate error:', err);
    return { statusCode: 200, body: JSON.stringify({ rate: null }) };
  }
};
