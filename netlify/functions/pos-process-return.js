// Processes a return or exchange: calculates a fair refund (prorating
// the original sale's discount across just the returned items, not
// full list price), puts the returned items back on the shared
// catalogue as available, and logs the return.
const { verifyPosToken } = require('./_pos-auth');
const { markSareesAvailable } = require('./_order-shared');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
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

  if (!body.originalSaleId || !Array.isArray(body.items) || !body.items.length || !body.actionType) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  try {
    var saleRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_sales?id=eq.${encodeURIComponent(body.originalSaleId)}&select=*`, { headers: supabaseHeaders() });
    var saleRows = await saleRes.json();
    if (!saleRows.length) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Original sale not found' }) };
    }
    var sale = saleRows[0];

    // Prorate the original sale's discount across the returned items,
    // rather than refunding full list price — fair to both the store
    // and the customer, and consistent with what was actually paid.
    var effectiveRatio = sale.subtotal > 0 ? sale.total / sale.subtotal : 1;
    var returnedListValue = body.items.reduce(function (sum, it) { return sum + (it.price * it.qty); }, 0);
    var refundAmount = Math.round(returnedListValue * effectiveRatio * 100) / 100;

    var itemIds = body.items.map(function (it) { return it.id; });
    try {
      await markSareesAvailable(itemIds);
    } catch (e) {
      console.error('Return logged, but marking items available in the catalogue failed:', e);
    }

    var returnRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_returns`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        original_sale_id: sale.id,
        bill_number: sale.bill_number,
        items_returned: body.items,
        refund_amount: refundAmount,
        action_type: body.actionType,
        processed_by: session.displayName
      })
    });
    if (!returnRes.ok) throw new Error(`Supabase insert failed: ${returnRes.status}`);
    var returnRows = await returnRes.json();

    return { statusCode: 200, body: JSON.stringify({ returnRecord: returnRows[0], refundAmount: refundAmount }) };
  } catch (e) {
    console.error('pos-process-return error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
