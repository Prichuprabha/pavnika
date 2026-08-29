// netlify/functions/admin-update-order-status.js
//
// POST { adminToken, orderId, status }
// - Updates an order's status (e.g. paid, shipped, payment_error,
//   cancelled, refunded, refunded_giftcard) from the admin Orders tab.
// - "refunded_giftcard" additionally credits the order's value to a
//   pos_customers gift card balance (matched by email, then phone;
//   created if no matching customer exists yet), since gift card
//   balance is only ever tracked on that table. Guarded against
//   double-crediting if the same status is saved more than once.

const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const ALLOWED_STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'payment_error', 'cancelled', 'refunded', 'refunded_giftcard'];

function formatAED(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
}

async function sendGiftCardNotice(email, name, refundAmount, newBalance, orderNumber) {
  if (!email) return; // nothing to notify — the customer will need to be told some other way
  var html = `
    <div style="font-family:sans-serif; max-width:480px; margin:0 auto; background:#FCF5ED;">
      <div style="background:#3C1223; padding:24px 20px; text-align:center; border-radius:6px 6px 0 0;">
        <p style="font-family:Georgia,serif; font-size:18px; color:#FCF5ED; margin:0;">Your order has been refunded as store credit</p>
      </div>
      <div style="padding:20px 22px; color:#3B2528;">
        <p style="font-size:13px; line-height:1.7;">Hi ${name || 'there'}, your order ${orderNumber ? '#' + orderNumber : ''} has been refunded as Pavnika by Saranya store credit rather than a cash refund.</p>
        <div style="background:#F8ECE2; border-radius:8px; padding:14px 16px; margin:16px 0;">
          <p style="margin:0 0 4px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Credit added</p>
          <p style="margin:0 0 10px; font-size:16px; font-weight:bold; color:#B68A69;">AED ${formatAED(refundAmount)}</p>
          <p style="margin:0 0 4px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Your total balance</p>
          <p style="margin:0; font-size:16px; font-weight:bold; color:#2B0D1A;">AED ${formatAED(newBalance)}</p>
        </div>
        <p style="font-size:13px; line-height:1.7;">To use this credit on a future order, please contact us at <a href="mailto:support@pavnika.ae" style="color:#B68A69;">support@pavnika.ae</a> or WhatsApp +971 52 66 30307 before checking out, and our team will apply it for you.</p>
        <p style="font-size:11px; color:#a08b7f; margin-top:18px; text-align:center;">Pavnika by Saranya &middot; Dubai, UAE</p>
      </div>
    </div>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Pavnika by Saranya <orders@pavnika.ae>',
        reply_to: 'support@pavnika.ae',
        to: [email],
        subject: `You have AED ${formatAED(newBalance)} in store credit`,
        html: html
      })
    });
  } catch (e) {
    console.error('sendGiftCardNotice failed (gift card was still credited):', e);
  }
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

  const session = verifyAdminToken(body.adminToken);
  if (!session) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authorized. Please sign in again.' }) };
  }

  const orderId = body.orderId;
  const status = body.status;

  if (!orderId || ALLOWED_STATUSES.indexOf(status) === -1) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid order ID or status.' }) };
  }

  try {
    if (status === 'refunded_giftcard') {
      const orderRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=id,status,total,customer_name,customer_email,customer_phone`, { headers: supabaseHeaders() });
      if (!orderRes.ok) throw new Error(`Supabase error ${orderRes.status}`);
      const orderRows = await orderRes.json();
      if (!orderRows.length) return { statusCode: 404, body: JSON.stringify({ error: 'Order not found.' }) };
      const order = orderRows[0];

      if (order.status !== 'refunded_giftcard') {
        const refundAmount = Number(order.total) || 0;
        let matched = null;

        if (order.customer_email) {
          const byEmailRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?email=eq.${encodeURIComponent(order.customer_email)}&select=id,gift_card_balance`, { headers: supabaseHeaders() });
          const byEmail = await byEmailRes.json();
          if (byEmail.length) matched = byEmail[0];
        }
        if (!matched && order.customer_phone) {
          const digitsOnly = order.customer_phone.replace(/\D/g, '').slice(-9);
          const byPhoneRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?phone=ilike.${encodeURIComponent('%' + digitsOnly)}&select=id,gift_card_balance`, { headers: supabaseHeaders() });
          const byPhone = await byPhoneRes.json();
          if (byPhone.length) matched = byPhone[0];
        }

        if (matched) {
          const newBalance = (Number(matched.gift_card_balance) || 0) + refundAmount;
          await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${matched.id}`, {
            method: 'PATCH',
            headers: supabaseHeaders(),
            body: JSON.stringify({ gift_card_balance: newBalance })
          });
          await sendGiftCardNotice(order.customer_email, order.customer_name, refundAmount, newBalance, order.order_number || order.id);
        } else {
          await fetch(`${SUPABASE_URL}/rest/v1/pos_customers`, {
            method: 'POST',
            headers: supabaseHeaders(),
            body: JSON.stringify({
              name: order.customer_name || 'Online Customer',
              phone: (order.customer_phone || '').replace(/\D/g, '') || '0000000000',
              phone_country_code: '+971',
              email: order.customer_email || null,
              gift_card_balance: refundAmount
            })
          });
          await sendGiftCardNotice(order.customer_email, order.customer_name, refundAmount, refundAmount, order.order_number || order.id);
        }
      }
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: status })
    });
    if (!res.ok) throw new Error(`Supabase error ${res.status}`);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update order: ' + err.message }) };
  }
};
