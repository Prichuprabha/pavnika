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

    var url;
    if (!query) {
      url = `${SUPABASE_URL}/rest/v1/pos_sales?select=*&order=created_at.desc&limit=100${dateClause}`;
    } else {
      var encoded = encodeURIComponent(`%${query}%`);
      url = `${SUPABASE_URL}/rest/v1/pos_sales?select=*&bill_number=ilike.${encoded}&order=created_at.desc&limit=100${dateClause}`;
    }
    var res = await fetch(url, { headers: supabaseHeaders() });
    if (!res.ok) throw new Error(`Supabase query failed: ${res.status}`);
    var sales = await res.json();

    // If searching and nothing matched by bill number, also try by
    // customer name or mobile.
    if (query && !sales.length) {
      var custRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?or=(name.ilike.${encodeURIComponent('%' + query + '%')},phone.ilike.${encodeURIComponent('%' + query + '%')})&select=id`, { headers: supabaseHeaders() });
      var custRows = await custRes.json();
      if (custRows.length) {
        var custIds = custRows.map(function (c) { return c.id; }).join(',');
        var salesByCustRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_sales?select=*&customer_id=in.(${custIds})&order=created_at.desc&limit=100${dateClause}`, { headers: supabaseHeaders() });
        sales = await salesByCustRes.json();
      }
    }

    // Attach customer info and return status
    var customerIds = sales.map(function (s) { return s.customer_id; }).filter(Boolean);
    var customersById = {};
    if (customerIds.length) {
      var custsRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=in.(${customerIds.join(',')})&select=id,name,phone,phone_country_code,email`, { headers: supabaseHeaders() });
      var custs = await custsRes.json();
      custs.forEach(function (c) { customersById[c.id] = c; });
    }

    var saleIds = sales.map(function (s) { return s.id; });
    var returnedIdsBySale = {};
    var isDamagedBySale = {};
    if (saleIds.length) {
      var returnsRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_returns?original_sale_id=in.(${saleIds.join(',')})&select=original_sale_id,items_returned,is_damaged`, { headers: supabaseHeaders() });
      var returnRows = await returnsRes.json();
      returnRows.forEach(function (r) {
        if (!returnedIdsBySale[r.original_sale_id]) returnedIdsBySale[r.original_sale_id] = [];
        (r.items_returned || []).forEach(function (it) { returnedIdsBySale[r.original_sale_id].push(it.id); });
        if (r.is_damaged) isDamagedBySale[r.original_sale_id] = true;
      });
    }

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
    });

    return { statusCode: 200, body: JSON.stringify({ sales: sales }) };
  } catch (e) {
    console.error('pos-list-sales-history error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
