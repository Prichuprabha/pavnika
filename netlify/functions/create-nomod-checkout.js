// netlify/functions/create-nomod-checkout.js
//
// POST { items: [{id, name, price}], customer: {name, email, phone},
//        discountPercent, promoCode }
// - Creates a Nomod Hosted Checkout session for the given cart and
//   redirects the customer there to actually pay.
// - The amount charged is computed here, server-side, from the live
//   saree prices in products-data.js — never trusted from the browser.
// - Nomod's own session `status` (checked later via verify-nomod-order)
//   is the real source of truth for whether payment succeeded, not
//   anything returned directly to the browser here.

const NOMOD_API_KEY = process.env.NOMOD_API_KEY;
const NOMOD_BASE = 'https://api.nomod.com/v1';
const SITE_URL = 'https://pavnika.ae';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Builds an order number like "0231062601": HH (24hr) + MM + DD + YY of
// when the order was placed (UAE time, GMT+4), followed by a 2-digit
// sequence number for how many orders have been placed that same day.
async function generateOrderNumber() {
  var now = new Date(Date.now() + 4 * 60 * 60 * 1000); // shift to UAE time (GMT+4)
  var hh = String(now.getUTCHours()).padStart(2, '0');
  var mm = String(now.getUTCMinutes()).padStart(2, '0');
  var dd = String(now.getUTCDate()).padStart(2, '0');
  var mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  var yy = String(now.getUTCFullYear()).slice(-2);

  var dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), -4, 0, 0)).toISOString();
  var dayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, -4, 0, 0)).toISOString();

  var seq = 1;
  try {
    var res = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?select=id&created_at=gte.${dayStart}&created_at=lt.${dayEnd}`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );
    if (res.ok) {
      var rows = await res.json();
      seq = rows.length + 1;
    }
  } catch (e) {
    console.error('Could not count today\'s orders, defaulting sequence to 1:', e);
  }

  var xx = String(seq).padStart(2, '0');
  // Format: HH MM DD Month YY Seq — e.g. 13:18 on 19/07/2026, first order -> 131819072601
  return hh + mm + dd + mo + yy + xx;
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

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Cart is empty.' }) };
  }

  const customer = body.customer || {};
  const discountPercent = Number(body.discountPercent) || 0;

  // All money math is done in integer cents, then formatted to a decimal
  // string only at the very end. This guarantees net_amount always
  // exactly equals total_amount minus discount_amount — doing this math
  // in floating-point AED (multiplying/dividing fractions of a dirham)
  // can introduce tiny rounding mismatches that Nomod's strict
  // validation rejects, even though the numbers look identical to us.
  function toCents(aed) { return Math.round((Number(aed) || 0) * 100); }
  function centsToStr(cents) { return (cents / 100).toFixed(2); }

  var subtotalCents = 0;
  var totalDiscountCents = 0;

  const nomodItems = items.map(function (it) {
    var priceCents = toCents(it.price);
    var itemDiscountCents = Math.round(priceCents * discountPercent / 100);

    subtotalCents += priceCents;
    totalDiscountCents += itemDiscountCents;

    var item = {
      item_id: it.id,
      name: it.name || it.id,
      quantity: 1,
      unit_amount: centsToStr(priceCents)
    };
    if (itemDiscountCents > 0) {
      item.discount_type = 'flat';
      item.discount_amount = centsToStr(itemDiscountCents);
    }
    return item;
  });

  const finalAmountCents = subtotalCents - totalDiscountCents;

  const referenceId = 'pavnika-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  const payload = {
    reference_id: referenceId,
    amount: centsToStr(finalAmountCents),
    currency: 'AED',
    items: nomodItems,
    customer: {
      first_name: customer.firstName || '',
      last_name: customer.lastName || '',
      email: customer.email || '',
      phone_number: customer.phone || ''
    },
    success_url: SITE_URL + '/order-success.html?ref=' + referenceId,
    failure_url: SITE_URL + '/order-success.html?ref=' + referenceId,
    cancelled_url: SITE_URL + '/checkout.html',
    metadata: {
      promo_code: body.promoCode || '',
      saree_ids: items.map(function (it) { return it.id; }).join(',')
    }
  };
  if (totalDiscountCents > 0) {
    payload.discount = centsToStr(totalDiscountCents);
  }

  try {
    const res = await fetch(`${NOMOD_BASE}/checkout`, {
      method: 'POST',
      headers: {
        'X-API-KEY': NOMOD_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('Nomod checkout creation failed:', data);
      return { statusCode: 502, body: JSON.stringify({ error: (data.error && data.error.message) || 'Could not start payment. Please try again or use WhatsApp checkout.' }) };
    }

    // Record the pending order now, BEFORE the customer is sent to pay.
    // This must succeed: verify-nomod-order needs this row (it stores the
    // nomod_checkout_id) to confirm the payment afterwards. If we can't
    // record it, sending the customer to pay anyway would take their money
    // with no way to auto-confirm the order — so we stop here instead.
    // (The unused Nomod session simply expires.)
    try {
      const orderNumber = await generateOrderNumber();
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          order_number: orderNumber,
          nomod_checkout_id: data.id,
          reference_id: referenceId,
          customer_email: customer.email || '',
          customer_name: ((customer.firstName || '') + ' ' + (customer.lastName || '')).trim(),
          customer_phone: customer.phone || '',
          items: JSON.stringify(items),
          promo_code: body.promoCode || '',
          subtotal: subtotalCents / 100,
          discount_amount: totalDiscountCents / 100,
          total: finalAmountCents / 100,
          status: 'pending',
          billing_address: JSON.stringify(body.billingAddress || {}),
          shipping_address: JSON.stringify(body.shippingAddress || {})
        })
      });
      if (!insertRes.ok) {
        // fetch() does NOT throw on HTTP errors — this explicit check is
        // what surfaces Supabase rejections (schema/constraint problems)
        // that previously failed completely silently.
        const errBody = await insertRes.text();
        console.error(`Failed to record pending order (Supabase ${insertRes.status}) for ${referenceId}:`, errBody);
        return { statusCode: 500, body: JSON.stringify({ error: 'Could not register your order. Please try again in a moment, or use WhatsApp checkout — you have not been charged.' }) };
      }
    } catch (dbErr) {
      console.error('Failed to record pending order (network) for', referenceId, ':', dbErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not register your order. Please try again in a moment, or use WhatsApp checkout — you have not been charged.' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ url: data.url, id: data.id, referenceId: referenceId })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong starting payment. Please try again or use WhatsApp checkout.' }) };
  }
};
