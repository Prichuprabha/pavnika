// Lists sales for the Sales History page — deliberately separate from
// pos-search-original-sale.js (used by Return/Exchange), which
// excludes fully-returned sales since there's nothing left to act on
// there. Sales History is a historical record, so it always shows
// everything, with a status reflecting whether any items were
// returned or exchanged.
const { verifyPosToken } = require('./_pos-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  var session = verifyPosToken(body.posToken);
  if (!session) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Session expired, please log in again' }) };
  }
  if (!session.isAdmin) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  var query = (body.query || '').trim();
  var dateFilter = body.dateFilter || 'all';

  try {
    var dateClause = '';
    if (dateFilter !== 'all') {
      var days = dateFilter === 'today' ? 1 : (dateFilter === '7days' ? 7 : 30);
      var since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      dateClause = `&created_at=gte.${since}`;
    }

    var sales;

    if (!query) {
      var res = await fetch(`${SUPABASE_URL}/rest/v1/pos_sales?select=*&order=created_at.desc&limit=100${dateClause}`, { headers: supabaseHeaders() });
      if (!res.ok) throw new Error(`Supabase query failed: ${res.status}`);
      sales = await res.json();
    } else {
      // Search by bill number, customer (name/phone), and amount all
      // at once in parallel, then merge — rather than trying each one
      // sequentially and only falling back if the previous came back
      // empty, which was adding unnecessary round-trip latency.
      var encoded = encodeURIComponent(`%${query}%`);
      var numericQuery = parseFloat(query);
      var isNumeric = !isNaN(numericQuery) && /^[\d.]+$/.test(query);

      var billPromise = fetch(`${SUPABASE_URL}/rest/v1/pos_sales?select=*&bill_number=ilike.${encoded}&order=created_at.desc&limit=100${dateClause}`, { headers: supabaseHeaders() })
        .then(function (r) { return r.json(); });

      var custPromise = fetch(`${SUPABASE_URL}/rest/v1/pos_customers?or=(name.ilike.${encoded},phone.ilike.${encoded})&select=id`, { headers: supabaseHeaders() })
        .then(function (r) { return r.json(); })
        .then(function (custRows) {
          if (!custRows.length) return [];
          var custIds = custRows.map(function (c) { return c.id; }).join(',');
          return fetch(`${SUPABASE_URL}/rest/v1/pos_sales?select=*&customer_id=in.(${custIds})&order=created_at.desc&limit=100${dateClause}`, { headers: supabaseHeaders() })
            .then(function (r) { return r.json(); });
        });

      var amountPromise = isNumeric
        ? fetch(`${SUPABASE_URL}/rest/v1/pos_sales?select=*&total=gte.${numericQuery - 0.01}&total=lte.${numericQuery + 0.01}&order=created_at.desc&limit=100${dateClause}`, { headers: supabaseHeaders() })
          .then(function (r) { return r.json(); })
        : Promise.resolve([]);

      var results = await Promise.all([billPromise, custPromise, amountPromise]);
      var merged = {};
      results.forEach(function (list) {
        (list || []).forEach(function (s) { merged[s.id] = s; });
      });
      sales = Object.values(merged).sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    }

    var saleIds = sales.map(function (s) { return s.id; });
    var customerIds = sales.map(function (s) { return s.customer_id; }).filter(Boolean);

    // These two lookups don't depend on each other — run them
    // together instead of one after another.
    var lookups = await Promise.all([
      customerIds.length
        ? fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=in.(${customerIds.join(',')})&select=id,name,phone,phone_country_code,email`, { headers: supabaseHeaders() }).then(function (r) { return r.json(); })
        : Promise.resolve([]),
      saleIds.length
        ? fetch(`${SUPABASE_URL}/rest/v1/pos_returns?original_sale_id=in.(${saleIds.join(',')})&select=original_sale_id,items_returned,is_damaged,refund_amount,refund_method`, { headers: supabaseHeaders() }).then(function (r) { return r.json(); })
        : Promise.resolve([])
    ]);
    var custs = lookups[0];
    var returnRows = lookups[1];

    var customersById = {};
    custs.forEach(function (c) { customersById[c.id] = c; });

    var returnedIdsBySale = {};
    var isDamagedBySale = {};
    var giftCardCreditBySale = {};
    returnRows.forEach(function (r) {
      if (!returnedIdsBySale[r.original_sale_id]) returnedIdsBySale[r.original_sale_id] = [];
      (r.items_returned || []).forEach(function (it) { returnedIdsBySale[r.original_sale_id].push(it.id); });
      if (r.is_damaged) isDamagedBySale[r.original_sale_id] = true;
      if (r.refund_method === 'gift_card') {
        giftCardCreditBySale[r.original_sale_id] = (giftCardCreditBySale[r.original_sale_id] || 0) + (Number(r.refund_amount) || 0);
      }
    });

    sales.forEach(function (s) {
      s.customer_name = s.customer_id && customersById[s.customer_id] ? customersById[s.customer_id].name : 'Walk-in Customer';
      s.customer = s.customer_id && customersById[s.customer_id] ? customersById[s.customer_id] : null;
      var allItemIds = (s.items || []).map(function (it) { return it.id; });
      var returnedIds = returnedIdsBySale[s.id] || [];
      if (!returnedIds.length) {
        s.status = 'Completed';
      } else if (allItemIds.length && allItemIds.every(function (id) { return returnedIds.indexOf(id) !== -1; })) {
        s.status = isDamagedBySale[s.id] ? 'Returned' : 'Exchanged';
      } else {
        s.status = 'Partially Returned';
      }
      s.gift_card_credit = giftCardCreditBySale[s.id] || 0;
    });

    return { statusCode: 200, body: JSON.stringify({ sales: sales }) };
  } catch (e) {
    console.error('pos-list-sales-history error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
