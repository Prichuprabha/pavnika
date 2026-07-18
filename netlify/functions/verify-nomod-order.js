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

const NOMOD_API_KEY = process.env.NOMOD_API_KEY;
const NOMOD_BASE = 'https://api.nomod.com/v1';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const PRODUCTS_PATH = 'products-data.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'verify@mail.pavnika.ae';
const ADMIN_EMAIL = 'pavnikabysaranya@gmail.com';

function githubHeaders() {
  return {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

// Reads and parses products-data.js from GitHub. Returns
// { products, fileData } — fileData.sha is needed for committing back.
async function fetchProductsFromGitHub() {
  const fileUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${PRODUCTS_PATH}?ref=${GITHUB_BRANCH}`;
  const fileRes = await fetch(fileUrl, { headers: githubHeaders() });
  if (!fileRes.ok) throw new Error(`GitHub read error ${fileRes.status}`);
  const fileData = await fileRes.json();
  const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
  const match = content.match(/window\.PRODUCTS\s*=\s*(\[[\s\S]*\]);?\s*$/);
  if (!match) throw new Error('Could not parse products-data.js');
  return { products: JSON.parse(match[1]), fileData: fileData };
}

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
}

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

function formatAED(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function markPromoCodeUsed(code) {
  if (!code) return;
  await fetch(`${SUPABASE_URL}/rest/v1/promo_codes?code=eq.${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify({ used: true })
  });
}

async function markSareesSold(sareeIds) {
  const gh = await fetchProductsFromGitHub();
  const products = gh.products;
  const fileData = gh.fileData;

  var changed = false;
  products.forEach(function (p) {
    if (sareeIds.indexOf(p.id) !== -1 && !p.sold) {
      p.sold = true;
      changed = true;
    }
  });

  if (!changed) return; // already marked sold, nothing to commit

  const newContent = 'window.PRODUCTS = ' + JSON.stringify(products, null, 2) + ';\n';
  await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${PRODUCTS_PATH}`, {
    method: 'PUT',
    headers: githubHeaders(),
    body: JSON.stringify({
      message: `Order confirmed: mark ${sareeIds.join(', ')} as sold`,
      content: Buffer.from(newContent, 'utf-8').toString('base64'),
      sha: fileData.sha,
      branch: GITHUB_BRANCH
    })
  });
}

// Builds an order number like "0231062601": HH + MM + DD + YY (UAE time)
// + 2-digit same-day sequence. Same scheme as create-nomod-checkout.
async function generateOrderNumber() {
  var now = new Date(Date.now() + 4 * 60 * 60 * 1000);
  var hh = String(now.getUTCHours()).padStart(2, '0');
  var mm = String(now.getUTCMinutes()).padStart(2, '0');
  var dd = String(now.getUTCDate()).padStart(2, '0');
  var yy = String(now.getUTCFullYear()).slice(-2);

  var dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), -4, 0, 0)).toISOString();
  var dayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, -4, 0, 0)).toISOString();

  var seq = 1;
  try {
    var res = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?select=id&created_at=gte.${dayStart}&created_at=lt.${dayEnd}`,
      { headers: supabaseHeaders() }
    );
    if (res.ok) {
      var rows = await res.json();
      seq = rows.length + 1;
    }
  } catch (e) {
    console.error('Could not count today\'s orders, defaulting sequence to 1:', e);
  }
  return hh + mm + dd + yy + String(seq).padStart(2, '0');
}

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

