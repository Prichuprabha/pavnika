const { verifyPosToken } = require('./_pos-auth');

const RESEND_API_KEY = process.env.RESEND_API_KEY;

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
    return { statusCode: 400, body: JSON.stringify({ error: 'No email address on this customer' }) };
  }

  var items = Array.isArray(body.items) ? body.items : [];
  var itemRows = items.map(function (it) {
    return `
      <tr>
        <td style="padding:10px; border-bottom:1px solid #DED0C7;">
          ${it.image ? `<img src="${it.image}" alt="${it.id}" width="50" style="border-radius:3px; display:block;">` : ''}
        </td>
        <td style="padding:10px; border-bottom:1px solid #DED0C7; font-size:13px; color:#3B2528;">
          ${it.id} \u2014 ${it.name || ''}
          <br><span style="font-size:10px; color:#a08b7f;">Qty: ${it.qty || 1}</span>
        </td>
        <td style="padding:10px; border-bottom:1px solid #DED0C7; font-size:13px; font-weight:bold; color:#B68A69; white-space:nowrap;">
          AED ${formatAED((it.price || 0) * (it.qty || 1))}
        </td>
      </tr>`;
  }).join('');

  var html = `
    <div style="font-family:sans-serif; max-width:520px; margin:0 auto; background:#FCF5ED;">
      <div style="background:#3C1223; padding:26px 24px; text-align:center; border-radius:6px 6px 0 0;">
        <img src="https://pavnika.ae/assets/email-logo.png" alt="Pavnika by Saranya" width="80" style="display:block; margin:0 auto 10px;">
        <p style="font-family:Georgia,serif; font-size:19px; color:#FCF5ED; margin:0;">Thank you for shopping with us!</p>
        <p style="font-size:12px; color:#F6DFD5; margin:6px 0 0;">Bill ${body.billNumber || ''}</p>
      </div>
      <div style="padding:22px 24px; color:#3B2528;">
        <table style="width:100%; font-size:12px; margin-bottom:14px;">
          ${body.customerName ? `<tr><td style="padding:2px 0; color:#a08b7f;">Customer</td><td style="text-align:right;">${body.customerName}</td></tr>` : ''}
          ${body.paymentMethod ? `<tr><td style="padding:2px 0; color:#a08b7f;">Payment Method</td><td style="text-align:right;">${body.paymentMethod}</td></tr>` : ''}
        </table>
        <table style="width:100%; border-collapse:collapse;">
          ${itemRows}
        </table>
        <table style="width:100%; margin-top:14px; font-size:13px;">
          <tr><td style="padding:4px 0;">Subtotal</td><td style="text-align:right;">AED ${formatAED(body.subtotal)}</td></tr>
          ${body.discountAmount ? `<tr><td style="padding:4px 0;">Discount</td><td style="text-align:right;">&minus; AED ${formatAED(body.discountAmount)}</td></tr>` : ''}
          <tr><td style="padding:4px 0;">VAT</td><td style="text-align:right;">Not applicable</td></tr>
          <tr><td style="padding:8px 0; font-weight:bold; border-top:1px solid #DED0C7;">Total</td><td style="text-align:right; font-weight:bold; border-top:1px solid #DED0C7;">AED ${formatAED(body.total)}</td></tr>
        </table>
        <p style="font-size:11px; color:#a08b7f; margin-top:20px; text-align:center;">Pavnika by Saranya &middot; Dubai, UAE</p>
      </div>
    </div>`;

  try {
    var res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Pavnika by Saranya <orders@pavnika.ae>',
        to: [email],
        subject: `Your receipt \u2014 ${body.billNumber || 'Pavnika by Saranya'}`,
        html: html
      })
    });
    if (!res.ok) {
      var errText = await res.text();
      throw new Error(`Resend API failed: ${res.status} ${errText}`);
    }
    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch (e) {
    console.error('pos-send-bill-email error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not send the email, please try again' }) };
  }
};
