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
//   refundAmount   = (sum of the returned items' price * qty) * effectiveRatio
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
//
// Confirmation email uses the same sendReturnConfirmationEmail() as
// POS returns/exchanges (_order-shared.js), passing referenceLabel:
// 'Order' and isPartial so the wording matches an online order and
// correctly says when only some of the order was refunded.
const { verifyAdminToken } = require('./_admin-auth');
const { supabaseHeaders, sendReturnConfirmationEmail } = require('./_order-shared');

const SUPABASE_URL = process.env.SUPABASE_URL;
const REFUND_METHODS = ['cash', 'bank_transfer', 'gift_card'];

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
    const listValue = validRequestedItems.reduce(function (sum, it) { return sum + (Number(it.price) || 0) * (Number(it.qty) || 1); }, 0);
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
    const isFullyReturned = totalReturnedCount >= items.length;
    // When every item is now returned AND this return was refunded to
    // the gift card, the order status should say so (matching the
    // "Refunded (To Gift Card)" status the Update Status dropdown
    // sets) rather than the generic "Refunded" -- otherwise a fully
    // gift-card-refunded order looks, from the status alone, like it
    // was refunded in cash/bank transfer. There's no partial-refund
    // equivalent of that distinction (the dropdown has none either),
    // so a partial return always stays 'partially_refunded' regardless
    // of refund method.
    const newStatus = !isFullyReturned
      ? 'partially_refunded'
      : (refundMethod === 'gift_card' ? 'refunded_giftcard' : 'refunded');

    await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify({ status: newStatus })
    });

    try {
      await sendReturnConfirmationEmail({
        customerEmail: order.customer_email,
        customerName: order.customer_name,
        items: validRequestedItems,
        refundAmount: refundAmount,
        actionType: 'return',
        isDamaged: false,
        refundMethod: refundMethod,
        newGiftCardBalance: newBalance,
        referenceLabel: 'Order',
        billNumber: order.order_number || order.id,
        isPartial: !isFullyReturned
      });
    } catch (emailErr) {
      console.error('sendReturnConfirmationEmail failed (return was still recorded):', emailErr);
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
