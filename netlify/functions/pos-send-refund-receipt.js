// Sends a refund/return receipt via email — same Resend pattern as
// pos-send-bill-email.js, with its own template since the content is
// different (a refund confirmation, not a purchase receipt).
const { verifyPosToken } = require('./_pos-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
}

function formatAED(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  var body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!verifyPosToken(body.posToken)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Session expired, please log in again' }) };
  }

  var email = (body.email || '').trim();
  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No email address on file for this customer' }) };
  }

  var items = Array.isArray(body.items) ? body.items : [];
  var itemRows = items.map(function (it) {
    return `<tr><td style="padding:8px 0; border-bottom:1px solid #DED0C7; font-size:13px;">${it.id} \u2014 ${it.name || ''} (x${it.qty || 1})</td>
      <td style="padding:8px 0; border-bottom:1px solid #DED0C7; font-size:13px; text-align:right; font-weight:bold; color:#B68A69;">AED ${formatAED((it.price || 0) * (it.qty || 1))}</td></tr>`;
  }).join('');

  var refundMethodLabel = { gift_card: 'Gift Card Credit', cash: 'Cash', bank_transfer: 'Bank Transfer' }[body.refundMethod] || body.refundMethod;

  var html = `
    <div style="font-family:sans-serif; max-width:520px; margin:0 auto; background:#FCF5ED;">
      <div style="background:#3C1223; padding:26px 24px; text-align:center; border-radius:6px 6px 0 0;">
        <p style="font-family:Georgia,serif; font-size:19px; color:#FCF5ED; margin:0;">${body.actionType === 'exchange' ? 'Exchange' : 'Return'} Confirmation</p>
        <p style="font-size:12px; color:#F6DFD5; margin:6px 0 0;">Original Bill ${body.billNumber || ''}</p>
      </div>
      <div style="padding:22px 24px; color:#3B2528;">
        <table style="width:100%; border-collapse:collapse;">${itemRows}</table>
        <table style="width:100%; margin-top:14px; font-size:13px;">
          <tr><td style="padding:8px 0; font-weight:bold; border-top:1px solid #DED0C7;">Refund Amount</td><td style="text-align:right; font-weight:bold; border-top:1px solid #DED0C7;">AED ${formatAED(body.refundAmount)}</td></tr>
          <tr><td style="padding:4px 0;">Refunded Via</td><td style="text-align:right;">${refundMethodLabel}</td></tr>
        </table>
        <p style="font-size:11px; color:#a08b7f; margin-top:20px; text-align:center;">Pavnika by Saranya &middot; Dubai, UAE</p>
      </div>
    </div>`;

  try {
    var res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Pavnika by Saranya <orders@pavnika.ae>',
        to: [email],
        subject: `Your ${body.actionType === 'exchange' ? 'exchange' : 'return'} confirmation \u2014 ${body.billNumber || 'Pavnika by Saranya'}`,
        html: html
      })
    });
    if (!res.ok) {
      var errText = await res.text();
      throw new Error(`Resend API failed: ${res.status} ${errText}`);
    }
    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch (e) {
    console.error('pos-send-refund-receipt error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not send the email, please try again' }) };
  }
};
