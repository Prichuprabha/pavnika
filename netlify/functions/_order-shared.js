// netlify/functions/_order-shared.js
//
// Shared between verify-nomod-order.js (online Nomod payments) and
// admin-create-manual-order.js (bank transfer/cash/manually-confirmed
// Nomod). Both need to generate the same order-number format and send
// the exact same confirmation email — extracted here once so there's
// a single source of truth instead of two copies that could drift
// apart over time.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'verify@pavnika.ae';
const ADMIN_EMAIL = 'pavnikabysaranya@gmail.com';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const PRODUCTS_PATH = 'products-data.js';

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

// Marks the given saree IDs as sold in the live catalogue (a GitHub
// commit, same mechanism the rest of the admin panel already uses).
// Used both when an online Nomod payment is confirmed and when a
// manual (bank transfer/cash) order is recorded — either way, a real
// sale should stop that saree being purchasable again.
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

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
}

function formatAED(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

async function generateOrderNumber() {
  var now = new Date(Date.now() + 4 * 60 * 60 * 1000);
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
      { headers: supabaseHeaders() }
    );
    if (res.ok) {
      var rows = await res.json();
      seq = rows.length + 1;
    }
  } catch (e) {
    console.error('Could not count today\'s orders, defaulting sequence to 1:', e);
  }
  return hh + mm + dd + mo + yy + String(seq).padStart(2, '0');
}

