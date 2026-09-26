// netlify/functions/create-nomod-checkout.js
//
// POST { items: [{id, name, price}], customer: {name, email, phone},
//        discountPercent, promoCode, visitorToken?, applyGiftCard? }
// - Creates a Nomod Hosted Checkout session for the given cart and
//   redirects the customer there to actually pay.
// - The amount charged is computed here, server-side, from the live
//   saree prices in products-data.js — never trusted from the browser.
// - Nomod's own session `status` (checked later via verify-nomod-order)
//   is the real source of truth for whether payment succeeded, not
//   anything returned directly to the browser here.
// - applyGiftCard: true opts into redeeming the visitor's own store
//   credit. The email used to look up that balance always comes from
//   inside a genuine signed visitorToken (see _visitor-auth.js) — NEVER
//   from body.customer.email, which is just typed into a form field and
//   trivially fake. Without a valid token, applyGiftCard is silently
//   ignored (checkout still proceeds normally) rather than blocking
//   payment over it.
// - The applied amount itself is always min(the visitor's real current
//   balance, what's left owing after any promo code) — recomputed here,
//   never taken from the browser.
// - If credit alone covers the full amount, Nomod is skipped entirely
//   (a $0 gateway checkout isn't meaningful) and the order is recorded
//   as paid immediately, the same way a manual order is.
// - Known limitation, stated plainly rather than hidden: if a visitor
//   opens two checkouts in parallel and both end up paid, the second
//   one to actually confirm only gets whatever balance is left at that
//   moment, not double what they had — the discount already baked into
//   its Nomod amount could then exceed what actually gets deducted.
//   For this shop's actual (low, single-till) order volume this is an
//   accepted, disclosed tradeoff rather than something worth building
//   real distributed locking for — the same class of gap already
//   exists for promo codes here (nothing stops two people redeeming a
//   one-time code at the exact same moment either).

