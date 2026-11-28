// netlify/functions/admin-list-abandoned-carts.js
//
// POST { adminToken, idleDays }   (idleDays defaults to 7)
// Lists customers who:
//   - opted in to offers (verified_visitors.marketing_opt_in), and
//   - have items in their saved cart, and
//   - haven't touched the cart for at least idleDays, and
//   - haven't placed a paid order since they last changed the cart
//     (covers a customer who paid but closed the tab before the
//     success page cleared their cart).
// Returns each customer's raw cart lines ({id, qty}); the admin page
// prices them from products-data.js. Also reports their last offer so
// the page can enforce the 30-day pause, and how many offers went out
// in the last 30 days.

const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NOT_A_SALE = ['pending', 'cod_pending', 'cancelled', 'payment_error', 'refunded'];
const PAUSE_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

function headers() {
  return { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
}
async function get(path, tolerateMissing) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers() });
  if (!res.ok) {
    if (tolerateMissing) return [];
    throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}
function inList(emails) {
  return encodeURIComponent('(' + emails.map(function (e) { return '"' + e.replace(/"/g, '') + '"'; }).join(',') + ')');
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
  const idleDays = [0, 7, 14, 30].indexOf(Number(body.idleDays)) !== -1 ? Number(body.idleDays) : 7;

  try {
    const visitors = await get('verified_visitors?marketing_opt_in=eq.true&select=email,cart_updated_at');
    const optedIn = {};
    visitors.forEach(function (v) { optedIn[String(v.email).toLowerCase()] = v; });
    const emails = Object.keys(optedIn);
    const now = Date.now();

    // Offers sent in the last 30 days, across everyone (for the stat card).
    const recentOffers = await get('cart_offers?select=email,discount_percent,code,expires_at,sent_at&order=sent_at.desc&limit=2000', true);
    const sentLast30 = recentOffers.filter(function (o) { return now - new Date(o.sent_at).getTime() < PAUSE_DAYS * DAY; }).length;

    if (!emails.length) {
      return { statusCode: 200, body: JSON.stringify({ customers: [], idleDays: idleDays, offersSent30d: sentLast30 }) };
    }

    const inE = inList(emails);
    const [cartRows, orders] = await Promise.all([
      get(`cart_items?email=in.${inE}&select=email,saree_id,qty,added_at`),
      get(`orders?customer_email=in.${inE}&select=customer_email,status,created_at`)
    ]);

    const carts = {};
    cartRows.forEach(function (r) {
      const e = String(r.email).toLowerCase();
      (carts[e] = carts[e] || []).push(r);
    });
    const paid = {};
    orders.forEach(function (o) {
      if (NOT_A_SALE.indexOf(o.status) !== -1) return;
      const e = String(o.customer_email || '').toLowerCase();
      (paid[e] = paid[e] || []).push(new Date(o.created_at).getTime());
    });
    const lastOfferBy = {};
    recentOffers.forEach(function (o) {
      const e = String(o.email).toLowerCase();
      if (!lastOfferBy[e]) lastOfferBy[e] = o; // list is newest-first
    });

    const customers = [];
    Object.keys(carts).forEach(function (e) {
      const lines = carts[e];
      if (!lines.length) return;
      // Last cart activity: the tracked time, or (for carts that
      // existed before tracking began) the newest item's added_at.
      let last = optedIn[e].cart_updated_at ? new Date(optedIn[e].cart_updated_at).getTime() : 0;
      if (!last) lines.forEach(function (l) { last = Math.max(last, new Date(l.added_at).getTime() || 0); });
      if (!last) return;
      const idle = Math.floor((now - last) / DAY);
      if (idle < idleDays) return;
      const myPaid = paid[e] || [];
      if (myPaid.some(function (t) { return t >= last; })) return;
      const lo = lastOfferBy[e] || null;
      const blockedUntil = lo ? new Date(lo.sent_at).getTime() + PAUSE_DAYS * DAY : 0;
      customers.push({
        email: e,
        cartUpdatedAt: new Date(last).toISOString(),
        idleDays: idle,
        items: lines.map(function (l) { return { id: l.saree_id, qty: Number(l.qty) || 1 }; }),
        orderCount: myPaid.length,
        lastOrderAt: myPaid.length ? new Date(Math.max.apply(null, myPaid)).toISOString() : null,
        lastOffer: lo,
        offerBlockedUntil: blockedUntil > now ? new Date(blockedUntil).toISOString() : null
      });
    });
    customers.sort(function (a, b) { return b.idleDays - a.idleDays; });

    return { statusCode: 200, body: JSON.stringify({ customers: customers, idleDays: idleDays, offersSent30d: sentLast30 }) };
  } catch (err) {
    console.error('admin-list-abandoned-carts failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load abandoned carts.' }) };
  }
};
