// netlify/functions/admin-send-cart-offer.js
//
// POST { adminToken, email, discountPercent (5-25), validFor ('24h'|'3d'|'7d') }
// Emails one opted-in customer a personal discount on the items in
// their saved cart:
//   1. checks they opted in, still have available items, and haven't
//      been sent an offer in the last 30 days;
//   2. prices the cart from the live catalogue (never from the browser);
//   3. creates a single-use promo code tied to their email;
//   4. sends the email (from offers@pavnika.ae, replies to support);
//   5. logs it in cart_offers (which is what enforces the 30-day pause).
// If the email can't be sent, the code is switched off again.

const { verifyAdminToken } = require('./_admin-auth');
const { fetchProductsFromGitHub } = require('./_order-shared');
const { sign } = require('./_unsub-token');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = 'Pavnika by Saranya <offers@pavnika.ae>';
const REPLY_TO = 'support@pavnika.ae';
const SITE = 'https://pavnika.ae';
const PAUSE_MS = 30 * 24 * 60 * 60 * 1000;
const TTL = { '24h': 24 * 3600e3, '3d': 3 * 24 * 3600e3, '7d': 7 * 24 * 3600e3 };
const TTL_TEXT = { '24h': '24 hours', '3d': '3 days', '7d': '7 days' };

