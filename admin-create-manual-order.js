// netlify/functions/admin-create-manual-order.js
//
// POST { adminToken, items, customer, billingAddress, shippingAddress,
//        discountType, discountValue, subtotal, discountAmount, total,
//        paymentMode, applyGiftCard? }
// - For sales completed via bank transfer, cash, or a Nomod payment
//   confirmed outside the website. Creates a real row in the same
//   `orders` table used by online purchases (so it shows in the admin
//   Orders tab identically), marks the purchased sarees sold in the
//   live catalogue, and sends the customer the exact same order
//   confirmation email an online purchase gets — via the shared
//   _order-shared.js module, so there's no separate/divergent copy
//   of that email template to maintain.
// - Status is set to "paid" by default for Bank Transfer, Cash, and
//   Nomod (confirmed manually) — payment being confirmed doesn't mean
//   the saree has already been handed over, so it goes through the
//   same shipped/delivered progression as an online order. COD orders
//   still start as "cod_pending" since payment itself isn't confirmed
//   yet. Staff can still manually set a manual order to
//   "Delivered (Direct Pay)" for genuine in-person hand-offs — that
//   status still exists and still counts toward revenue/completed
//   totals exactly as before, it's just no longer forced on by default.
// - applyGiftCard: true opts this order into redeeming the customer's
//   existing store credit. The *amount* is never taken from the
//   client — it's always recomputed here as
//   min(customer's real current balance, subtotal - discountAmount),
//   deducted from pos_customers, and subtracted from the order's
//   total. This is a pure safety net: when this flag is left off
//   (the default), behavior is identical to before this existed.

const { verifyAdminToken } = require('./_admin-auth');
const { supabaseHeaders, generateOrderNumber, sendReceiptEmail, markSareesSold } = require('./_order-shared');

const SUPABASE_URL = process.env.SUPABASE_URL;

