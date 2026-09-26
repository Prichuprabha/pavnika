// netlify/functions/admin-list-customers.js
//
// POST { adminToken }
// - Returns every customer who has ever actually purchased something,
//   whether online, in-store, or both — merged by email (case-
//   insensitive), since these are two independent identity sources:
//   pos_customers (created by an in-store sale, or by a return
//   credited to store credit) and orders (every website purchase,
//   which never itself creates a pos_customers row). A customer who
//   has only ever bought online would be invisible if this only read
//   pos_customers, which is most of this business's actual customers.
// - "Spend" only counts orders/sales that represent real money kept:
//   excludes pending, cod_pending, cancelled, payment_error, and a
//   fully cash/bank-refunded order (status 'refunded') — matching the
//   same revenue exclusion used in the Orders tab. A gift-card refund
//   (status 'refunded_giftcard') still counts, same reasoning as
//   revenue reporting elsewhere: that money never actually left.
// - In-store spend is the raw pos_sales total, matching how it's
//   already shown elsewhere in this codebase (POS returns aren't
//   netted out of it there either) — kept consistent rather than
//   introducing a different, stricter method just for this view.
// - Online-only customers (no pos_customers row yet) are returned with
//   customerId: null and giftCardBalance: 0; admin-update-customer.js
//   creates their pos_customers row the first time their details are
//   edited, rather than requiring one to exist upfront.
const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SPEND_EXCLUDED_STATUSES = ['pending', 'cod_pending', 'cancelled', 'payment_error', 'refunded'];

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  };
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

  const session = verifyAdminToken(body.adminToken);
  if (!session) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authorized. Please sign in again.' }) };
  }

  try {
    const [custRes, salesRes, ordersRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/pos_customers?select=id,name,email,phone,phone_country_code,gift_card_balance`, { headers: supabaseHeaders() }),
      fetch(`${SUPABASE_URL}/rest/v1/pos_sales?select=customer_id,total,created_at`, { headers: supabaseHeaders() }),
      fetch(`${SUPABASE_URL}/rest/v1/orders?select=customer_email,customer_name,customer_phone,total,status,created_at`, { headers: supabaseHeaders() })
    ]);
    if (!custRes.ok) throw new Error(`pos_customers query failed: ${custRes.status}`);
    if (!salesRes.ok) throw new Error(`pos_sales query failed: ${salesRes.status}`);
    if (!ordersRes.ok) throw new Error(`orders query failed: ${ordersRes.status}`);

    const posCustomers = await custRes.json();
    const posSales = await salesRes.json();
    const orders = await ordersRes.json();

    // Keyed by lowercased email — the one identity both sources share.
    // A pos_customers row with no email at all (rare, in-store walk-in)
    // is kept under its own id-based key instead, since it can't be
    // merged with anything.
    const byKey = {};

    posCustomers.forEach(function (c) {
      const key = c.email ? c.email.toLowerCase() : 'no-email:' + c.id;
      byKey[key] = {
        customerId: c.id,
        name: c.name || '',
        email: c.email || '',
        phone: c.phone || '',
        phoneCountryCode: c.phone_country_code || '',
        giftCardBalance: Number(c.gift_card_balance) || 0,
        onlineSpend: 0, onlineOrders: 0, lastOnline: null,
        inStoreSpend: 0, inStoreOrders: 0, lastInStore: null
      };
    });

    const custIdToKey = {};
    Object.keys(byKey).forEach(function (key) { custIdToKey[byKey[key].customerId] = key; });

    posSales.forEach(function (s) {
      const key = custIdToKey[s.customer_id];
      if (!key) return; // sale tied to a customer that no longer exists — skip rather than guess
      const rec = byKey[key];
      rec.inStoreSpend += Number(s.total) || 0;
      rec.inStoreOrders += 1;
      if (!rec.lastInStore || new Date(s.created_at) > new Date(rec.lastInStore)) rec.lastInStore = s.created_at;
    });

    orders.forEach(function (o) {
      if (!o.customer_email) return;
      const key = o.customer_email.toLowerCase();
      if (!byKey[key]) {
        // A customer who has only ever bought online — no pos_customers
        // row exists for them yet.
        byKey[key] = {
          customerId: null,
          name: o.customer_name || '',
          email: o.customer_email,
          phone: o.customer_phone || '',
          phoneCountryCode: '',
          giftCardBalance: 0,
          onlineSpend: 0, onlineOrders: 0, lastOnline: null,
          inStoreSpend: 0, inStoreOrders: 0, lastInStore: null
        };
      }
      const rec = byKey[key];
      if (!rec.name && o.customer_name) rec.name = o.customer_name;
      if (!rec.phone && o.customer_phone) rec.phone = o.customer_phone;
      if (SPEND_EXCLUDED_STATUSES.indexOf(o.status) === -1) {
        rec.onlineSpend += Number(o.total) || 0;
        rec.onlineOrders += 1;
        if (!rec.lastOnline || new Date(o.created_at) > new Date(rec.lastOnline)) rec.lastOnline = o.created_at;
      }
    });

    const customers = Object.keys(byKey).map(function (key) {
      const rec = byKey[key];
      const lastPurchase = [rec.lastOnline, rec.lastInStore].filter(Boolean).sort().reverse()[0] || null;
      return {
        customerId: rec.customerId,
        name: rec.name,
        email: rec.email,
        phone: rec.phone,
        phoneCountryCode: rec.phoneCountryCode,
        giftCardBalance: rec.giftCardBalance,
        onlineSpend: Math.round(rec.onlineSpend * 100) / 100,
        onlineOrders: rec.onlineOrders,
        inStoreSpend: Math.round(rec.inStoreSpend * 100) / 100,
        inStoreOrders: rec.inStoreOrders,
        totalSpend: Math.round((rec.onlineSpend + rec.inStoreSpend) * 100) / 100,
        totalOrders: rec.onlineOrders + rec.inStoreOrders,
        lastPurchase: lastPurchase
      };
    }).filter(function (c) { return c.totalOrders > 0 || c.giftCardBalance > 0; });
    // A pos_customers row with zero orders and zero balance (e.g. a
    // walk-in profile created but never actually sold to) isn't a
    // "previously purchased" customer, so it's left out of this list.

    return { statusCode: 200, body: JSON.stringify({ customers: customers }) };
  } catch (err) {
    console.error('admin-list-customers failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load customers: ' + err.message }) };
  }
};
