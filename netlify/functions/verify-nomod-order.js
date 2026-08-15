// netlify/functions/verify-nomod-order.js
//
// POST { referenceId, checkoutId? }
// - Looks up the pending order by referenceId in Supabase, then calls
//   Nomod's GET /v1/checkout/:id server-to-server to confirm the real
//   payment status — this is the actual source of truth, never the
//   browser redirect alone.
// - RECOVERY: if no order row exists (e.g. the pending insert failed at
//   checkout time) but the browser supplied the checkoutId it saved
//   before redirecting, the checkout is verified directly with Nomod
//   (reference must match, status must be "paid") and the order record
//   is rebuilt from Nomod's data + the saree catalogue, so the customer
//   still gets confirmed instead of being stuck at "no order found".
// - If (and only if) status === "paid":
//     - Marks the purchased sarees as sold, via the same GitHub-commit
//       mechanism the admin panel already uses.
//     - Updates the order record to "paid".
//     - Emails a receipt to pavnikabysaranya@gmail.com via Resend.
// - Safe to call more than once for the same order — if it's already
//   marked paid, it won't repeat the saree-marking or email steps.
// - The receipt email (sendReceiptEmail) includes the fields required
//   by UAE Consumer Protection Law for a consumer invoice: seller
//   trade name/address/licence number/contact, the order date, item
//   quantity/condition, and Arabic alongside the English labels. This
//   business is not VAT-registered (turnover under the AED 375,000
//   threshold), so no TRN/tax-invoice fields are included — if that
//   ever changes, this template needs a proper Tax Invoice layout
//   (TRN, VAT rate, VAT amount shown separately) added.

const { supabaseHeaders, formatAED, generateOrderNumber, sendReceiptEmail, markSareesSold, fetchProductsFromGitHub } = require('./_order-shared');

const NOMOD_API_KEY = process.env.NOMOD_API_KEY;
const NOMOD_BASE = 'https://api.nomod.com/v1';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const PRODUCTS_PATH = 'products-data.js';

async function getOrderByReference(referenceId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/orders?reference_id=eq.${encodeURIComponent(referenceId)}`, {
    headers: supabaseHeaders()
  });
  if (!res.ok) throw new Error(`Supabase read error ${res.status}`);
  const rows = await res.json();
  return rows[0] || null;
}

async function markOrderPaid(orderId) {
  await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify({ status: 'paid' })
  });
}

async function markPromoCodeUsed(code) {
  if (!code) return;
  await fetch(`${SUPABASE_URL}/rest/v1/promo_codes?code=eq.${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify({ used: true })
  });
}

// Builds an order number like "131819072601": HH + MM + DD + Month + YY (UAE time)
// + 2-digit same-day sequence. Same scheme as create-nomod-checkout.
// RECOVERY: the pending order row is missing but the browser remembered
// its checkoutId. Verify with Nomod that this checkout really belongs to
// this reference AND is paid, then rebuild the order record from Nomod's
// data plus the saree catalogue. Returns the order row (or null if the
// checkout doesn't check out).
async function recoverOrderFromNomod(referenceId, checkoutId) {
  const nomodRes = await fetch(`${NOMOD_BASE}/checkout/${encodeURIComponent(checkoutId)}`, {
    headers: { 'X-API-KEY': NOMOD_API_KEY }
  });
  if (!nomodRes.ok) {
    console.error(`Recovery: Nomod GET checkout failed (${nomodRes.status}) for ${checkoutId}`);
    return null;
  }
  const nomodData = await nomodRes.json();

  // Both conditions are server-verified with Nomod, so a caller can't
  // conjure an order out of a mismatched or unpaid checkout id.
  if (nomodData.reference_id !== referenceId) {
    console.error(`Recovery: reference mismatch — checkout ${checkoutId} has reference ${nomodData.reference_id}, expected ${referenceId}`);
    return null;
  }
  if (nomodData.status !== 'paid') {
    console.log(`Recovery: checkout ${checkoutId} status is ${nomodData.status}, not rebuilding.`);
    return null;
  }

  const meta = nomodData.metadata || {};
  const sareeIds = String(meta.saree_ids || '').split(',').filter(Boolean);

  // Rebuild item details from the catalogue so the receipt email and
  // admin panel show full descriptions, not just IDs.
  var items = [];
  try {
    const products = (await fetchProductsFromGitHub()).products;
    items = sareeIds.map(function (id) {
      var p = products.find(function (pp) { return pp.id === id; }) || {};
      return {
        id: id,
        name: ((p.series || '') + ' ' + id).trim(),
        price: p.price || 0,
        series: p.series,
        type: p.type,
        sareeType: p.sareeType,
        pattern: p.pattern,
        image: p.image
      };
    });
  } catch (e) {
    console.error('Recovery: could not rebuild items from catalogue:', e);
    items = sareeIds.map(function (id) { return { id: id, name: id, price: 0 }; });
  }

  const cust = nomodData.customer || {};
  const total = Number(nomodData.amount) || 0;
  const discount = Number(nomodData.discount) || 0;

  const orderRow = {
    order_number: await generateOrderNumber(),
    nomod_checkout_id: checkoutId,
    reference_id: referenceId,
    customer_email: cust.email || '',
    customer_name: ((cust.first_name || '') + ' ' + (cust.last_name || '')).trim(),
    customer_phone: cust.phone_number || '',
    items: JSON.stringify(items),
    promo_code: meta.promo_code || '',
    subtotal: total + discount,
    discount_amount: discount,
    total: total,
    status: 'pending',
    billing_address: '{}',
    shipping_address: '{}'
  };

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
    method: 'POST',
    headers: Object.assign({}, supabaseHeaders(), { 'Prefer': 'return=representation' }),
    body: JSON.stringify(orderRow)
  });
  if (insertRes.ok) {
    const rows = await insertRes.json();
    console.log(`Recovery: rebuilt order for ${referenceId} from Nomod checkout ${checkoutId}`);
    return rows[0] || orderRow;
  }
  // Insert failed again — log loudly, but STILL return the in-memory
  // order so the customer gets confirmed, the sarees get marked sold,
  // and the receipt email goes out. The admin email is the paper trail.
  console.error(`Recovery: rebuilt-order insert failed (${insertRes.status}):`, await insertRes.text());
  return orderRow;
}