function isAddressComplete(addr) {
  var pincodeOk = addr && (addr.country === 'United Arab Emirates' || !!addr.pincode);
  return !!(addr && addr.building && addr.street && addr.city && addr.state && pincodeOk && addr.country);
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

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'At least one saree is required.' }) };
  }

  const customer = body.customer || {};
  const email = (customer.email || '').trim().toLowerCase();
  const firstName = (customer.firstName || '').trim();
  const lastName = (customer.lastName || '').trim();
  if (!email || !firstName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Customer first name and email are required.' }) };
  }

  const billing = body.billingAddress || {};
  if (!isAddressComplete(billing)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Billing address is incomplete.' }) };
  }
  const shipping = isAddressComplete(body.shippingAddress) ? body.shippingAddress : billing;

  const subtotal = Number(body.subtotal) || 0;
  const discountAmount = Number(body.discountAmount) || 0;
  let total = Number(body.total) || (subtotal - discountAmount);
  const paymentMode = (body.paymentMode || 'Bank Transfer').trim();

  // Store credit is opt-in and fully server-computed — the client
  // only says "yes, apply it if there's any." The actual amount is
  // never taken from the request body, so there's no way for a typo
  // or a stale display value to apply more credit than the customer
  // genuinely has, or more than this order actually costs.
  let giftCardApplied = 0;
  let giftCardCustomerId = null;
  let giftCardNote = null;

  if (body.applyGiftCard) {
    try {
      let matched = null;
      if (email) {
        const byEmailRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?email=eq.${encodeURIComponent(email)}&select=id,gift_card_balance`, { headers: supabaseHeaders() });
        const byEmail = await byEmailRes.json();
        if (byEmail.length) matched = byEmail[0];
      }
      if (!matched && customer.phone) {
        const digitsOnly = String(customer.phone).replace(/\D/g, '').slice(-9);
        if (digitsOnly) {
          const byPhoneRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?phone=ilike.${encodeURIComponent('%' + digitsOnly)}&select=id,gift_card_balance`, { headers: supabaseHeaders() });
          const byPhone = await byPhoneRes.json();
          if (byPhone.length) matched = byPhone[0];
        }
      }

      if (matched) {
        const realBalance = Number(matched.gift_card_balance) || 0;
        const orderOwed = Math.max(0, subtotal - discountAmount);
        giftCardApplied = Math.round(Math.min(realBalance, orderOwed) * 100) / 100;
        giftCardCustomerId = matched.id;
        if (giftCardApplied <= 0) {
          giftCardNote = realBalance <= 0 ? 'This customer has no store credit balance — none was applied.' : null;
        }
      } else {
        giftCardNote = 'No store credit record found for this customer — none was applied.';
      }
    } catch (err) {
      console.error('Store credit lookup failed, proceeding without applying any:', err);
      giftCardNote = 'Could not check store credit balance — none was applied.';
    }
  }

  if (giftCardApplied > 0) {
    total = Math.round((total - giftCardApplied) * 100) / 100;
  }

  const orderItems = items.map(function (it) {
    return {
      id: it.id,
      name: it.name,
      price: Number(it.price) || 0,
      qty: Number(it.qty) || 1,
      series: it.series || '',
      type: it.type || '',
      sareeType: it.sareeType || '',
      pattern: it.pattern || '',
      image: it.image || ''
    };
  });

  const orderRow = {
    order_number: await generateOrderNumber(),
    nomod_checkout_id: null,
    reference_id: 'manual-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    customer_email: email,
    customer_name: (firstName + ' ' + lastName).trim(),
    customer_phone: customer.phone || '',
    items: JSON.stringify(orderItems),
    promo_code: '',
    subtotal: subtotal,
    discount_amount: discountAmount,
    total: total,
    gift_card_applied: giftCardApplied,
    status: paymentMode === 'COD' ? 'cod_pending' : 'paid',
    payment_method: paymentMode,
    billing_address: JSON.stringify(billing),
    shipping_address: JSON.stringify(shipping)
  };

  try {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST',
      headers: Object.assign({}, supabaseHeaders(), { 'Prefer': 'return=representation' }),
      body: JSON.stringify(orderRow)
    });
    if (!insertRes.ok) {
      const text = await insertRes.text();
      throw new Error(`Supabase insert error ${insertRes.status}: ${text}`);
    }
    const inserted = (await insertRes.json())[0];

    // Mark the sold sarees in the live catalogue — same as an online
    // payment being confirmed. If this step fails, the order itself
    // has already been recorded and the email will still send; the
    // saree(s) would just need marking sold by hand in the Saree
    // Editor as a fallback, so this failure alone shouldn't block the
    // customer from getting their confirmation.
    try {
      await markSareesSold(orderItems.map(function (it) { return it.id; }));
    } catch (err) {
      console.error('markSareesSold failed for manual order ' + inserted.order_number + ':', err);
    }

    // Deduct the applied credit only now that the order itself is
    // safely recorded — same ordering as marking sarees sold above,
    // so a failure here doesn't cost the customer their confirmation
    // email. If it does fail, the order's own gift_card_applied value
    // stays as the record of what should have been deducted.
    if (giftCardApplied > 0 && giftCardCustomerId) {
      try {
        const custRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${giftCardCustomerId}&select=gift_card_balance`, { headers: supabaseHeaders() });
        const custRows = await custRes.json();
        const currentBalance = (custRows[0] && Number(custRows[0].gift_card_balance)) || 0;
        const newBalance = Math.max(0, Math.round((currentBalance - giftCardApplied) * 100) / 100);
        await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${giftCardCustomerId}`, {
          method: 'PATCH',
          headers: supabaseHeaders(),
          body: JSON.stringify({ gift_card_balance: newBalance })
        });
      } catch (err) {
        console.error('Order ' + inserted.order_number + ' applied AED ' + giftCardApplied + ' store credit, but deducting the balance failed — needs manual correction:', err);
      }
    }

    await sendReceiptEmail(inserted, paymentMode);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        orderNumber: inserted.order_number,
        giftCardApplied: giftCardApplied,
        giftCardNote: giftCardNote
      })
    };
  } catch (err) {
    console.error('admin-create-manual-order failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create the order: ' + err.message }) };
  }
};
