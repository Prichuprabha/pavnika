// Searches completed sales by bill number or customer mobile number,
// for the Return/Exchange page's "Find Original Sale" search.
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

  if (!verifyPosToken(body.posToken)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Session expired, please log in again' }) };
  }

  var query = (body.query || '').trim();

  try {
    var url;
    if (!query) {
      // No query yet — show the most recent completed sales, same
      // "recent by default" pattern used for the customer list.
      url = `${SUPABASE_URL}/rest/v1/pos_sales?select=*&order=created_at.desc&limit=15`;
    } else {
      var encoded = encodeURIComponent(`%${query}%`);
      url = `${SUPABASE_URL}/rest/v1/pos_sales?select=*&bill_number=ilike.${encoded}&order=created_at.desc&limit=15`;
    }
    var res = await fetch(url, { headers: supabaseHeaders() });
    if (!res.ok) throw new Error(`Supabase query failed: ${res.status}`);
    var sales = await res.json();

    // If searching and nothing matched by bill number, also try
    // matching by the linked customer's mobile number.
    if (query && !sales.length) {
      var custRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?phone=ilike.${encodeURIComponent('%' + query + '%')}&select=id`, { headers: supabaseHeaders() });
      var custRows = await custRes.json();
      if (custRows.length) {
        var custIds = custRows.map(function (c) { return c.id; }).join(',');
        var salesByPhoneRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_sales?select=*&customer_id=in.(${custIds})&order=created_at.desc&limit=15`, { headers: supabaseHeaders() });
        sales = await salesByPhoneRes.json();
      }
    }

    // Attach customer name for display
    var customerIds = sales.map(function (s) { return s.customer_id; }).filter(Boolean);
    var customersById = {};
    if (customerIds.length) {
      var custsRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=in.(${customerIds.join(',')})&select=id,name,phone,phone_country_code,email`, { headers: supabaseHeaders() });
      var custs = await custsRes.json();
      custs.forEach(function (c) { customersById[c.id] = c; });
    }
    sales.forEach(function (s) {
      s.customer_name = s.customer_id && customersById[s.customer_id] ? customersById[s.customer_id].name : 'Walk-in Customer';
      s.customer = s.customer_id && customersById[s.customer_id] ? customersById[s.customer_id] : null;
    });

    // Mark items already returned/exchanged, and drop any sale that's
    // fully processed already — nothing left to act on.
    if (sales.length) {
      var saleIds = sales.map(function (s) { return s.id; });
      var returnsRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_returns?original_sale_id=in.(${saleIds.join(',')})&select=original_sale_id,items_returned`, { headers: supabaseHeaders() });
      var returnRows = await returnsRes.json();
      var returnedIdsBySale = {};
      returnRows.forEach(function (r) {
        if (!returnedIdsBySale[r.original_sale_id]) returnedIdsBySale[r.original_sale_id] = [];
        (r.items_returned || []).forEach(function (it) { returnedIdsBySale[r.original_sale_id].push(it.id); });
      });

      sales.forEach(function (s) {
        s.already_returned_item_ids = returnedIdsBySale[s.id] || [];
      });
      sales = sales.filter(function (s) {
        var allItemIds = (s.items || []).map(function (it) { return it.id; });
        var fullyProcessed = allItemIds.length > 0 && allItemIds.every(function (id) { return s.already_returned_item_ids.indexOf(id) !== -1; });
        return !fullyProcessed;
      });
    }

    return { statusCode: 200, body: JSON.stringify({ sales: sales }) };
  } catch (e) {
    console.error('pos-search-original-sale error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
