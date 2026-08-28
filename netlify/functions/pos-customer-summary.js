// Computes a selected customer's purchase summary — total purchases,
// total spent, and last visit date — by querying their pos_sales
// history. Also fetches gift_card_balance fresh, since a cached
// customer object (from whenever they were last loaded into the
// list) could be stale if a redemption or exchange changed it since.
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

  if (!body.customerId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing customer id' }) };
  }

  try {
    var res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_sales?customer_id=eq.${encodeURIComponent(body.customerId)}&select=total,created_at&order=created_at.desc`,
      { headers: supabaseHeaders() }
    );
    if (!res.ok) throw new Error(`Supabase query failed: ${res.status}`);
    var sales = await res.json();

    var totalPurchases = sales.length;
    var totalSpent = sales.reduce(function (sum, s) { return sum + Number(s.total || 0); }, 0);
    var lastVisit = sales.length ? sales[0].created_at : null;

    var custRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${encodeURIComponent(body.customerId)}&select=gift_card_balance,loyalty_points`,
      { headers: supabaseHeaders() }
    );
    var custRows = await custRes.json();
    var giftCardBalance = (custRows[0] && custRows[0].gift_card_balance) || 0;
    var loyaltyPoints = (custRows[0] && custRows[0].loyalty_points) || 0;

    return {
      statusCode: 200,
      body: JSON.stringify({ totalPurchases: totalPurchases, totalSpent: totalSpent, lastVisit: lastVisit, giftCardBalance: giftCardBalance, loyaltyPoints: loyaltyPoints })
    };
  } catch (e) {
    console.error('pos-customer-summary error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