// paymentMethodLabel is a plain string (e.g. "Nomod", "Bank Transfer",
// "Cash •••• 1234") — callers are responsible for deriving it from
// whatever their own source is (Nomod's response shape for online
// orders, or a straightforward admin-selected value for manual ones),
// keeping this function itself agnostic to where the order came from.
async function sendReceiptEmail(order, paymentMethodLabel) {
  var items = JSON.parse(order.items || '[]');
  var billing = JSON.parse(order.billing_address || '{}');
  var shipping = JSON.parse(order.shipping_address || '{}');

  function addressHtml(addr) {
    if (!addr.building && !addr.city) return '<span style="color:#a08b7f;">(not provided)</span>';
    return `${addr.building || ''}, ${addr.street || ''}<br>${addr.city || ''}, ${addr.state || ''} ${addr.pincode || ''}<br>${addr.country || ''}`;
  }

  function formatOrderDate(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }

  var sameAddress = JSON.stringify(billing) === JSON.stringify(shipping);

  var itemRows = items.map(function (it) {
    return `
      <tr>
        <td style="padding:10px; border-bottom:1px solid #DED0C7;">
          ${it.image ? `<img src="${it.image}" alt="${it.id}" width="60" style="border-radius:3px; display:block;">` : ''}
        </td>
        <td style="padding:10px; border-bottom:1px solid #DED0C7; font-size:13px; color:#3B2528;">
          ${buildItemDescription(it)}
          <br><span style="font-size:10px; color:#a08b7f;">Qty: ${it.qty || 1} &middot; Condition: New</span>
        </td>
        <td style="padding:10px; border-bottom:1px solid #DED0C7; font-size:13px; font-weight:bold; color:#B68A69; white-space:nowrap;">
          AED ${formatAED(it.price)}
        </td>
      </tr>`;
  }).join('');

  var html = `
    <div style="font-family:sans-serif; max-width:560px; margin:0 auto; background:#FCF5ED;">
      <div style="background:#3C1223; padding:28px 24px; text-align:center; border-radius:6px 6px 0 0;">
        <img src="https://pavnika.ae/assets/email-logo.png" alt="Pavnika by Saranya" width="94" height="90" style="display:block; margin:0 auto 12px;">
        <p style="font-family:Georgia,serif; font-size:20px; color:#FCF5ED; margin:0 0 4px;">Thank you for your purchase!</p>
        <p style="font-family:Georgia,serif; font-size:15px; color:#FCF5ED; margin:0 0 8px;" dir="rtl">شكراً لشرائك!</p>
        <p style="font-size:11.5px; color:#F6DFD5; margin:0;">Our team will be in touch shortly to arrange shipment.</p>
        <p style="font-size:11px; color:#F6DFD5; margin:2px 0 0;" dir="rtl">سيتواصل معك فريقنا قريباً لترتيب الشحن.</p>
      </div>
      <div style="padding:22px 24px; color:#3B2528;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
        <tr>
          <td style="font-size:13px; color:#8a6f63;">Order No. / رقم الطلب<br><strong style="color:#3B2528;">${order.order_number || order.nomod_checkout_id}</strong></td>
          <td align="right" style="font-size:13px; color:#8a6f63;">Date / التاريخ<br><strong style="color:#3B2528;">${formatOrderDate(order.created_at)}</strong></td>
        </tr>
      </table>

      <div style="background:#FFFFFF; border:1px solid #DED0C7; border-radius:6px; padding:14px 16px; margin:0 0 16px;">
        <p style="margin:0 0 6px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Sold by / <span dir="rtl" style="text-transform:none;">البائع</span></p>
        <p style="margin:0 0 3px; font-size:13px; font-weight:600; color:#3B2528;">Pavnika Online Seller, trading as Pavnika by Saranya</p>
        <p style="margin:0 0 3px; font-size:12px; color:#3B2528; line-height:1.6;">Al Barsha South 4, Dubai, United Arab Emirates</p>
        <p style="margin:0 0 3px; font-size:12px; color:#3B2528;">Licensed by Dubai Department of Economy &amp; Tourism — License No. 1563920</p>
        <p style="margin:0; font-size:12px; color:#3B2528;">support@pavnika.ae &nbsp;&middot;&nbsp; +971 52 66 30307</p>
      </div>

      <div style="background:#F8ECE2; border-radius:6px; padding:14px 18px; margin:16px 0;">
        <p style="margin:0 0 2px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Customer / <span dir="rtl" style="text-transform:none;">العميل</span></p>
        <p style="margin:0 0 4px; color:#3B2528;"><strong>${order.customer_name || '(not provided)'}</strong></p>
        <p style="margin:0 0 4px; color:#3B2528; font-size:13px;">${order.customer_email || '(not provided)'}</p>
        <p style="margin:0; color:#3B2528; font-size:13px;">${order.customer_phone || '(not provided)'}</p>
      </div>

      <div style="display:flex; gap:16px; margin:16px 0; flex-wrap:wrap;">
        <div style="flex:1; min-width:220px; background:#FFFFFF; border:1px solid #DED0C7; border-radius:6px; padding:14px 16px;">
          <p style="margin:0 0 8px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Billing Address / <span dir="rtl" style="text-transform:none;">عنوان الفاتورة</span></p>
          <p style="margin:0; font-size:13px; line-height:1.6; color:#3B2528;">${addressHtml(billing)}</p>
        </div>
        <div style="flex:1; min-width:220px; background:#FFFFFF; border:1px solid #DED0C7; border-radius:6px; padding:14px 16px;">
          <p style="margin:0 0 8px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Shipping Address ${sameAddress ? '(same as billing)' : ''} / <span dir="rtl" style="text-transform:none;">عنوان الشحن</span></p>
          <p style="margin:0; font-size:13px; line-height:1.6; color:#3B2528;">${addressHtml(shipping)}</p>
        </div>
      </div>

      <table style="border-collapse:collapse; width:100%; margin:16px 0;">
        <thead>
          <tr style="text-align:left;">
            <th style="padding:8px 10px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Saree</th>
            <th style="padding:8px 10px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Description / <span dir="rtl" style="text-transform:none;">الوصف</span></th>
            <th style="padding:8px 10px; font-size:11px; text-transform:uppercase; color:#8a6f63;">Price / <span dir="rtl" style="text-transform:none;">السعر</span></th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div style="border-top:1px solid #DED0C7; padding-top:10px; margin-top:6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:12.5px; color:#8a6f63; padding-bottom:4px;">Subtotal / <span dir="rtl" style="text-transform:none;">المجموع الفرعي</span></td>
            <td align="right" style="font-size:12.5px; color:#8a6f63; padding-bottom:4px;">AED ${formatAED(order.subtotal || order.total)}</td>
          </tr>
          ${(order.discount_amount && Number(order.discount_amount) > 0) ? `<tr>
            <td style="font-size:12.5px; color:#946B4A; font-weight:600; padding-bottom:4px;">${order.promo_code ? order.promo_code + ' discount' : 'Discount'} / <span dir="rtl" style="text-transform:none; font-weight:400;">الخصم</span></td>
            <td align="right" style="font-size:12.5px; color:#946B4A; font-weight:600; padding-bottom:4px;">-AED ${formatAED(order.discount_amount)}</td>
          </tr>` : ''}
        </table>
      </div>
      ${paymentMethodLabel ? `
      <div style="border:1px solid #DED0C7; border-radius:6px; padding:10px 14px; margin:14px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:12px; color:#8a6f63;">Payment method / <span dir="rtl" style="text-transform:none;">طريقة الدفع</span>:</td>
            <td align="right" style="font-size:13px; font-weight:600; color:#3B2528;">${paymentMethodLabel}</td>
          </tr>
        </table>
      </div>` : ''}
      <p style="font-size:20px; font-weight:bold; color:#B68A69; margin-top:18px; margin-bottom:2px;">Total paid: AED ${formatAED(order.total)}</p>
      <p style="font-size:14px; font-weight:bold; color:#B68A69; margin:0 0 18px;" dir="rtl">المبلغ المدفوع: ${formatAED(order.total)} درهم إماراتي</p>

      <div style="border-top:1px solid #DED0C7; padding-top:14px; margin-top:6px;">
        <p style="font-size:11px; color:#a08b7f; line-height:1.7; margin:0 0 4px;">
          This document serves as your purchase receipt. For our Returns &amp; Exchange Policy, visit
          <a href="https://pavnika.ae/returns.html" style="color:#B68A69;">pavnika.ae/returns.html</a>.
          For any concern about this order, contact support@pavnika.ae or WhatsApp +971 52 66 30307.
        </p>
        <p style="font-size:11px; color:#a08b7f; line-height:1.7; margin:0;" dir="rtl">
          هذا المستند بمثابة إيصال الشراء الخاص بك. لسياسة الإرجاع والاستبدال، تفضل بزيارة
          pavnika.ae/returns.html. لأي استفسار بخصوص هذا الطلب، يرجى التواصل عبر support@pavnika.ae أو واتساب على 30307 66 52 971+.
        </p>
      </div>
      </div>
    </div>
  `;

  var toRecipients = order.customer_email ? [order.customer_email] : [ADMIN_EMAIL];
  var bccRecipients = order.customer_email ? [ADMIN_EMAIL] : [];

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      reply_to: 'support@pavnika.ae',
      to: toRecipients,
      bcc: bccRecipients,
      subject: `Order #${order.order_number || order.nomod_checkout_id} — AED ${formatAED(order.total)} — Payment confirmed`,
      html: html
    })
  });
}

