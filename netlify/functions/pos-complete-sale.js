const { verifyPosToken } = require('./_pos-auth');
const { markSareesSold } = require('./_order-shared');

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

// BILL-DDMOYY-SEQ — same method as the site's own order numbers
// (generateOrderNumber in _order-shared.js), minus the hour/minute,
// with a 3-digit daily sequence and a BILL prefix, per the confirmed
// format: BILL-220826-001.
async function generateBillNumber() {
  var now = new Date(Date.now() + 4 * 60 * 60 * 1000); // UAE is UTC+4
  var dd = String(now.getUTCDate()).padStart(2, '0');
  var mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  var yy = String(now.getUTCFullYear()).slice(-2);
  var datePart = dd + mo + yy;

  var dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), -4, 0, 0)).toISOString();
  var dayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, -4, 0, 0)).toISOString();

  var seq = 1;
  try {
    var res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_sales?select=id&created_at=gte.${dayStart}&created_at=lt.${dayEnd}`,
      { headers: supabaseHeaders() }
    );
    if (res.ok) {
      var rows = await res.json();
      seq = rows.length + 1;
    }
  } catch (e) {
    console.error('Could not count today\'s POS sales, defaulting sequence to 1:', e);
  }

  return 'BILL-' + datePart + '-' + String(seq).padStart(3, '0');
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

  var items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Cart is empty' }) };
  }

  try {
    var billNumber = await generateBillNumber();

    var saleRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_sales`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        bill_number: billNumber,
        items: items, // [{ id, name, price, qty }, ...]
        customer_id: body.customerId || null,
        subtotal: body.subtotal,
        discount_type: body.discountType || null,
        discount_value: body.discountValue || 0,
        discount_amount: body.discountAmount || 0,
        loyalty_points_redeemed: body.loyaltyPointsRedeemed || 0,
        vat_amount: body.vatAmount || 0, // 0 for now — VAT not currently applicable
        total: body.total,
        payment_method: body.paymentMethod,
        amount_received: body.amountReceived || null,
        reference_id: body.referenceId || null,
        sales_person: session.displayName,
        notes: body.notes || null
      })
    });
    if (!saleRes.ok) {
      var errText = await saleRes.text();
      throw new Error(`Supabase insert failed: ${saleRes.status} ${errText}`);
    }
    var saleRows = await saleRes.json();

    // Mark every sold item as sold in the shared catalogue (the same
    // GitHub-committed products-data.js the website itself reads from)
    // — this is what keeps a saree sold in-store from still showing as
    // available online afterward.
    var itemIds = items.map(function (it) { return it.id; });
    try {
      await markSareesSold(itemIds);
    } catch (e) {
      // The sale itself already succeeded and is saved — a catalogue
      // sync failure here shouldn't block completing the transaction,
      // but it does need to be visible for manual follow-up.
      console.error('Sale saved, but marking items sold in the catalogue failed:', e);
    }

    // Redeem loyalty points if requested — deduct from balance. Point
    // *earning* rules aren't decided yet, so this only ever subtracts,
    // never adds, until that's defined.
    if (body.customerId && body.loyaltyPointsRedeemed > 0) {
      try {
        var custRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${body.customerId}&select=loyalty_points`, { headers: supabaseHeaders() });
        var custRows = await custRes.json();
        var currentPoints = (custRows[0] && custRows[0].loyalty_points) || 0;
        var newPoints = Math.max(0, currentPoints - body.loyaltyPointsRedeemed);
        await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${body.customerId}`, {
          method: 'PATCH',
          headers: supabaseHeaders(),
          body: JSON.stringify({ loyalty_points: newPoints })
        });
      } catch (e) {
        console.error('Sale saved, but updating loyalty points failed:', e);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ sale: saleRows[0], billNumber: billNumber }) };
  } catch (e) {
    console.error('pos-complete-sale error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong, please try again' }) };
  }
};
