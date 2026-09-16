// netlify/functions/resume-nomod-checkout.js
//
// POST { visitorToken, orderId }
// For a customer's own still-"pending" order, creates a BRAND NEW Nomod
// checkout session (the original one from create-nomod-checkout.js has
// almost certainly expired long before the order itself gets cleaned up
// 24 hours later) and updates that same order row to point at it —
// never inserts a duplicate order.
//
// Prices and availability are re-verified fresh from the live
// catalogue, exactly like the original checkout — a saree could have
// sold out or changed price in the time since the order was first
// placed, and this must never silently charge a stale price.
//
// Ownership is checked via the same signed visitor token used for the
// account page itself, matched against the order's own customer_email
// — not the order ID alone, which is guessable/enumerable and must
// never be sufficient on its own to touch someone else's order.

const { verifyVisitorToken } = require('./_visitor-auth');
const { fetchProductsFromGitHub } = require('./_order-shared');

const NOMOD_API_KEY = process.env.NOMOD_API_KEY;
const NOMOD_BASE = 'https://api.nomod.com/v1';
const SITE_URL = 'https://pavnika.ae';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
}

function toCents(aed) { return Math.round((Number(aed) || 0) * 100); }
function centsToStr(cents) { return (cents / 100).toFixed(2); }

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
    return { statusCode: 401, body: JSON.stringify({ error: 'Please verify your email again to continue this order.' }) };
  }
  var verifiedEmail = String(session.email || '').toLowerCase();

  if (!body.orderId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing order id' }) };
  }

  try {
    var orderRes = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(body.orderId)}&select=*`,
      { headers: supabaseHeaders() }
    );
    if (!orderRes.ok) throw new Error(`Supabase lookup failed: ${orderRes.status}`);
    var orders = await orderRes.json();
    var order = orders[0];

    // Same "don't reveal which part was wrong" instinct as admin-login:
    // an order that doesn't exist and one that belongs to someone else
    // get the identical generic error.
    if (!order || String(order.customer_email || '').toLowerCase() !== verifiedEmail) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Order not found.' }) };
    }

    if (order.status !== 'pending') {
      return { statusCode: 400, body: JSON.stringify({ error: 'This order is no longer pending — it may have already been paid, or it expired.' }) };
    }

    var items;
    try {
      items = JSON.parse(order.items || '[]');
    } catch (e) {
      items = [];
    }
    if (!items.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Could not read this order\u2019s items.' }) };
    }

    var catalogById = {};
    try {
      var catalog = await fetchProductsFromGitHub();
      catalog.products.forEach(function (p) { catalogById[p.id] = p; });
    } catch (e) {
      console.error('resume-nomod-checkout: could not load product catalogue:', e);
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not verify prices right now. Please try again.' }) };
    }

    // A saree could have sold out (via POS, or another customer) or
    // been removed entirely since this order was first placed — must
    // be caught now rather than charging for something unavailable.
    var unavailable = items.filter(function (it) {
      var p = catalogById[it.id];
      return !p || p.sold;
    }).map(function (it) { return it.id; });
    if (unavailable.length) {
      return { statusCode: 409, body: JSON.stringify({ error: 'Sorry, this is no longer available: ' + unavailable.join(', ') + '. Please contact us so we can help.' }) };
    }

    function effectivePrice(p) {
      var hasValidSale = p.salePrice && Number(p.salePrice) > 0 && Number(p.salePrice) < Number(p.price);
      return hasValidSale ? p.salePrice : p.price;
    }

    var subtotalCents = 0;
    var nomodItems = items.map(function (it) {
      var p = catalogById[it.id];
      var priceCents = toCents(effectivePrice(p));
      subtotalCents += priceCents;
      return { item_id: it.id, name: it.name || it.id, quantity: 1, unit_amount: centsToStr(priceCents) };
    });

    // The original discount (if any) is honoured as the same flat AED
    // amount rather than re-validating the promo code, which may no
    // longer exist or may have changed since — clamped so it can never
    // exceed the freshly-computed subtotal.
    var discountCents = Math.min(toCents(order.discount_amount || 0), subtotalCents);
    var finalAmountCents = subtotalCents - discountCents;

    var referenceId = 'pavnika-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    var nameParts = String(order.customer_name || '').trim().split(/\s+/);
    var firstName = nameParts.shift() || '';
    var lastName = nameParts.join(' ');

    var payload = {
      reference_id: referenceId,
      amount: centsToStr(finalAmountCents),
      currency: 'AED',
      items: nomodItems,
      customer: {
        first_name: firstName,
        last_name: lastName,
        email: order.customer_email || '',
        phone_number: order.customer_phone || ''
      },
      success_url: SITE_URL + '/order-success.html?ref=' + referenceId,
      failure_url: SITE_URL + '/order-success.html?ref=' + referenceId,
      cancelled_url: SITE_URL + '/account.html',
      metadata: {
        promo_code: order.promo_code || '',
        saree_ids: items.map(function (it) { return it.id; }).join(','),
        resumed_order_id: String(order.id)
      }
    };
    if (discountCents > 0) {
      payload.discount = centsToStr(discountCents);
    }

    var nomodRes = await fetch(`${NOMOD_BASE}/checkout`, {
      method: 'POST',
      headers: { 'X-API-KEY': NOMOD_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var nomodData = await nomodRes.json();
    if (!nomodRes.ok) {
      console.error('resume-nomod-checkout: Nomod session creation failed:', nomodData);
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not start payment right now. Please try again shortly.' }) };
    }

    // Update the SAME order row — never insert a second one — so
    // verify-nomod-order.js confirms this exact order once paid.
    var updateRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}`, {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        nomod_checkout_id: nomodData.id,
        reference_id: referenceId,
        subtotal: subtotalCents / 100,
        discount_amount: discountCents / 100,
        total: finalAmountCents / 100
      })
    });
    if (!updateRes.ok) {
      console.error('resume-nomod-checkout: could not update order row:', await updateRes.text());
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not prepare this order for payment. Please try again.' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ checkoutUrl: nomodData.url }) };
  } catch (e) {
    console.error('resume-nomod-checkout error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong, please try again.' }) };
  }
};
