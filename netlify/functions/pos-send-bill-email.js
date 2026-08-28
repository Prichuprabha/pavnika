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

  function formatBillDate(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
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
        <p style="font-family:Georgia,serif; font-size:19px; color:#FCF5ED; margin:0 0 4px;">Thank you for shopping with us!</p>
        <p style="font-family:Georgia,serif; font-size:14px; color:#FCF5ED; margin:0 0 8px;" dir="rtl">شكراً لتسوقك معنا!</p>
        <p style="font-size:11.5px; color:#F6DFD5; margin:0;">In-store purchase &middot; Pavnika by Saranya, Dubai</p>
      </div>
      <div style="padding:22px 24px; color:#3B2528;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
          <tr>
            <td style="font-size:13px; color:#8a6f63;">Bill No. / <span dir="rtl" style="text-transform:none;">رقم الفاتورة</span><br><strong style="color:#3B2528;">${body.billNumber || ''}</strong></td>
            <td align="right" style="font-size:13px; color:#8a6f63;">Date / <span dir="rtl" style="text-transform:none;">التاريخ</span><br><strong style="color:#3B2528;">${formatBillDate(body.billDate)}</strong></td>
          </tr>
        </table>

        <div style="background:#FFFFFF; border:1px solid #DED0C7; border-radius:6px; padding:14px 16px; margin:0 0 14px;">
          <p style="margin:0 0 6px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Sold by / <span dir="rtl" style="text-transform:none;">البائع</span></p>
          <p style="margin:0 0 3px; font-size:13px; font-weight:600; color:#3B2528;">Pavnika by Saranya</p>
          <p style="margin:0 0 3px; font-size:12px; color:#3B2528; line-height:1.6;">Al Barsha South 4, Dubai, United Arab Emirates</p>
          <p style="margin:0 0 3px; font-size:12px; color:#3B2528;">Licensed by Dubai Department of Economy &amp; Tourism &mdash; License No. 1563920</p>
          <p style="margin:0; font-size:12px; color:#3B2528;">support@pavnika.ae &nbsp;&middot;&nbsp; +971 52 66 30307</p>
        </div>

        ${body.customerName ? `
        <div style="background:#F8ECE2; border-radius:6px; padding:12px 16px; margin:0 0 14px;">
          <p style="margin:0 0 2px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Customer / <span dir="rtl" style="text-transform:none;">العميل</span></p>
          <p style="margin:0; color:#3B2528; font-size:13px; font-weight:600;">${body.customerName}</p>
        </div>` : ''}

        <table style="width:100%; font-size:12px; margin-bottom:14px;">
          ${body.salesPerson ? `<tr><td style="padding:2px 0; color:#8a6f63;">Sales Person</td><td style="text-align:right;">${body.salesPerson}</td></tr>` : ''}
          ${body.paymentMethod ? `<tr><td style="padding:2px 0; color:#8a6f63;">Payment Method</td><td style="text-align:right;">${body.paymentMethod}</td></tr>` : ''}
        </table>

        <table style="border-collapse:collapse; width:100%; margin:0 0 4px;">
          <thead>
            <tr style="text-align:left;">
              <th style="padding:8px 10px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Saree</th>
              <th style="padding:8px 10px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Description / <span dir="rtl" style="text-transform:none;">الوصف</span></th>
              <th style="padding:8px 10px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Price / <span dir="rtl" style="text-transform:none;">السعر</span></th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>

        <div style="border-top:1px solid #DED0C7; padding-top:10px; margin-top:6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:12.5px; color:#8a6f63; padding-bottom:4px;">Subtotal / <span dir="rtl" style="text-transform:none;">المجموع الفرعي</span></td>
              <td align="right" style="font-size:12.5px; color:#8a6f63; padding-bottom:4px;">AED ${formatAED(body.subtotal)}</td>
            </tr>
            ${body.discountAmount ? `
            <tr>
              <td style="font-size:12.5px; color:#8a6f63; padding-bottom:4px;">Discount / <span dir="rtl" style="text-transform:none;">الخصم</span></td>
              <td align="right" style="font-size:12.5px; color:#8a6f63; padding-bottom:4px;">&minus; AED ${formatAED(body.discountAmount)}</td>
            </tr>` : ''}
            <tr>
              <td style="font-size:12.5px; color:#8a6f63;">VAT / <span dir="rtl" style="text-transform:none;">ضريبة القيمة المضافة</span></td>
              <td align="right" style="font-size:12.5px; color:#8a6f63;">Not applicable</td>
            </tr>
          </table>
        </div>

        <p style="font-size:20px; font-weight:bold; color:#B68A69; margin-top:18px; margin-bottom:2px;">Total paid: AED ${formatAED(body.total)}</p>
        <p style="font-size:14px; font-weight:bold; color:#B68A69; margin:0 0 18px;" dir="rtl">المبلغ المدفوع: ${formatAED(body.total)} درهم إماراتي</p>

        <div style="border-top:1px solid #DED0C7; padding-top:14px; margin-top:6px;">
          <p style="font-size:11px; color:#a08b7f; line-height:1.7; margin:0 0 4px;">
            This document serves as your purchase receipt. For our Returns &amp; Exchange Policy, visit
            <a href="https://pavnika.ae/returns.html" style="color:#B68A69;">pavnika.ae/returns.html</a>.
            For any concern about this purchase, contact support@pavnika.ae or WhatsApp +971 52 66 30307.
          </p>
          <p style="font-size:11px; color:#a08b7f; line-height:1.7; margin:0;" dir="rtl">
            هذا المستند بمثابة إيصال الشراء الخاص بك. لسياسة الإرجاع والاستبدال، تفضل بزيارة
            pavnika.ae/returns.html. لأي استفسار بخصوص هذا الشراء، يرجى التواصل عبر support@pavnika.ae أو واتساب على 30307 66 52 971+.
          </p>
        </div>
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