async function markSareesAvailable(sareeIds) {
  const gh = await fetchProductsFromGitHub();
  const products = gh.products;
  const fileData = gh.fileData;

  var changed = false;
  products.forEach(function (p) {
    if (sareeIds.indexOf(p.id) !== -1 && p.sold) {
      p.sold = false;
      changed = true;
    }
  });

  if (!changed) return; // already available, nothing to commit

  const newContent = 'window.PRODUCTS = ' + JSON.stringify(products, null, 2) + ';\n';
  await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${PRODUCTS_PATH}`, {
    method: 'PUT',
    headers: githubHeaders(),
    body: JSON.stringify({
      message: `Return processed: mark ${sareeIds.join(', ')} as available again`,
      content: Buffer.from(newContent, 'utf-8').toString('base64'),
      sha: fileData.sha,
      branch: GITHUB_BRANCH
    })
  });
}

module.exports = {
  supabaseHeaders: supabaseHeaders,
  formatAED: formatAED,
  buildItemDescription: buildItemDescription,
  generateOrderNumber: generateOrderNumber,
  sendReceiptEmail: sendReceiptEmail,
  markSareesSold: markSareesSold,
  markSareesAvailable: markSareesAvailable,
  fetchProductsFromGitHub: fetchProductsFromGitHub
};
