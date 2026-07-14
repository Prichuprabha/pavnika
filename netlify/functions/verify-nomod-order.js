// netlify/functions/verify-nomod-order.js
//
// POST { checkoutId }
// - Calls Nomod's GET /v1/checkout/:id directly, server-to-server, to
//   confirm the real payment status — this is the actual source of
//   truth, never the browser redirect alone.
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
  const headers = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
  const fileUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${PRODUCTS_PATH}?ref=${GITHUB_BRANCH}`;
  const fileRes = await fetch(fileUrl, { headers: headers });
  if (!fileRes.ok) throw new Error(`GitHub read error ${fileRes.status}`);
  const fileData = await fileRes.json();
  const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
  const match = content.match(/window\.PRODUCTS\s*=\s*(\[[\s\S]*\]);?\s*$/);
  if (!match) throw new Error('Could not parse products-data.js');
  const products = JSON.parse(match[1]);

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
    headers: headers,
    body: JSON.stringify({
      message: `Order confirmed: mark ${sareeIds.join(', ')} as sold`,
      content: Buffer.from(newContent, 'utf-8').toString('base64'),
      sha: fileData.sha,
      branch: GITHUB_BRANCH
    })
  });
}

async function sendReceiptEmail(order, nomodData) {
  var items = JSON.parse(order.items || '[]');
  var itemLines = items.map(function (it) {
    return `<tr><td style="padding:6px 10px;">${it.id}</td><td style="padding:6px 10px;">${it.name || ''}</td><td style="padding:6px 10px;">AED ${formatAED(it.price)}</td></tr>`;
  }).join('');

  var html = `
    <div style="font-family:sans-serif; max-width:520px; margin:0 auto;">
      <h2 style="color:#0E4B39;">New Order — Payment Confirmed</h2>
      <p><strong>Customer:</strong> ${order.customer_name || '(not provided)'}</p>
      <p><strong>Email:</strong> ${order.customer_email || '(not provided)'}</p>
      <p><strong>Phone:</strong> ${order.customer_phone || '(not provided)'}</p>
      <table style="border-collapse:collapse; width:100%; margin:16px 0;">
        <thead><tr style="background:#F0EAD9; text-align:left;"><th style="padding:6px 10px;">ID</th><th style="padding:6px 10px;">Item</th><th style="padding:6px 10px;">Price</th></tr></thead>
        <tbody>${itemLines}</tbody>
      </table>
      ${order.promo_code ? `<p><strong>Promo code used:</strong> ${order.promo_code}</p>` : ''}
      <p style="font-size:18px; font-weight:bold; color:#0E4B39;">Total paid: AED ${formatAED(order.total)}</p>
      <p style="color:#666; font-size:13px;">Nomod checkout reference: ${order.nomod_checkout_id}</p>
    </div>
  `;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `New order — AED ${formatAED(order.total)} — Payment confirmed`,
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
  if (!referenceId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing order reference.' }) };
  }

  try {
    const order = await getOrderByReference(referenceId);
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
    await markOrderPaid(order.id);
    await markPromoCodeUsed(order.promo_code);
    await sendReceiptEmail(order, nomodData);

    return { statusCode: 200, body: JSON.stringify({ paid: true, order: order }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong verifying your order.' }) };
  }
};