const { fetchProductsFromGitHub, supabaseHeaders, markSareesSold, sendReceiptEmail } = require('./_order-shared');
const { verifyVisitorToken } = require('./_visitor-auth');

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

  // The browser sends item IDs; the price actually charged is looked up
  // here from the live catalogue, never trusted from the request body.
  // Without this, a saree's sale price silently wasn't applied to what
  // Nomod actually charged — and, more seriously, nothing stopped a
  // tampered request (e.g. via browser dev tools) from checking out at
  // any price at all. An item ID that no longer exists is rejected
  // outright rather than falling back to a client-supplied price, since
  // that fallback would just reopen the same gap this fix closes.
  var catalogById = {};
  try {
    var catalog = await fetchProductsFromGitHub();
    catalog.products.forEach(function (p) { catalogById[p.id] = p; });
  } catch (e) {
    console.error('create-nomod-checkout: could not load product catalogue:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not verify prices right now. Please try again.' }) };
  }

  var missingIds = items.filter(function (it) { return !catalogById[it.id]; }).map(function (it) { return it.id; });
  if (missingIds.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Some items are no longer available: ' + missingIds.join(', ') }) };
  }

  function effectivePrice(p) {
    var hasValidSale = p.salePrice && Number(p.salePrice) > 0 && Number(p.salePrice) < Number(p.price);
    return hasValidSale ? p.salePrice : p.price;
  }

  const nomodItems = items.map(function (it) {
    var catalogItem = catalogById[it.id];
    var priceCents = toCents(effectivePrice(catalogItem));
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

  // Store credit is opt-in and fully server-computed. The client only
  // says "yes, try to apply it" — the amount is always derived here
  // from the visitor's real balance, looked up by the email inside a
  // genuine signed visitorToken, never from anything else in the
  // request. An invalid/missing token just means no credit is applied;
  // it does not block checkout.
  var giftCardAppliedCents = 0;
  var giftCardEmail = null;
  if (body.applyGiftCard) {
    var visitorSession = verifyVisitorToken(body.visitorToken);
    if (visitorSession && visitorSession.email) {
      try {
        const custRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?email=eq.${encodeURIComponent(visitorSession.email)}&select=id,gift_card_balance`, { headers: supabaseHeaders() });
        const custRows = await custRes.json();
        if (custRows.length) {
          const realBalanceCents = toCents(custRows[0].gift_card_balance);
          giftCardAppliedCents = Math.max(0, Math.min(realBalanceCents, finalAmountCents));
          giftCardEmail = visitorSession.email;
        }
      } catch (e) {
        console.error('Gift card balance lookup failed, proceeding without applying any credit:', e);
      }
    }
  }

  const amountAfterGiftCardCents = finalAmountCents - giftCardAppliedCents;

  const referenceId = 'pavnika-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  // Store credit alone covers the order — a $0 gateway checkout isn't
  // meaningful to Nomod, so this is recorded and finalized directly,
  // the same way admin-create-manual-order.js finalizes a manual sale:
  // mark sarees sold, deduct the balance, send the receipt, done. No
  // "pending" status or payment confirmation step, since nothing is
  // waiting to be confirmed.
  if (amountAfterGiftCardCents <= 0) {
    try {
      const orderNumber = await generateOrderNumber();
      const orderRow = {
        order_number: orderNumber,
        nomod_checkout_id: null,
        reference_id: referenceId,
        customer_email: customer.email || '',
        customer_name: ((customer.firstName || '') + ' ' + (customer.lastName || '')).trim(),
        customer_phone: customer.phone || '',
        items: JSON.stringify(items),
        promo_code: body.promoCode || '',
        subtotal: subtotalCents / 100,
        discount_amount: totalDiscountCents / 100,
        total: 0,
        gift_card_applied: giftCardAppliedCents / 100,
        status: 'paid',
        billing_address: JSON.stringify(body.billingAddress || {}),
        shipping_address: JSON.stringify(body.shippingAddress || {})
      };

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
        method: 'POST',
        headers: Object.assign({}, supabaseHeaders(), { 'Prefer': 'return=representation' }),
        body: JSON.stringify(orderRow)
      });
      if (!insertRes.ok) {
        const errBody = await insertRes.text();
        console.error(`Failed to record credit-covered order (Supabase ${insertRes.status}) for ${referenceId}:`, errBody);
        return { statusCode: 500, body: JSON.stringify({ error: 'Could not register your order. Please try again in a moment, or use WhatsApp checkout.' }) };
      }
      const inserted = (await insertRes.json())[0];

      const sareeIds = items.map(function (it) { return it.id; });
      try { await markSareesSold(sareeIds); } catch (e) { console.error('markSareesSold failed for credit-covered order ' + orderNumber + ':', e); }

      if (giftCardAppliedCents > 0 && giftCardEmail) {
        try {
          const custRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?email=eq.${encodeURIComponent(giftCardEmail)}&select=id,gift_card_balance`, { headers: supabaseHeaders() });
          const custRows = await custRes.json();
          if (custRows.length) {
            const currentBalance = Number(custRows[0].gift_card_balance) || 0;
            const newBalance = Math.max(0, Math.round((currentBalance - giftCardAppliedCents / 100) * 100) / 100);
            await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${custRows[0].id}`, {
              method: 'PATCH',
              headers: supabaseHeaders(),
              body: JSON.stringify({ gift_card_balance: newBalance })
            });
          }
        } catch (e) {
          console.error('Credit-covered order ' + orderNumber + ' applied store credit, but deducting the balance failed — needs manual correction:', e);
        }
      }

      if (body.promoCode) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/promo_codes?code=eq.${encodeURIComponent(body.promoCode)}`, {
            method: 'PATCH',
            headers: supabaseHeaders(),
            body: JSON.stringify({ used: true })
          });
        } catch (e) { console.error('Marking promo code used failed for ' + orderNumber + ':', e); }
      }

      try { await sendReceiptEmail(inserted, 'Store Credit'); } catch (e) { console.error('Receipt email failed for credit-covered order ' + orderNumber + ':', e); }

      return { statusCode: 200, body: JSON.stringify({ directPaid: true, orderNumber: orderNumber, referenceId: referenceId }) };
    } catch (err) {
      console.error('create-nomod-checkout (credit-covered path) failed:', err);
      return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong finishing your order. Please try again or use WhatsApp checkout.' }) };
    }
  }

  const payload = {
    reference_id: referenceId,
    amount: centsToStr(amountAfterGiftCardCents),
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
      saree_ids: items.map(function (it) { return it.id; }).join(','),
      gift_card_applied: giftCardAppliedCents > 0 ? centsToStr(giftCardAppliedCents) : '',
      gift_card_email: giftCardAppliedCents > 0 ? giftCardEmail : ''
    }
  };
  // Nomod's own `discount` field only ever represented the promo code's
  // cut — store credit is applied separately (see gift_card_applied
  // above and on the order row itself), not folded into this field, so
  // Nomod's own reporting of "discount given" still means only "promo
  // code discount," same as before this existed.
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
          total: amountAfterGiftCardCents / 100,
          gift_card_applied: giftCardAppliedCents / 100,
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
