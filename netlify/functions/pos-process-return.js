// Processes a Return or Exchange.
//
// Exchange: item goes back into sellable stock, and the prorated
// refund is credited to the customer's gift card balance (this is
// the only outcome Exchange supports).
//
// Return: only valid for damaged goods — the item does NOT go back
// into stock, since it can't be resold. The refund can go to the
// customer's gift card, or be recorded as handled manually via cash
// or bank transfer (no balance change for those two, since the
// money already changed hands outside the system).
const { verifyPosToken } = require('./_pos-auth');
const { restockReturnedItems, sendReturnConfirmationEmail } = require('./_order-shared');

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

  var isExchange = body.actionType === 'exchange';
  var refundMethod = isExchange ? 'gift_card' : (body.refundMethod || null);

  if (!isExchange && !refundMethod) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Choose how the customer is being refunded' }) };
  }

  try {
    var saleRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_sales?id=eq.${encodeURIComponent(body.originalSaleId)}&select=*`, { headers: supabaseHeaders() });
    var saleRows = await saleRes.json();
    if (!saleRows.length) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Original sale not found' }) };
    }
    var sale = saleRows[0];

    if (refundMethod === 'gift_card' && !sale.customer_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'This sale has no linked customer to credit a gift card to \u2014 choose cash or bank transfer instead.' }) };
    }

    // Prorate the original sale's discount across the affected items,
    // rather than refunding full list price.
    var effectiveRatio = sale.subtotal > 0 ? sale.total / sale.subtotal : 1;
    var listValue = body.items.reduce(function (sum, it) { return sum + (it.price * it.qty); }, 0);
    var refundAmount = Math.round(listValue * effectiveRatio * 100) / 100;

    if (isExchange) {
      // Only Exchange restocks — a damaged Return item can't be resold.
      // A quantity-tracked item gets its qty added back; a one-of-a-kind
      // saree is marked available again, same as before.
      try {
        await restockReturnedItems(body.items);
      } catch (e) {
        console.error('Exchange logged, but restocking items failed:', e);
      }
    }

    // Looked up once regardless of refund method, both to credit a gift
    // card balance (if that's the method) and to have a name/email to
    // send the confirmation email to. No customer_id on the sale (a
    // walk-in with no profile) just means no email goes out.
    var customerName = null, customerEmail = null, newGiftCardBalance = null;
    if (sale.customer_id) {
      var custRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${sale.customer_id}&select=name,email,gift_card_balance`, { headers: supabaseHeaders() });
      var custRows = await custRes.json();
      var custRow = custRows[0] || null;
      if (custRow) {
        customerName = custRow.name;
        customerEmail = custRow.email;
      }

      if (refundMethod === 'gift_card') {
        var currentBalance = (custRow && custRow.gift_card_balance) || 0;
        newGiftCardBalance = currentBalance + refundAmount;
        await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${sale.customer_id}`, {
          method: 'PATCH',
          headers: supabaseHeaders(),
          body: JSON.stringify({ gift_card_balance: newGiftCardBalance })
        });
      }
    }
    // cash / bank_transfer: handled manually outside the system — no balance change, just recorded below.

    var returnRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_returns`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        original_sale_id: sale.id,
        bill_number: sale.bill_number,
        items_returned: body.items,
        refund_amount: refundAmount,
        action_type: body.actionType,
        is_damaged: !isExchange,
        refund_method: refundMethod,
        processed_by: session.displayName
      })
    });
    if (!returnRes.ok) throw new Error(`Supabase insert failed: ${returnRes.status}`);
    var returnRows = await returnRes.json();

    try {
      await sendReturnConfirmationEmail({
        customerEmail: customerEmail,
        customerName: customerName,
        items: body.items,
        refundAmount: refundAmount,
        actionType: body.actionType,
        isDamaged: !isExchange,
        refundMethod: refundMethod,
        newGiftCardBalance: newGiftCardBalance,
        referenceLabel: 'Bill',
        billNumber: sale.bill_number
      });
    } catch (emailErr) {
      console.error('sendReturnConfirmationEmail failed (return was still recorded):', emailErr);
    }

    return { statusCode: 200, body: JSON.stringify({ returnRecord: returnRows[0], refundAmount: refundAmount }) };
  } catch (e) {
    console.error('pos-process-return error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
