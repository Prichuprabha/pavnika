// netlify/functions/account-email-receipt.js
//
// POST { visitorToken, source: 'online'|'shop', id }
// Emails the customer a receipt for ONE of their own purchases.
//
// Deliberately does not reuse pos-send-bill-email.js: that one
// requires a POS staff token, and a customer has no such token. More
// importantly, this function re-checks that the requested purchase
// actually belongs to the email in the signed token — otherwise
// someone could pass another customer's order id and have that
// receipt mailed to themselves.

const { verifyVisitorToken } = require('./_visitor-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'Pavnika by Saranya <orders@pavnika.ae>';

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildReceiptHtml(data) {
  var itemRows = data.items.map(function (it) {
    var qty = Number(it.qty) || 1;
    var price = Number(it.price) || 0;
    return '<tr>' +
      '<td style="padding:6px 0; font-size:13px; color:#3B2528;">' + esc(it.id ? it.id + ' — ' : '') + esc(it.name || it.material || 'Item') +
        (qty > 1 ? '<br><span style="font-size:11.5px; color:#8a6f63;">' + qty + ' × ' + fmt(price) + '</span>' : '') +
      '</td>' +
      '<td align="right" style="padding:6px 0; font-size:13px; color:#3B2528; white-space:nowrap;">' + fmt(price * qty) + '</td>' +
    '</tr>';
  }).join('');

  var discountRow = Number(data.discount) > 0
    ? '<tr><td style="font-size:13px; color:#8a6f63;">Discount</td><td align="right" style="font-size:13px; color:#B8142A;">− ' + fmt(data.discount) + '</td></tr>'
    : '';

  var paymentRows = (data.payments || []).map(function (p) {
    return '<tr><td style="font-size:13px; color:#3B2528;">' + esc(p.label) + '</td>' +
      '<td align="right" style="font-size:13px; color:#3B2528;">' + fmt(p.amount) + '</td></tr>';
  }).join('');

  return `
  <div style="font-family:Arial,sans-serif; max-width:480px; margin:0 auto; background:#FCF5ED; padding:0 0 20px;">
    <div style="background:#3C1223; padding:22px 20px; text-align:center;">
      <p style="margin:0; font-size:19px; color:#FCF5ED; letter-spacing:0.5px;">Pavnika by Saranya</p>
      <p style="margin:5px 0 0; font-size:12px; color:#B68A69;">Dubai, UAE &middot; +971 52 66 30307</p>
    </div>
    <div style="padding:20px 22px; background:#fff; margin:0 12px; border-radius:0 0 8px 8px;">
      <p style="margin:0 0 14px; font-size:14px; color:#3B2528;">Here is your receipt.</p>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px dashed #DED0C7; padding-bottom:10px; margin-bottom:10px;">
        <tr><td style="font-size:13px; color:#8a6f63;">Reference</td><td align="right" style="font-size:13px; color:#3B2528;">${esc(data.reference)}</td></tr>
        <tr><td style="font-size:13px; color:#8a6f63;">Date</td><td align="right" style="font-size:13px; color:#3B2528;">${esc(data.date)}</td></tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px dashed #DED0C7; padding-bottom:8px; margin-bottom:10px;">
        ${itemRows}
      </table>

      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="font-size:13px; color:#8a6f63;">Subtotal</td><td align="right" style="font-size:13px; color:#3B2528;">${fmt(data.subtotal)}</td></tr>
        ${discountRow}
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #DED0C7; margin-top:8px; padding-top:8px;">
        <tr>
          <td style="font-size:15px; font-weight:bold; color:#2B0D1A;">Total</td>
          <td align="right" style="font-size:15px; font-weight:bold; color:#2B0D1A;">AED ${fmt(data.total)}</td>
        </tr>
      </table>

      ${paymentRows ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px dashed #DED0C7; margin-top:12px; padding-top:10px;">
        <tr><td colspan="2" style="font-size:11.5px; color:#8a6f63; padding-bottom:4px;">Paid by</td></tr>
        ${paymentRows}
      </table>` : ''}

      <p style="margin:18px 0 0; font-size:11.5px; color:#a08b7f; text-align:center;">Thank you for shopping with us</p>
    </div>
  </div>`;
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

  var session = verifyVisitorToken(body.visitorToken);
  if (!session) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Please verify your email again.' }) };
  }
  var email = String(session.email || '').toLowerCase();
  if (!email || !body.id || ['online', 'shop'].indexOf(body.source) === -1) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid request details.' }) };
  }

  try {
    var data = null;

    if (body.source === 'online') {
      var oRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(body.id)}&select=*`, { headers: supabaseHeaders() });
      var orders = oRes.ok ? await oRes.json() : [];
      var order = orders[0];
      // Ownership check — the order must belong to the verified email.
      if (!order || String(order.customer_email || '').toLowerCase() !== email) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Receipt not found for your account.' }) };
      }
      var oItems = [];
      try { oItems = JSON.parse(order.items || '[]'); } catch (e) {}
      data = {
        reference: order.order_number || order.id,
        date: new Date(order.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        items: oItems,
        subtotal: order.subtotal != null ? order.subtotal : order.total,
        discount: order.discount_amount || 0,
        total: order.total,
        payments: order.payment_method ? [{ label: order.payment_method, amount: order.total }] : []
      };
    } else {
      var sRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_sales?id=eq.${encodeURIComponent(body.id)}&select=*`, { headers: supabaseHeaders() });
      var sales = sRes.ok ? await sRes.json() : [];
      var sale = sales[0];
      if (!sale) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Receipt not found for your account.' }) };
      }
      // Ownership check — the sale's customer must have this email.
      var cRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${encodeURIComponent(sale.customer_id)}&select=email`, { headers: supabaseHeaders() });
      var custs = cRes.ok ? await cRes.json() : [];
      if (!custs.length || String(custs[0].email || '').toLowerCase() !== email) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Receipt not found for your account.' }) };
      }
      var breakdown = sale.payment_breakdown;
      if (typeof breakdown === 'string') {
        try { breakdown = JSON.parse(breakdown); } catch (e) { breakdown = null; }
      }
      var payments = Array.isArray(breakdown) && breakdown.length
        ? breakdown.map(function (p) {
            return { label: String(p.method || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }), amount: p.amount };
          })
        : (sale.payment_method ? [{ label: sale.payment_method, amount: sale.total }] : []);
      data = {
        reference: sale.bill_number,
        date: new Date(sale.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        items: sale.items || [],
        subtotal: sale.subtotal != null ? sale.subtotal : sale.total,
        discount: sale.discount_amount || 0,
        total: sale.total,
        payments: payments
      };
    }

    var res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        reply_to: 'support@pavnika.ae',
        to: [email],
        subject: 'Your receipt — ' + data.reference,
        html: buildReceiptHtml(data)
      })
    });
    if (!res.ok) {
      console.error('account-email-receipt: Resend failed:', await res.text());
      throw new Error('Email send failed');
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (e) {
    console.error('account-email-receipt error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not send the receipt right now.' }) };
  }
};