function extractPaymentMethod(nomodData) {
  // Nomod's exact field name/shape for payment method details on a
  // confirmed checkout hasn't been verified against a real response yet
  // (this needs a real-log check the first time this runs for real, same
  // as we did for the checkout amount fields earlier). Written
  // defensively so it degrades to a generic label rather than breaking
  // if the actual response shape differs from what's guessed here.
  try {
    var charge = (nomodData.charges && nomodData.charges[0]) || null;
    var methodType = (charge && (charge.payment_method || charge.method || charge.type)) || nomodData.payment_method || null;
    var last4 = (charge && (charge.last4 || charge.card_last4 || (charge.card && charge.card.last4))) || null;

    if (!methodType) return null;

    var label = String(methodType).replace(/_/g, ' ');
    label = label.charAt(0).toUpperCase() + label.slice(1);
    return last4 ? (label + ' •••• ' + last4) : label;
  } catch (e) {
    return null;
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

  const referenceId = (body.referenceId || '').trim();
  const checkoutId = (body.checkoutId || '').trim();
  if (!referenceId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing order reference.' }) };
  }

  try {
    let order = await getOrderByReference(referenceId);

    // Recovery path: no pending row was saved at checkout time, but the
    // browser remembered the checkoutId — rebuild the order from Nomod.
    if (!order && checkoutId) {
      console.log(`No order row for ${referenceId}; attempting recovery via checkout ${checkoutId}`);
      order = await recoverOrderFromNomod(referenceId, checkoutId);
    }

    if (!order) {
      console.error('No order found for reference_id:', referenceId);
      return { statusCode: 200, body: JSON.stringify({ paid: false, error: 'No matching order found.' }) };
    }

    if (order.status === 'paid') {
      // Already processed on a previous call — nothing more to do.
      return { statusCode: 200, body: JSON.stringify({ paid: true, alreadyProcessed: true, order: order }) };
    }

    const nomodRes = await fetch(`${NOMOD_BASE}/checkout/${order.nomod_checkout_id}`, {
      headers: { 'X-API-KEY': NOMOD_API_KEY }
    });
    if (!nomodRes.ok) {
      const errText = await nomodRes.text();
      console.error(`Nomod GET checkout failed (status ${nomodRes.status}) for checkout ${order.nomod_checkout_id}:`, errText);
      return { statusCode: 200, body: JSON.stringify({ paid: false, error: 'Could not verify this checkout session with Nomod.' }) };
    }
    const nomodData = await nomodRes.json();
    console.log(`Nomod checkout ${order.nomod_checkout_id} status:`, nomodData.status);

    if (nomodData.status !== 'paid') {
      return { statusCode: 200, body: JSON.stringify({ paid: false, status: nomodData.status }) };
    }

    var items = JSON.parse(order.items || '[]');
    var sareeIds = items.map(function (it) { return it.id; });

    await markSareesSold(sareeIds);
    if (order.id) await markOrderPaid(order.id);
    await markPromoCodeUsed(order.promo_code);
    await sendReceiptEmail(order, extractPaymentMethod(nomodData));

    return { statusCode: 200, body: JSON.stringify({ paid: true, order: order }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong verifying your order.' }) };
  }
};
