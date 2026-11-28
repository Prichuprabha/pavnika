// netlify/functions/send-otp.js
//
// POST { email }
// - If this email is already verified in Supabase, responds immediately
//   with { alreadyVerified: true } and sends no email.
// - Otherwise generates a 4-digit code, stores it (with a 10-minute
//   expiry) in Supabase, and emails it via Resend.
// - Rate limited to 5 sends per email per rolling hour.
//
// Customer/visitor account verification only — admin login moved to a
// separate username/password flow (see admin-login.js) and no longer
// touches this endpoint at all.

const { signVisitorToken } = require('./_visitor-auth');
const { isTrusted } = require('./_device');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'verify@pavnika.ae';
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
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

  if (!isValidEmail(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'A valid email is required' }) };
  }

  try {
    const existingRows = await supabaseFetch(
      `verified_visitors?email=eq.${encodeURIComponent(email)}&select=*`,
      { method: 'GET' }
    );
    const existing = existingRows[0];

    // Already verified before, AND on a browser we already know for this
    // email: no code needed. A browser we have not seen before falls
    // through and gets a fresh code emailed, like a first-time sign-in.
    if (existing && existing.verified && await isTrusted(email, body.deviceId)) {
      // The "email me offers" tick is saved here for returning customers
      // (it never reaches verify-otp). It only ever turns the choice ON.
      if (body.marketingOptIn === true) {
        try {
          await supabaseFetch(`verified_visitors?email=eq.${encodeURIComponent(email)}`, {
            method: 'PATCH',
            body: JSON.stringify({ marketing_opt_in: true, marketing_opt_in_at: new Date().toISOString() })
          });
        } catch (e) { console.error('saving offers opt-in failed (are the SETUP_offers_optin.sql columns added?):', e); }
      }
      var response = { alreadyVerified: true };
      try { response.visitorToken = signVisitorToken(email); } catch (e) { console.error('signVisitorToken failed (is VISITOR_SECRET set?):', e); }
      return { statusCode: 200, body: JSON.stringify(response) };
    }

    const now = Date.now();
    let sendCount = 1;
    if (existing && existing.last_sent_at) {
      const lastSent = new Date(existing.last_sent_at).getTime();
      if (now - lastSent < RATE_LIMIT_WINDOW_MS) {
        if ((existing.send_count || 0) >= RATE_LIMIT_MAX) {
          return {
            statusCode: 429,
            body: JSON.stringify({ error: 'Too many requests. Please try again later.' })
          };
        }
        sendCount = (existing.send_count || 0) + 1;
      }
    }

    const code = generateCode();
    const expiresAt = new Date(now + OTP_TTL_MS).toISOString();
    const nowIso = new Date(now).toISOString();

    if (existing) {
      await supabaseFetch(`verified_visitors?email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          otp_code: code,
          otp_expires_at: expiresAt,
          last_sent_at: nowIso,
          send_count: sendCount
        })
      });
    } else {
      await supabaseFetch('verified_visitors', {
        method: 'POST',
        body: JSON.stringify({
          email,
          otp_code: code,
          otp_expires_at: expiresAt,
          last_sent_at: nowIso,
          send_count: sendCount,
          verified: false
        })
      });
    }

    // Fresh code = fresh set of guesses (best effort; needs otp_attempts).
    try { await supabaseFetch(`verified_visitors?email=eq.${encodeURIComponent(email)}`, { method: 'PATCH', body: JSON.stringify({ otp_attempts: 0 }) }); } catch (e) { /* column not added yet */ }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `Pavnika by Saranya <${FROM_EMAIL}>`,
        to: [email],
        subject: `Your verification code: ${code}`,
        html: `
          <div style="font-family: sans-serif; max-width: 420px; margin: 0 auto; padding: 32px 24px; color: #241B14;">
            <p style="font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase; color: #B8862E; margin: 0 0 16px;">Pavnika by Saranya</p>
            <p style="font-size: 16px; margin: 0 0 24px;">Here is your one-time verification code:</p>
            <p style="font-size: 36px; font-weight: 700; letter-spacing: 0.15em; color: #6B1420; margin: 0 0 24px;">${code}</p>
            <p style="font-size: 14px; color: #555; margin: 0;">This code expires in 10 minutes. If you did not request this, you can safely ignore this email.</p>
          </div>
        `
      })
    });

    if (!emailRes.ok) {
      const text = await emailRes.text();
      throw new Error(`Resend error: ${text}`);
    }

    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
