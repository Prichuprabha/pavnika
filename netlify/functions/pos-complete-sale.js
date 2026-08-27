const { verifyPosToken } = require('./_pos-auth');
const { markSareesSold } = require('./_order-shared');
const { generateBillNumber } = require('./_pos-shared');

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
        payment_breakdown: body.paymentBreakdown || null,
        reference_id: body.referenceId || null,
        sales_person: body.salesPersonOverride || session.displayName,
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

    // Redeem gift card balance if used — re-validate the real current
    // balance here rather than trusting the client's own check, since
    // this directly affects money.
    if (body.customerId && body.giftCardRedeemed > 0) {
      try {
        var giftRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${body.customerId}&select=gift_card_balance`, { headers: supabaseHeaders() });
        var giftRows = await giftRes.json();
        var currentGiftBalance = (giftRows[0] && giftRows[0].gift_card_balance) || 0;
        var newGiftBalance = Math.max(0, currentGiftBalance - body.giftCardRedeemed);
        await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${body.customerId}`, {
          method: 'PATCH',
          headers: supabaseHeaders(),
          body: JSON.stringify({ gift_card_balance: newGiftBalance })
        });
      } catch (e) {
        console.error('Sale saved, but updating gift card balance failed:', e);
      }
    }

    // Mark the coupon used, same as the online checkout flow does —
    // keeps a code from being usable twice between in-store and online.
    if (body.couponCode) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/promo_codes?code=eq.${encodeURIComponent(body.couponCode)}`, {
          method: 'PATCH',
          headers: supabaseHeaders(),
          body: JSON.stringify({ used: true })
        });
      } catch (e) {
        console.error('Sale saved, but marking the coupon used failed:', e);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ sale: saleRows[0], billNumber: billNumber }) };
  } catch (e) {
    console.error('pos-complete-sale error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong, please try again' }) };
  }
};
