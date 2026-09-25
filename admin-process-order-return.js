// netlify/functions/admin-process-order-return.js
//
// POST { adminToken, orderId, itemIds: [...], refundMethod: 'cash'|'bank_transfer'|'gift_card' }
//
// Processes a return for one or more items within a WEBSITE order —
// the online-order equivalent of pos-process-return.js, using the
// exact same proration formula so a percent promo code or a flat AED
// discount both get divided fairly across whatever's being returned:
//
//   effectiveRatio = order.total / order.subtotal
//   refundAmount   = (sum of the returned items' list prices) * effectiveRatio
//
// Each call is logged as its own row in order_returns (never mutated
// afterward), so an order can be returned in stages over time and
// each stage keeps its own record of what was returned, for how much,
// and by which method. The order's own status becomes:
//   - 'partially_refunded' if some, but not all, items are now returned
//   - 'refunded' if every item on the order has now been returned
//     (across this and any earlier order_returns rows combined)
//
// Restocking is deliberately NOT automatic here (unlike POS Exchange)
// — Pavnika asked to keep that a manual step in the Saree Editor for
// website returns, since the reason for a return varies far more than
// a POS in-store exchange does.
const { verifyAdminToken } = require('./_admin-auth');
const { supabaseHeaders, formatAED } = require('./_order-shared');

const SUPABASE_URL = process.env.SUPABASE_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const REFUND_METHODS = ['cash', 'bank_transfer', 'gift_card'];
const REFUND_METHOD_LABEL = { cash: 'Cash', bank_transfer: 'Bank transfer' };

function itemListHtml(items) {
  return items.map(function (it) {
    return '<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #EADFD6; font-size:13px;">' +
      '<span>' + (it.name || it.id) + '</span>' +
      '<span style="color:#8a6f63;">AED ' + formatAED(it.price) + '</span>' +
    '</div>';
  }).join('');
}

