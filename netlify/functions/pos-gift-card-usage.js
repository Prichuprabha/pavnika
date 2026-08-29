// Supports the "Gift Card Usage" detail view on Sales History, shown
// for Exchanged sales instead of a Return button (there's nothing
// left to return on those). Returns the customer's current gift card
// balance and their purchases made since the exchange date.
//
// Important limitation, stated honestly rather than implied: this
// does NOT prove that any specific later purchase was paid for using
// THIS exchange's credit specifically — that would require a real
// ledger tracking which credit-issuing event funded which later
// redemption, which doesn't exist yet. This gives useful context
// (current balance, activity since the exchange) without overstating
// precision the data doesn't actually have.
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

  if (!body.customerId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing customer id' }) };
  }

  try {
    var custRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${encodeURIComponent(body.customerId)}&select=name,phone,phone_country_code,gift_card_balance`, { headers: supabaseHeaders() });
    var custRows = await custRes.json();
    if (!custRows.length) return { statusCode: 404, body: JSON.stringify({ error: 'Customer not found' }) };
    var customer = custRows[0];

    var sinceClause = body.sinceDate ? `&created_at=gt.${encodeURIComponent(body.sinceDate)}` : '';
    var salesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_sales?customer_id=eq.${encodeURIComponent(body.customerId)}&select=id,bill_number,created_at,total,items${sinceClause}&order=created_at.asc`,
      { headers: supabaseHeaders() }
    );
    var salesSince = (await salesRes.json()).filter(function (s) { return s.id !== body.excludeSaleId; });

    return {
      statusCode: 200,
      body: JSON.stringify({
        customerName: customer.name,
        customerPhone: (customer.phone_country_code || '') + ' ' + customer.phone,
        currentBalance: customer.gift_card_balance || 0,
        salesSince: salesSince
      })
    };
  } catch (e) {
    console.error('pos-gift-card-usage error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