function buildItemDescription(it) {
  // e.g. "VALUE WEAVES (VW001) Semi Silk Korvai saree in Yellow and Red & Golden Motif Pattern"
  var line = '';
  if (it.series) line += it.series + ' (' + it.id + ') ';
  line += it.type ? (it.type + ' saree') : 'Saree';
  if (it.sareeType) line += ' in ' + it.sareeType;
  if (it.pattern) {
    var patternText = /pattern\s*$/i.test(it.pattern) ? it.pattern : (it.pattern + ' Pattern');
    line += (it.sareeType ? ' & ' : ' with ') + patternText;
  }
  return line;
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

async function sendReceiptEmail(order, nomodData) {
  var items = JSON.parse(order.items || '[]');
  var billing = JSON.parse(order.billing_address || '{}');
  var shipping = JSON.parse(order.shipping_address || '{}');
  var paymentMethod = extractPaymentMethod(nomodData);

  function addressHtml(addr) {
    if (!addr.building && !addr.city) return '<span style="color:#8a8880;">(not provided)</span>';
    return `${addr.building || ''}, ${addr.street || ''}<br>${addr.city || ''}, ${addr.state || ''} ${addr.pincode || ''}<br>${addr.country || ''}`;
  }

  var sameAddress = JSON.stringify(billing) === JSON.stringify(shipping);

  var itemRows = items.map(function (it) {
    return `
      <tr>
        <td style="padding:10px; border-bottom:1px solid #ece8de;">
          ${it.image ? `<img src="${it.image}" alt="${it.id}" width="60" style="border-radius:3px; display:block;">` : ''}
        </td>
        <td style="padding:10px; border-bottom:1px solid #ece8de; font-size:13px; color:#1B241E;">
          ${buildItemDescription(it)}
        </td>
        <td style="padding:10px; border-bottom:1px solid #ece8de; font-size:13px; font-weight:bold; color:#0E4B39; white-space:nowrap;">
          AED ${formatAED(it.price)}
        </td>
      </tr>`;
  }).join('');

  var html = `
    <div style="font-family:sans-serif; max-width:560px; margin:0 auto; background:#FAF7EF;">
      <div style="background:#082E22; padding:28px 24px; text-align:center; border-radius:6px 6px 0 0;">
        <div style="width:44px; height:44px; border-radius:50%; background:#0E4B39; margin:0 auto 10px; display:flex; align-items:center; justify-content:center; color:#E3C976; font-family:Georgia,serif; font-size:20px;">P</div>
        <p style="font-family:Georgia,serif; font-size:20px; color:#FAF7EF; margin:0 0 4px;">Thank you for your purchase!</p>
        <p style="font-size:11.5px; color:#E3C976; margin:0;">Our team will be in touch shortly to arrange shipment.</p>
      </div>
      <div style="padding:22px 24px; color:#1B241E;">
      <p style="color:#666666; font-size:13px; margin-top:0;">Order #${order.order_number || order.nomod_checkout_id}</p>

      <div style="background:#F0EAD9; border-radius:6px; padding:14px 18px; margin:16px 0;">
        <p style="margin:0 0 4px; color:#1B241E;"><strong>Customer:</strong> ${order.customer_name || '(not provided)'}</p>
        <p style="margin:0 0 4px; color:#1B241E;"><strong>Email:</strong> ${order.customer_email || '(not provided)'}</p>
        <p style="margin:0; color:#1B241E;"><strong>Phone:</strong> ${order.customer_phone || '(not provided)'}</p>
      </div>

      <div style="display:flex; gap:16px; margin:16px 0; flex-wrap:wrap;">
        <div style="flex:1; min-width:220px; background:#FFFFFF; border:1px solid #ece8de; border-radius:6px; padding:14px 16px;">
          <p style="margin:0 0 8px; font-size:11px; text-transform:uppercase; color:#5c6b62;">Billing Address</p>
          <p style="margin:0; font-size:13px; line-height:1.6; color:#1B241E;">${addressHtml(billing)}</p>
        </div>
        <div style="flex:1; min-width:220px; background:#FFFFFF; border:1px solid #ece8de; border-radius:6px; padding:14px 16px;">
          <p style="margin:0 0 8px; font-size:11px; text-transform:uppercase; color:#5c6b62;">Shipping Address ${sameAddress ? '(same as billing)' : ''}</p>
          <p style="margin:0; font-size:13px; line-height:1.6; color:#1B241E;">${addressHtml(shipping)}</p>
        </div>
      </div>

      <table style="border-collapse:collapse; width:100%; margin:16px 0;">
        <thead>
          <tr style="text-align:left;">
            <th style="padding:8px 10px; font-size:11px; text-transform:uppercase; color:#5c6b62;">Saree</th>
            <th style="padding:8px 10px; font-size:11px; text-transform:uppercase; color:#5c6b62;">Description</th>
            <th style="padding:8px 10px; font-size:11px; text-transform:uppercase; color:#5c6b62;">Price</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div style="border-top:1px solid #ece8de; padding-top:10px; margin-top:6px;">
        <div style="display:flex; justify-content:space-between; font-size:12.5px; color:#5c6b62; margin-bottom:4px;"><span>Subtotal</span><span>AED ${formatAED(order.subtotal || order.total)}</span></div>
        ${(order.discount_amount && Number(order.discount_amount) > 0) ? `<div style="display:flex; justify-content:space-between; font-size:12.5px; color:#3B6D11; font-weight:600; margin-bottom:4px;"><span>${order.promo_code ? order.promo_code + ' discount' : 'Discount'}</span><span>-AED ${formatAED(order.discount_amount)}</span></div>` : ''}
      </div>
      ${paymentMethod ? `
      <div style="border:1px solid #ece8de; border-radius:6px; padding:10px 14px; margin:14px 0; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:12px; color:#5c6b62;">Payment method</span>
        <span style="font-size:13px; font-weight:600; color:#1B241E;">${paymentMethod}</span>
      </div>` : ''}
      <p style="font-size:20px; font-weight:bold; color:#0E4B39; margin-top:18px;">Total paid: AED ${formatAED(order.total)}</p>
      </div>
    </div>
  `;

  var recipients = [ADMIN_EMAIL];
  if (order.customer_email) recipients.push(order.customer_email);

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: recipients,
      subject: `Order #${order.order_number || order.nomod_checkout_id} — AED ${formatAED(order.total)} — Payment confirmed`,
      html: html
    })
  });
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
    await sendReceiptEmail(order, nomodData);

    return { statusCode: 200, body: JSON.stringify({ paid: true, order: order }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong verifying your order.' }) };
  }
};