async function sendReturnNotice(email, name, items, refundAmount, orderNumber, paymentLabel) {
  if (!email) return;
  var html = `
    <div style="font-family:sans-serif; max-width:480px; margin:0 auto; background:#FCF5ED;">
      <div style="background:#3C1223; padding:24px 20px; text-align:center; border-radius:6px 6px 0 0;">
        <p style="font-family:Georgia,serif; font-size:18px; color:#FCF5ED; margin:0;">Your return has been processed</p>
      </div>
      <div style="padding:20px 22px; color:#3B2528;">
        <p style="font-size:13px; line-height:1.7;">Hi ${name || 'there'}, we've processed your return from order ${orderNumber ? '#' + orderNumber : ''}.</p>
        <div style="margin:14px 0;">${itemListHtml(items)}</div>
        <div style="background:#F8ECE2; border-radius:8px; padding:14px 16px; margin:16px 0;">
          <p style="margin:0 0 4px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Amount refunded</p>
          <p style="margin:0 0 10px; font-size:16px; font-weight:bold; color:#B68A69;">AED ${formatAED(refundAmount)}</p>
          <p style="margin:0 0 4px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Refunded via</p>
          <p style="margin:0; font-size:16px; font-weight:bold; color:#2B0D1A;">${paymentLabel}</p>
        </div>
        <p style="font-size:13px; line-height:1.7;">Questions about this return? Contact us at <a href="mailto:support@pavnika.ae" style="color:#B68A69;">support@pavnika.ae</a> or WhatsApp +971 52 66 30307.</p>
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
        subject: `Your return from order ${orderNumber} has been processed`,
        html: html
      })
    });
  } catch (e) {
    console.error('sendReturnNotice failed (return was still recorded):', e);
  }
}

async function sendReturnGiftCardNotice(email, name, items, refundAmount, newBalance, orderNumber) {
  if (!email) return;
  var html = `
    <div style="font-family:sans-serif; max-width:480px; margin:0 auto; background:#FCF5ED;">
      <div style="background:#3C1223; padding:24px 20px; text-align:center; border-radius:6px 6px 0 0;">
        <p style="font-family:Georgia,serif; font-size:18px; color:#FCF5ED; margin:0;">Your return has been credited as store credit</p>
      </div>
      <div style="padding:20px 22px; color:#3B2528;">
        <p style="font-size:13px; line-height:1.7;">Hi ${name || 'there'}, we've processed your return from order ${orderNumber ? '#' + orderNumber : ''} as Pavnika by Saranya store credit.</p>
        <div style="margin:14px 0;">${itemListHtml(items)}</div>
        <div style="background:#F8ECE2; border-radius:8px; padding:14px 16px; margin:16px 0;">
          <p style="margin:0 0 4px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Credit added</p>
          <p style="margin:0 0 10px; font-size:16px; font-weight:bold; color:#B68A69;">AED ${formatAED(refundAmount)}</p>
          <p style="margin:0 0 4px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Your total balance</p>
          <p style="margin:0; font-size:16px; font-weight:bold; color:#2B0D1A;">AED ${formatAED(newBalance)}</p>
        </div>
        <p style="font-size:13px; line-height:1.7;">You can see this balance any time on your <a href="https://pavnika.ae/account.html" style="color:#B68A69;">Account page</a>. To use it, contact us at <a href="mailto:support@pavnika.ae" style="color:#B68A69;">support@pavnika.ae</a> or WhatsApp +971 52 66 30307.</p>
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
    console.error('sendReturnGiftCardNotice failed (gift card was still credited):', e);
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
  const requestedItemIds = Array.isArray(body.itemIds) ? body.itemIds : [];
  const refundMethod = body.refundMethod;

  if (!orderId || !requestedItemIds.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Choose at least one item to return.' }) };
  }
  if (REFUND_METHODS.indexOf(refundMethod) === -1) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Choose how the customer is being refunded.' }) };
  }

  try {
    const orderRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=*`, { headers: supabaseHeaders() });
    if (!orderRes.ok) throw new Error(`Supabase error ${orderRes.status}`);
    const orderRows = await orderRes.json();
    if (!orderRows.length) return { statusCode: 404, body: JSON.stringify({ error: 'Order not found.' }) };
    const order = orderRows[0];

    let items;
    try { items = JSON.parse(order.items || '[]'); } catch (e) { items = []; }

    // Every item ever returned on this order before now, across all
    // earlier calls — never allow the same item to be returned twice.
    const priorReturnsRes = await fetch(`${SUPABASE_URL}/rest/v1/order_returns?order_id=eq.${orderId}&select=items_returned`, { headers: supabaseHeaders() });
    const priorReturns = priorReturnsRes.ok ? await priorReturnsRes.json() : [];
    const alreadyReturnedIds = {};
    priorReturns.forEach(function (r) {
      (r.items_returned || []).forEach(function (it) { alreadyReturnedIds[it.id] = true; });
    });

    const validRequestedItems = requestedItemIds.filter(function (id) {
      return !alreadyReturnedIds[id];
    }).map(function (id) {
      return items.find(function (it) { return it.id === id; });
    }).filter(Boolean);

    if (!validRequestedItems.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Those items have already been returned, or are not on this order.' }) };
    }

    // Same proration formula as the POS return flow: whatever discount
    // ratio applied to the whole order (percent promo or flat AED)
    // gets divided fairly across just the items being returned now.
    const subtotal = Number(order.subtotal) || 0;
    const effectiveRatio = subtotal > 0 ? (Number(order.total) || 0) / subtotal : 1;
    const listValue = validRequestedItems.reduce(function (sum, it) { return sum + (Number(it.price) || 0); }, 0);
    const refundAmount = Math.round(listValue * effectiveRatio * 100) / 100;

    let newBalance = null;

    if (refundMethod === 'gift_card') {
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
        newBalance = (Number(matched.gift_card_balance) || 0) + refundAmount;
        await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${matched.id}`, {
          method: 'PATCH',
          headers: supabaseHeaders(),
          body: JSON.stringify({ gift_card_balance: newBalance })
        });
      } else {
        newBalance = refundAmount;
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
      }
    }
    // cash / bank_transfer: refunded outside this system — no balance change, just recorded below.

    const returnRes = await fetch(`${SUPABASE_URL}/rest/v1/order_returns`, {
      method: 'POST',
      headers: Object.assign({}, supabaseHeaders(), { 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        order_id: order.id,
        order_number: order.order_number,
        items_returned: validRequestedItems,
        refund_amount: refundAmount,
        refund_method: refundMethod,
        processed_by: session.displayName
      })
    });
    if (!returnRes.ok) throw new Error(`Supabase insert failed: ${returnRes.status}`);
    const returnRecord = (await returnRes.json())[0];

    // All items now returned (this call plus every earlier one) -> the
    // order is fully refunded; otherwise it's partially refunded.
    const totalReturnedCount = Object.keys(alreadyReturnedIds).length + validRequestedItems.length;
    const newStatus = totalReturnedCount >= items.length ? 'refunded' : 'partially_refunded';

    await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify({ status: newStatus })
    });

    if (refundMethod === 'gift_card') {
      await sendReturnGiftCardNotice(order.customer_email, order.customer_name, validRequestedItems, refundAmount, newBalance, order.order_number || order.id);
    } else {
      await sendReturnNotice(order.customer_email, order.customer_name, validRequestedItems, refundAmount, order.order_number || order.id, REFUND_METHOD_LABEL[refundMethod]);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        returnRecord: returnRecord,
        refundAmount: refundAmount,
        newStatus: newStatus,
        newGiftCardBalance: newBalance
      })
    };
  } catch (err) {
    console.error('admin-process-order-return failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong: ' + err.message }) };
  }
};
