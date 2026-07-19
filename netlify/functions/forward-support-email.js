// netlify/functions/forward-support-email.js
//
// Receives Resend Inbound webhooks (event: email.received) for mail sent
// to any address @pavnika.ae (e.g. support@pavnika.ae), retrieves the
// full message body from Resend's Received Emails API, and forwards a
// copy to the shop's Gmail — using the same Resend account and the
// already-verified mail.pavnika.ae sending domain. Reply-To is set to
// the original sender, so replying from Gmail goes back to the customer.
//
// Required env vars:
//   RESEND_API_KEY         — already set (used by OTP/receipt functions)
//   RESEND_WEBHOOK_SECRET  — NEW: the webhook signing secret from the
//                            Resend dashboard (starts with "whsec_")
//
// Notes:
// - Webhook authenticity is verified via the Svix signature headers.
// - Attachments are listed in the forwarded copy but not re-attached;
//   they remain viewable in the Resend dashboard (kept ~30 days).

const crypto = require('crypto');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || '';

const FORWARD_TO = 'pavnikabysaranya@gmail.com';
const FORWARD_FROM = 'Pavnika Support <support@mail.pavnika.ae>';

function verifySvixSignature(headers, rawBody) {
  // Svix scheme: base64-HMAC-SHA256 of "{id}.{timestamp}.{payload}"
  // keyed with the base64-decoded secret (after the "whsec_" prefix).
  // The signature header can hold several space-separated "v1,<sig>"
  // entries; a match on any of them passes.
  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const sigHeader = headers['svix-signature'];
  if (!id || !timestamp || !sigHeader) return false;

  // Reject stale timestamps (> 5 min skew) to prevent replay.
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

  const secretBytes = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  const expectedBuf = Buffer.from(expected);

  return sigHeader.split(' ').some(function (part) {
    const sig = part.split(',')[1] || '';
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
}

// Retrieve the full received email (body, headers) from Resend.
// Primary endpoint per current docs is /emails/receiving/:id; the
// plain /emails/:id path is kept as a fallback in case of API drift.
async function fetchReceivedEmail(emailId) {
  const paths = [
    `https://api.resend.com/emails/receiving/${emailId}`,
    `https://api.resend.com/emails/${emailId}`
  ];
  for (const url of paths) {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` }
    });
    if (res.ok) return res.json();
    console.log(`Fetch ${url} -> ${res.status}`);
  }
  return null;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const rawBody = event.body || '';
  const headers = {};
  Object.keys(event.headers || {}).forEach(function (k) {
    headers[k.toLowerCase()] = event.headers[k];
  });

  if (WEBHOOK_SECRET) {
    if (!verifySvixSignature(headers, rawBody)) {
      console.error('Webhook signature verification failed');
      return { statusCode: 401, body: 'Invalid signature' };
    }
  } else {
    // Without the secret we can't authenticate the caller; process
    // anyway so mail isn't lost, but complain loudly in the logs.
    console.error('RESEND_WEBHOOK_SECRET is not set — webhook is unauthenticated!');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, body: 'Bad JSON' };
  }

  if (payload.type !== 'email.received') {
    return { statusCode: 200, body: 'Ignored' }; // other event types: ack + skip
  }

  const data = payload.data || {};
  const emailId = data.email_id;
  const origFrom = data.from || 'unknown sender';
  const origTo = Array.isArray(data.to) ? data.to.join(', ') : (data.to || '');
  const subject = data.subject || '(no subject)';
  const attachments = Array.isArray(data.attachments) ? data.attachments : [];

  // Get the message body. If retrieval fails, forward metadata anyway —
  // an incomplete notification beats silent loss (full copy stays
  // visible in the Resend dashboard either way).
  let bodyHtml = '';
  let bodyText = '';
  if (emailId) {
    try {
      const full = await fetchReceivedEmail(emailId);
      if (full) {
        bodyHtml = full.html || (full.data && full.data.html) || '';
        bodyText = full.text || (full.data && full.data.text) || '';
      }
    } catch (e) {
      console.error('Could not fetch received email body:', e);
    }
  }

  const banner =
    '<div style="background:#F4EFE2;border-left:4px solid #B08D2F;padding:10px 14px;margin-bottom:16px;font-family:Arial,sans-serif;font-size:13px;color:#333;">' +
      '<strong>Forwarded from ' + escapeHtml(origTo) + '</strong><br>' +
      'From: ' + escapeHtml(origFrom) + '<br>' +
      (attachments.length
        ? 'Attachments (' + attachments.length + '): ' +
          escapeHtml(attachments.map(function (a) { return a.filename; }).join(', ')) +
          ' — view in the Resend dashboard<br>'
        : '') +
      'Reply to this email to answer the customer directly.' +
    '</div>';

  const forwardHtml = banner + (bodyHtml || '<pre style="font-family:inherit;white-space:pre-wrap;">' + escapeHtml(bodyText || '(no body content)') + '</pre>');

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FORWARD_FROM,
      to: FORWARD_TO,
      reply_to: origFrom,
      subject: subject,
      html: forwardHtml,
      text: 'Forwarded from ' + origTo + '\nFrom: ' + origFrom + '\n\n' + (bodyText || '(see HTML version)')
    })
  });

  if (!sendRes.ok) {
    const errText = await sendRes.text();
    console.error(`Forward send failed (${sendRes.status}):`, errText);
    // Non-2xx makes Resend retry the webhook later — desirable for
    // transient failures.
    return { statusCode: 500, body: 'Forward failed' };
  }

  console.log(`Forwarded inbound email ${emailId || '(no id)'} from ${origFrom} to ${FORWARD_TO}`);
  return { statusCode: 200, body: 'Forwarded' };
};