function sb(extra) {
  return Object.assign({ 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, extra || {});
}
function aed(n) { return 'AED ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function suffix() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let o = '';
  for (let i = 0; i < 4; i++) o += chars[Math.floor(Math.random() * chars.length)];
  return o;
}
function price(p) {
  return (p.salePrice && Number(p.salePrice) > 0 && Number(p.salePrice) < Number(p.price)) ? Number(p.salePrice) : Number(p.price || 0);
}
function sold(p) { return !!(p.sold || (p.quantity !== null && p.quantity !== undefined && Number(p.quantity) <= 0)); }

function buildEmail(o) {
  const rows = o.lines.map(function (l) {
    return '<tr><td style="padding:10px 0;border-bottom:1px solid #f0e4da;width:64px;"><img src="' + esc(l.image) + '" width="56" style="display:block;border-radius:6px;" alt=""></td>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #f0e4da;font-size:14px;color:#3B2528;">' + esc(l.name) + (l.qty > 1 ? ' &times; ' + l.qty : '') + '<br><span style="font-size:12px;color:#8a7370;">' + esc(l.id) + '</span></td>' +
      '<td style="padding:10px 0;border-bottom:1px solid #f0e4da;font-size:14px;color:#3B2528;text-align:right;white-space:nowrap;">' + aed(l.line) + '</td></tr>';
  }).join('');
  return `<!doctype html><html><body style="margin:0;background:#F1E4D8;font-family:Helvetica,Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px 12px;">
 <div style="background:#ffffff;border-radius:10px;overflow:hidden;">
  <div style="background:#3B0F20;text-align:center;padding:22px 16px;"><img src="${SITE}/assets/email-logo.png" width="84" alt="Pavnika by Saranya" style="display:block;margin:0 auto;"></div>
  <div style="padding:28px 26px;">
   <p style="margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9C6B47;">Your offer is waiting</p>
   <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:26px;font-weight:600;color:#3B0F20;">Your curated selection awaits</h1>
   <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#3B2528;">The pieces you chose are still available. As a thank you for choosing them, here is a personal <b>${o.pct}% offer</b> on everything in your cart, valid for ${o.validText}.</p>
   <table style="width:100%;border-collapse:collapse;">${rows}</table>
   <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:14px;color:#3B2528;">
    <tr><td style="padding:3px 0;">Cart total</td><td style="text-align:right;">${aed(o.total)}</td></tr>
    <tr><td style="padding:3px 0;">Your discount (${o.pct}%)</td><td style="text-align:right;">&minus; ${aed(o.discount)}</td></tr>
    <tr><td style="padding:6px 0;font-weight:700;border-top:1px solid #e3d2c4;">You pay</td><td style="text-align:right;font-weight:700;border-top:1px solid #e3d2c4;">${aed(o.total - o.discount)}</td></tr>
   </table>
   <div style="margin:22px 0;border:1px dashed #9C6B47;border-radius:10px;text-align:center;padding:14px;">
    <div style="font-size:12px;color:#8a7370;">Your personal code</div>
    <div style="font-size:24px;letter-spacing:.12em;font-weight:700;color:#3B0F20;margin:4px 0;">${esc(o.code)}</div>
    <div style="font-size:12px;color:#8a7370;">Valid until ${esc(o.expiryText)} &middot; single use &middot; works only for ${esc(o.email)}</div>
   </div>
   <div style="text-align:center;"><a href="${SITE}/checkout.html" style="display:inline-block;background:#3B0F20;color:#ffffff;text-decoration:none;font-size:13px;letter-spacing:.1em;text-transform:uppercase;padding:14px 34px;border-radius:999px;">View my selection</a></div>
   <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#8a7370;text-align:center;">Enter your code in the promo box at checkout. Questions? Just reply to this email.</p>
  </div>
 </div>
 <p style="margin:16px 8px 0;font-size:11px;line-height:1.6;color:#8a7370;text-align:center;">You are receiving this because you chose to receive offers from Pavnika by Saranya.<br><a href="${o.unsubUrl}" style="color:#8a7370;">Unsubscribe</a> &middot; ${SITE.replace('https://', '')}</p>
</div></body></html>`;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }
  if (!verifyAdminToken(body.adminToken)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authorized. Please sign in again.' }) };
  }
  const fail = function (code, msg) { return { statusCode: code, body: JSON.stringify({ error: msg }) }; };

  const email = String(body.email || '').trim().toLowerCase();
  const pct = parseInt(body.discountPercent, 10);
  const validFor = String(body.validFor || '');
  if (!email) return fail(400, 'Customer email is missing.');
  if ([5, 10, 15, 20, 25].indexOf(pct) === -1) return fail(400, 'Please choose a discount of 5, 10, 15, 20 or 25%.');
  if (!TTL[validFor]) return fail(400, 'Please choose how long the code is valid for.');
  if (!RESEND_API_KEY) return fail(500, 'Email is not configured (RESEND_API_KEY missing).');

  let promoCode = null;
  try {
    // 1. Eligibility
    const vres = await fetch(`${SUPABASE_URL}/rest/v1/verified_visitors?email=eq.${encodeURIComponent(email)}&select=marketing_opt_in`, { headers: sb() });
    const v = (await vres.json())[0];
    if (!v || !v.marketing_opt_in) return fail(400, 'This customer has not opted in to offers.');

    const ores = await fetch(`${SUPABASE_URL}/rest/v1/cart_offers?email=eq.${encodeURIComponent(email)}&order=sent_at.desc&limit=1&select=sent_at`, { headers: sb() });
    if (ores.ok) {
      const last = (await ores.json())[0];
      if (last && Date.now() - new Date(last.sent_at).getTime() < PAUSE_MS) {
        return fail(400, 'An offer was already sent to this customer in the last 30 days.');
      }
    }

    // 2. Price their cart from the live catalogue
    const cres = await fetch(`${SUPABASE_URL}/rest/v1/cart_items?email=eq.${encodeURIComponent(email)}&select=saree_id,qty`, { headers: sb() });
    const cart = await cres.json();
    const { products } = await fetchProductsFromGitHub();
    const byId = {}; products.forEach(function (p) { byId[p.id] = p; });
    const lines = [];
    cart.forEach(function (c) {
      const p = byId[c.saree_id];
      if (!p || sold(p)) return;
      const qty = Number(c.qty) || 1;
      lines.push({ id: p.id, name: p.material || p.type || p.id, image: p.image || '', qty: qty, line: price(p) * qty });
    });
    if (!lines.length) return fail(400, 'Nothing in this cart is available any more.');
    const total = lines.reduce(function (s, l) { return s + l.line; }, 0);
    const discount = Math.round(total * pct) / 100;

    // 3. Promo code tied to this customer
    const expiresAt = new Date(Date.now() + TTL[validFor]);
    for (let attempt = 0; attempt < 3 && !promoCode; attempt++) {
      const code = 'SAVE' + pct + '-' + suffix();
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/promo_codes`, {
        method: 'POST', headers: sb({ 'Prefer': 'return=representation' }),
        body: JSON.stringify({ code: code, discount_percent: pct, expires_at: expiresAt.toISOString(), used: false, active: true, email: email })
      });
      if (pr.ok) promoCode = code;
      else if (attempt === 2) throw new Error('Could not create promo code: ' + await pr.text());
    }

    // 4. Send the email
    const unsubToken = sign(email);
    const unsubUrl = `${SITE}/.netlify/functions/unsubscribe-offers?t=${encodeURIComponent(unsubToken)}`;
    const expiryText = expiresAt.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true }) + ' (UAE time)';
    const html = buildEmail({ lines: lines, total: total, discount: discount, pct: pct, code: promoCode, validText: TTL_TEXT[validFor], expiryText: expiryText, email: email, unsubUrl: unsubUrl });
    const eres = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, reply_to: REPLY_TO, to: [email],
        subject: `Your curated selection awaits: ${pct}% off, just for you`,
        html: html,
        headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      })
    });
    if (!eres.ok) {
      const t = await eres.text();
      // Switch the unused code off again so nothing dangles.
      await fetch(`${SUPABASE_URL}/rest/v1/promo_codes?code=eq.${encodeURIComponent(promoCode)}`, { method: 'PATCH', headers: sb(), body: JSON.stringify({ active: false }) }).catch(function () {});
      throw new Error('Email could not be sent: ' + t);
    }

    // 5. Log it
    let logged = true;
    try {
      const lres = await fetch(`${SUPABASE_URL}/rest/v1/cart_offers`, {
        method: 'POST', headers: sb(),
        body: JSON.stringify({ email: email, discount_percent: pct, code: promoCode, expires_at: expiresAt.toISOString(), cart_total: total, discount_amount: discount })
      });
      if (!lres.ok) { logged = false; console.error('cart_offers log failed:', await lres.text()); }
    } catch (e) { logged = false; console.error('cart_offers log failed:', e); }

    return { statusCode: 200, body: JSON.stringify({ ok: true, code: promoCode, logged: logged, expiresAt: expiresAt.toISOString() }) };
  } catch (err) {
    console.error('admin-send-cart-offer failed:', err);
    return fail(500, String(err.message || 'Something went wrong.'));
  }
};
