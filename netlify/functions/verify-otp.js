// netlify/functions/verify-otp.js
//
// POST { email, code }
// - Checks the code against Supabase.
// - If it matches and hasn't expired, marks the visitor as verified
//   and returns { verified: true }.
//
// Customer/visitor account verification only — admin login moved to a
// separate username/password flow (see admin-login.js) and no longer
// touches this endpoint at all.

const { signVisitorToken } = require('./_visitor-auth');
const { isTrusted, trust } = require('./_device');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Classic Netlify Functions (this handler style) receive geolocation via
// the x-nf-geo request header, base64-encoded JSON — NOT via context.geo,
// which only applies to the newer Edge/Fetch-style function format.
function getGeoFromEvent(event) {
  try {
    var header = event.headers && (event.headers['x-nf-geo'] || event.headers['X-NF-Geo']);
    if (!header) return { country: null, region: null };
    var geo = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
    return {
      country: (geo.country && geo.country.name) || null,
      region: (geo.subdivision && geo.subdivision.name) || null
    };
  } catch (e) {
    return { country: null, region: null };
  }
}

async function supabaseFetch(path, options) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(options && options.headers ? options.headers : {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  return res.json();
}

// Saves the optional "email me offers" tick. Only ever turns it ON at
// login (never off), so signing in again can't undo a choice made in
// My Account. Must never break sign-in.
async function saveOptIn(email, wanted) {
  if (wanted !== true) return;
  try {
    await supabaseFetch(`verified_visitors?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      body: JSON.stringify({ marketing_opt_in: true, marketing_opt_in_at: new Date().toISOString() })
    });
  } catch (e) { console.error('saveOptIn failed (are the SETUP_offers_optin.sql columns added?):', e); }
}

exports.handler = async function (event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const email = (body.email || '').trim().toLowerCase();
  const code = (body.code || '').trim();

  if (!email || !code) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email and code are required' }) };
  }

  try {
    const rows = await supabaseFetch(
      `verified_visitors?email=eq.${encodeURIComponent(email)}&select=*`,
      { method: 'GET' }
    );
    const record = rows[0];

    if (!record) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No verification request found for this email.' }) };
    }

    const MAX_ATTEMPTS = 5;

    // No pending code: only a browser already trusted for this email may
    // be let straight in (e.g. a double-submit). Anyone else must request
    // a code first -- a verified address is no longer enough on its own.
    if (!record.otp_code) {
      if (record.verified && await isTrusted(email, body.deviceId)) {
        var trustedResponse = { verified: true };
        try { trustedResponse.visitorToken = signVisitorToken(email); } catch (e) { console.error('signVisitorToken failed (is VISITOR_SECRET set?):', e); }
        return { statusCode: 200, body: JSON.stringify(trustedResponse) };
      }
      return { statusCode: 400, body: JSON.stringify({ error: 'Please request a new code.' }) };
    }

    if (record.otp_code !== code) {
      // Limit guesses: after 5 wrong tries this code is thrown away.
      const tries = (Number(record.otp_attempts) || 0) + 1;
      try {
        await supabaseFetch(`verified_visitors?email=eq.${encodeURIComponent(email)}`, {
          method: 'PATCH',
          body: JSON.stringify(tries >= MAX_ATTEMPTS ? { otp_code: null, otp_expires_at: null, otp_attempts: 0 } : { otp_attempts: tries })
        });
      } catch (e) {
        if (tries >= MAX_ATTEMPTS) { try { await supabaseFetch(`verified_visitors?email=eq.${encodeURIComponent(email)}`, { method: 'PATCH', body: JSON.stringify({ otp_code: null, otp_expires_at: null }) }); } catch (e2) { /* ignore */ } }
      }
      if (tries >= MAX_ATTEMPTS) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Too many incorrect attempts. Please request a new code.' }) };
      }
      return { statusCode: 400, body: JSON.stringify({ error: 'Incorrect code. Please try again.' }) };
    }

    if (!record.otp_expires_at || new Date(record.otp_expires_at).getTime() < Date.now()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'This code has expired. Please request a new one.' }) };
    }

    const nowIso = new Date().toISOString();
    const patch = { verified: true, otp_code: null, otp_expires_at: null };
    if (!record.verified) {
      const geo = getGeoFromEvent(event);
      patch.verified_at = nowIso; patch.country = geo.country; patch.region = geo.region;
    }
    await supabaseFetch(`verified_visitors?email=eq.${encodeURIComponent(email)}`, { method: 'PATCH', body: JSON.stringify(patch) });
    try { await supabaseFetch(`verified_visitors?email=eq.${encodeURIComponent(email)}`, { method: 'PATCH', body: JSON.stringify({ otp_attempts: 0 }) }); } catch (e) { /* column not added yet */ }

    // This browser has now proven it controls the inbox: remember it.
    await trust(email, body.deviceId);

    await saveOptIn(email, body.marketingOptIn);
    var freshResponse = { verified: true };
    try { freshResponse.visitorToken = signVisitorToken(email); } catch (e) { console.error('signVisitorToken failed (is VISITOR_SECRET set?):', e); }
    return { statusCode: 200, body: JSON.stringify(freshResponse) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
