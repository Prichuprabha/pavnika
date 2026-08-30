// netlify/functions/admin-create-manual-order.js
//
// POST { adminToken, items, customer, billingAddress, shippingAddress,
//        discountType, discountValue, subtotal, discountAmount, total,
//        paymentMode }
// - For sales completed via bank transfer, cash, or a Nomod payment
//   confirmed outside the website. Creates a real row in the same
//   `orders` table used by online purchases (so it shows in the admin
//   Orders tab identically), marks the purchased sarees sold in the
//   live catalogue, and sends the customer the exact same order
//   confirmation email an online purchase gets — via the shared
//   _order-shared.js module, so there's no separate/divergent copy
//   of that email template to maintain.
// - Status is set to "delivered_direct_pay" by default, distinguishing
//   these from online orders in the Orders tab status dropdown, while
//   remaining fully editable afterward like any other order.

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
  const total = Number(body.total) || (subtotal - discountAmount);
  const paymentMode = (body.paymentMode || 'Bank Transfer').trim();

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
    status: paymentMode === 'COD' ? 'cod_pending' : 'delivered_direct_pay',
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

    await sendReceiptEmail(inserted, paymentMode);

    return { statusCode: 200, body: JSON.stringify({ success: true, orderNumber: inserted.order_number }) };
  } catch (err) {
    console.error('admin-create-manual-order failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create the order: ' + err.message }) };
  }
};
