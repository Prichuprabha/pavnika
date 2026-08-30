// Fetches in-store (POS) sales for the admin.html Orders page's Shop
// Orders tab. Normalizes the shape to line up with online orders
// (order_number, customer_name/email/phone, items as a JSON string,
// etc.) so the existing order-detail drawer can render both with
// minimal special-casing. Status uses POS wording (Completed,
// Returned, Exchanged, Partially Returned) since that's a materially
// different lifecycle than online orders' shipping-based statuses.
const { verifyAdminToken } = require('./_admin-auth');

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

  if (!verifyAdminToken(body.adminToken)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Session expired, please log in again' }) };
  }

  try {
    var salesRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_sales?select=*&order=created_at.desc&limit=500`, { headers: supabaseHeaders() });
    if (!salesRes.ok) throw new Error(`Supabase query failed: ${salesRes.status}`);
    var sales = await salesRes.json();

    var saleIds = sales.map(function (s) { return s.id; });
    var customerIds = sales.map(function (s) { return s.customer_id; }).filter(Boolean);

    var lookups = await Promise.all([
      customerIds.length
        ? fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=in.(${customerIds.join(',')})&select=id,name,phone,phone_country_code,email`, { headers: supabaseHeaders() }).then(function (r) { return r.json(); })
        : Promise.resolve([]),
      saleIds.length
        ? fetch(`${SUPABASE_URL}/rest/v1/pos_returns?original_sale_id=in.(${saleIds.join(',')})&select=original_sale_id,items_returned,is_damaged,refund_amount,refund_method`, { headers: supabaseHeaders() }).then(function (r) { return r.json(); })
        : Promise.resolve([])
    ]);
    var custsById = {};
    lookups[0].forEach(function (c) { custsById[c.id] = c; });

    var returnedIdsBySale = {};
    var isDamagedBySale = {};
    var giftCardCreditBySale = {};
    lookups[1].forEach(function (r) {
      if (!returnedIdsBySale[r.original_sale_id]) returnedIdsBySale[r.original_sale_id] = [];
      (r.items_returned || []).forEach(function (it) { returnedIdsBySale[r.original_sale_id].push(it.id); });
      if (r.is_damaged) isDamagedBySale[r.original_sale_id] = true;
      if (r.refund_method === 'gift_card') {
        giftCardCreditBySale[r.original_sale_id] = (giftCardCreditBySale[r.original_sale_id] || 0) + (Number(r.refund_amount) || 0);
      }
    });

    var normalized = sales.map(function (s) {
      var cust = s.customer_id && custsById[s.customer_id] ? custsById[s.customer_id] : null;
      var allItemIds = (s.items || []).map(function (it) { return it.id; });
      var returnedIds = returnedIdsBySale[s.id] || [];
      var status;
      if (!returnedIds.length) {
        status = 'Completed';
      } else if (allItemIds.length && allItemIds.every(function (id) { return returnedIds.indexOf(id) !== -1; })) {
        status = isDamagedBySale[s.id] ? 'Returned' : 'Exchanged';
      } else {
        status = 'Partially Returned';
      }

      return {
        id: s.id,
        channel: 'shop',
        order_number: s.bill_number,
        created_at: s.created_at,
        customer_name: cust ? cust.name : 'Walk-in Customer',
        customer_email: cust ? cust.email : '',
        customer_phone: cust ? ((cust.phone_country_code || '') + ' ' + cust.phone) : '',
        items: JSON.stringify(s.items || []),
        total: s.total,
        subtotal: s.subtotal,
        discount_amount: s.discount_amount || 0,
        payment_method: s.payment_method,
        sales_person: s.sales_person,
        status: status,
        gift_card_credit: giftCardCreditBySale[s.id] || 0
      };
    });

    return { statusCode: 200, body: JSON.stringify({ sales: normalized }) };
  } catch (e) {
    console.error('admin-get-pos-sales error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
