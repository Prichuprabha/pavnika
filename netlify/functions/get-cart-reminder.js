// netlify/functions/get-cart-reminder.js
//
// POST { visitorToken }
// For the website's "your selection is waiting" reminder popup.
// Returns when this signed-in customer last changed their cart, and
// (if we emailed them an offer that is still usable) that offer, so
// the popup can remind them of it.
//   { cartUpdatedAt: iso|null, offer: { code, percent, expiresAt } | null }

const { verifyVisitorToken } = require('./_visitor-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };

async function get(path, tolerate) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: H });
  if (!res.ok) { if (tolerate) return []; throw new Error('Supabase error ' + res.status + ': ' + await res.text()); }
  return res.json();
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }
  const who = verifyVisitorToken(body.visitorToken);
  if (!who) return { statusCode: 401, body: JSON.stringify({ error: 'Not verified or session expired.' }) };
  const email = String(who.email).toLowerCase();
  const e = encodeURIComponent(email);

  try {
    const [vis, items, offers] = await Promise.all([
      get(`verified_visitors?email=eq.${e}&select=cart_updated_at`, true),
      get(`cart_items?email=eq.${e}&select=added_at`, true),
      get(`cart_offers?email=eq.${e}&order=sent_at.desc&limit=1&select=code,discount_percent,expires_at`, true)
    ]);
    let last = vis[0] && vis[0].cart_updated_at ? new Date(vis[0].cart_updated_at).getTime() : 0;
    if (!last) items.forEach(function (i) { last = Math.max(last, new Date(i.added_at).getTime() || 0); });

    let offer = null;
    const o = offers[0];
    if (o && new Date(o.expires_at).getTime() > Date.now()) {
      // Only show it if the code can still actually be used.
      const pr = await get(`promo_codes?code=eq.${encodeURIComponent(o.code)}&select=used,active,expires_at`, true);
      if (pr[0] && pr[0].active && !pr[0].used && new Date(pr[0].expires_at).getTime() > Date.now()) {
        offer = { code: o.code, percent: o.discount_percent, expiresAt: o.expires_at };
      }
    }
    return { statusCode: 200, body: JSON.stringify({ cartUpdatedAt: last ? new Date(last).toISOString() : null, offer: offer }) };
  } catch (err) {
    console.error('get-cart-reminder failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong.' }) };
  }
};
