// netlify/functions/verify-otp.js
//
// POST { email, code }
// - Checks the code against Supabase.
// - If it matches and hasn't expired, marks the visitor as verified
//   and returns { verified: true }.
// - If the verifying email is the admin email, also returns a signed
//   adminToken the admin panel uses to authenticate write requests.

const { ADMIN_EMAIL, signAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

    if (record.verified) {
      var alreadyResponse = { verified: true };
      if (email === ADMIN_EMAIL) alreadyResponse.adminToken = signAdminToken(email);
      return { statusCode: 200, body: JSON.stringify(alreadyResponse) };
    }

    if (!record.otp_code || record.otp_code !== code) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Incorrect code. Please try again.' }) };
    }

    if (!record.otp_expires_at || new Date(record.otp_expires_at).getTime() < Date.now()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'This code has expired. Please request a new one.' }) };
    }

    const nowIso = new Date().toISOString();
    await supabaseFetch(`verified_visitors?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        verified: true,
        verified_at: nowIso,
        otp_code: null,
        otp_expires_at: null
      })
    });

    return { statusCode: 200, body: JSON.stringify(
      email === ADMIN_EMAIL
        ? { verified: true, adminToken: signAdminToken(email) }
        : { verified: true }
    ) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
