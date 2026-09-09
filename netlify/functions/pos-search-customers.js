const { verifyPosToken } = require('./_pos-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Same list script.js uses for checkout, duplicated here since this
// runs server-side and can't reach the front-end file. Needed to split
// an online order's combined "+971501234567" back into the country
// code + local number the POS form expects as two separate fields.
const PHONE_COUNTRY_CODES = [
  { code: '971', leadingZero: true },
  { code: '91', leadingZero: false },
  { code: '966', leadingZero: false },
  { code: '968', leadingZero: false },
  { code: '974', leadingZero: false },
  { code: '973', leadingZero: false },
  { code: '965', leadingZero: false },
  { code: '44', leadingZero: false },
  { code: '1', leadingZero: false }
];

function splitPhone(raw) {
  var digits = String(raw || '').replace(/[^\d]/g, '');
  if (!digits) return { code: '971', number: '' };
  // Longest code first, so +971... doesn't get mis-split by the +91 India
  // entry matching its first two digits.
  var sorted = PHONE_COUNTRY_CODES.slice().sort(function (a, b) { return b.code.length - a.code.length; });
  var match = sorted.find(function (c) { return digits.indexOf(c.code) === 0; });
  if (match) return { code: match.code, number: digits.slice(match.code.length) };
  return { code: '971', number: digits };
}

function flattenAddress(raw) {
  var a;
  try { a = JSON.parse(raw || '{}'); } catch (e) { a = {}; }
  return [a.building, a.street, a.city].filter(Boolean).join(', ');
}

function stateToEmirate(raw) {
  var s = String(raw || '').trim().toLowerCase();
  // Only these three are actual options in the POS emirate selector —
  // matching against the exact label text since selectCustomer()
  // compares this value directly against each button's data-v.
  var known = { 'dubai': 'Dubai', 'abu dhabi': 'Abu Dhabi', 'sharjah': 'Sharjah' };
  return known[s] || '';
}

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
}

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

  if (!verifyPosToken(body.posToken)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Session expired, please log in again' }) };
  }

  var query = (body.query || '').trim();

  try {
    var url = `${SUPABASE_URL}/rest/v1/pos_customers?select=*&order=created_at.desc&limit=30`;
    if (query) {
      // Matches against name, phone OR email — a plain digit search
      // (like "5012") should find someone by phone just as easily as
      // typing part of their name, and typing an email should work too.
      var encoded = encodeURIComponent(`%${query}%`);
      url = `${SUPABASE_URL}/rest/v1/pos_customers?select=*&or=(name.ilike.${encoded},phone.ilike.${encoded},email.ilike.${encoded})&order=name.asc&limit=30`;
    }
    var res = await fetch(url, { headers: supabaseHeaders() });
    if (!res.ok) throw new Error(`Supabase query failed: ${res.status}`);
    var customers = await res.json();

    var onlineMatches = [];
    if (query) {
      // Only searched when the person types something — an empty query
      // (the default recent-customers view) has no meaningful online
      // equivalent to show alongside it.
      var existingPhones = new Set(customers.map(function (c) { return String(c.phone || '').replace(/[^\d]/g, ''); }).filter(Boolean));
      var existingEmails = new Set(customers.map(function (c) { return String(c.email || '').toLowerCase(); }).filter(Boolean));

      var ordersRes = await fetch(
        `${SUPABASE_URL}/rest/v1/orders?select=id,order_number,created_at,customer_name,customer_email,customer_phone,total,status,shipping_address,billing_address&or=(customer_name.ilike.${encoded},customer_phone.ilike.${encoded},customer_email.ilike.${encoded})&order=created_at.desc&limit=50`,
        { headers: supabaseHeaders() }
      );
      var orders = ordersRes.ok ? await ordersRes.json() : [];

      // Group by email first (the more reliable identifier — every
      // online order has one), falling back to phone digits only when
      // email is somehow missing.
      var groups = {};
      orders.forEach(function (o) {
        var emailKey = String(o.customer_email || '').toLowerCase();
        var phoneDigits = String(o.customer_phone || '').replace(/[^\d]/g, '');
        var key = emailKey || phoneDigits;
        if (!key) return;
        // Skip anyone who already has a POS customer record matching
        // this email or phone — they're not a new find, just show
        // normally in the regular results above.
        if (existingEmails.has(emailKey) || existingPhones.has(phoneDigits)) return;

        if (!groups[key]) groups[key] = [];
        groups[key].push(o);
      });

      onlineMatches = Object.keys(groups).map(function (key) {
        var orderList = groups[key];
        var latest = orderList[0]; // orders already sorted newest-first
        var phoneSplit = splitPhone(latest.customer_phone);
        var addr = latest.shipping_address || latest.billing_address;
        var addrParsed;
        try { addrParsed = JSON.parse(addr || '{}'); } catch (e) { addrParsed = {}; }

        return {
          name: latest.customer_name || '',
          phoneCode: phoneSplit.code,
          phoneNumber: phoneSplit.number,
          email: latest.customer_email || '',
          address: flattenAddress(addr),
          emirate: stateToEmirate(addrParsed.state),
          orderCount: orderList.length,
          totalSpent: orderList.reduce(function (sum, o) { return sum + (Number(o.total) || 0); }, 0),
          orders: orderList.slice(0, 5).map(function (o) {
            return { orderNumber: o.order_number, date: o.created_at, total: o.total, status: o.status };
          })
        };
      });
    }

    return { statusCode: 200, body: JSON.stringify({ customers: customers, onlineMatches: onlineMatches }) };
  } catch (e) {
    console.error('pos-search-customers error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong, please try again' }) };
  }
};
