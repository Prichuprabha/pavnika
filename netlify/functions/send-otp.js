// netlify/functions/send-otp.js
//
// POST { email }
// - If this email is already verified in Supabase, responds immediately
//   with { alreadyVerified: true } and sends no email.
// - Exception: the admin email always gets a fresh code, even if
//   previously verified — admin sessions must be re-proven each time,
//   never skipped, since a skipped check would let anyone who simply
//   knows the admin email obtain an admin session.
// - Otherwise generates a 4-digit code, stores it (with a 10-minute
//   expiry) in Supabase, and emails it via Resend.
// - Rate limited to 5 sends per email per rolling hour.

const { ADMIN_EMAIL } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'verify@mail.pavnika.ae';
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

    // Already verified before — no need to send a code at all.
    if (existing && existing.verified && email !== ADMIN_EMAIL) {
      return { statusCode: 200, body: JSON.stringify({ alreadyVerified: true }) };
    }

    // Rate limiting — not applied to the admin email, since every admin
    // login already requires a fresh code (never skipped), and admin
    // needs to log in frequently during normal use/testing.
    const now = Date.now();
    let sendCount = 1;
    if (email !== ADMIN_EMAIL && existing && existing.last_sent_at) {
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
