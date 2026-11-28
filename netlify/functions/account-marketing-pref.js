// netlify/functions/account-marketing-pref.js
//
// POST { visitorToken, action: 'get' }            -> { optIn }
// POST { visitorToken, action: 'set', optIn: bool } -> { optIn }
// Lets a signed-in customer see / change their "send me offers" choice.

const { verifyVisitorToken } = require('./_visitor-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const H = {
  'apikey': SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json'
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }
  const payload = verifyVisitorToken(body.visitorToken);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ error: 'Not verified or session expired.' }) };
  const email = String(payload.email).toLowerCase();
  const q = `${SUPABASE_URL}/rest/v1/verified_visitors?email=eq.${encodeURIComponent(email)}`;

  try {
    if (body.action === 'set') {
      const optIn = body.optIn === true;
      const res = await fetch(q, {
        method: 'PATCH',
        headers: { ...H, 'Prefer': 'return=representation' },
        body: JSON.stringify({ marketing_opt_in: optIn, marketing_opt_in_at: optIn ? new Date().toISOString() : null })
      });
      if (!res.ok) throw new Error('Supabase error ' + res.status + ': ' + await res.text());
      return { statusCode: 200, body: JSON.stringify({ optIn: optIn }) };
    }
    const res = await fetch(q + '&select=marketing_opt_in', { headers: H });
    if (!res.ok) throw new Error('Supabase error ' + res.status + ': ' + await res.text());
    const rows = await res.json();
    return { statusCode: 200, body: JSON.stringify({ optIn: !!(rows[0] && rows[0].marketing_opt_in) }) };
  } catch (err) {
    console.error('account-marketing-pref failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong.' }) };
  }
};
