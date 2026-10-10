// Updates an existing customer's details from the Customer Database
// settings page — contact info, plus (by explicit request) a manual
// override for loyalty points and gift card balance. Admin-gated,
// since this bypasses the normal transaction ledger those two numbers
// would otherwise only ever move through.
//
// A gift card balance change specifically also requires a "reason"
// and gets logged to gift_card_adjustments (source: 'pos') — the same
// table and requirement admin-adjust-gift-card-balance.js (the
// equivalent control in admin.html's Customers tab) uses, so a
// manual correction is accountable wherever it's made from. Loyalty
// points aren't logged this way — only the balance that represents
// real money.
const { verifyPosToken } = require('./_pos-auth');

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
  if (!session.isAdmin) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  if (!body.customerId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing customer id' }) };
  }

  var name = (body.name || '').trim();
  var phone = (body.phone || '').trim();
  if (!name || !phone) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Name and mobile number are required' }) };
  }

  var loyaltyPoints = parseInt(body.loyaltyPoints, 10);
  var giftCardBalance = Math.round((parseFloat(body.giftCardBalance) || 0) * 100) / 100;
  var reason = (body.giftCardReason || '').trim();
  if (isNaN(loyaltyPoints) || loyaltyPoints < 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Loyalty points must be a valid number, 0 or more' }) };
  }
  if (isNaN(giftCardBalance) || giftCardBalance < 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Gift card balance must be a valid amount, 0 or more' }) };
  }

  try {
    var custRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${encodeURIComponent(body.customerId)}&select=id,gift_card_balance`, { headers: supabaseHeaders() });
    if (!custRes.ok) throw new Error(`Supabase lookup failed: ${custRes.status}`);
    var custRows = await custRes.json();
    if (!custRows.length) return { statusCode: 404, body: JSON.stringify({ error: 'Customer not found' }) };
    var previousBalance = Number(custRows[0].gift_card_balance) || 0;
    var balanceDelta = Math.round((giftCardBalance - previousBalance) * 100) / 100;

    // A reason is only required when the balance is actually being
    // changed -- re-saving contact details without touching the
    // balance shouldn't need one.
    if (balanceDelta !== 0 && !reason) {
      return { statusCode: 400, body: JSON.stringify({ error: 'A reason is required when changing the gift card balance.' }) };
    }

    var res = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${encodeURIComponent(body.customerId)}`, {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        name: name,
        phone: phone,
        phone_country_code: (body.phoneCountryCode || '+971').trim(),
        email: (body.email || '').trim() || null,
        emirate: body.emirate || null,
        address: (body.address || '').trim() || null,
        loyalty_points: loyaltyPoints,
        gift_card_balance: giftCardBalance
      })
    });
    if (!res.ok) throw new Error(`Supabase update failed: ${res.status}`);
    var rows = await res.json();
    if (!rows.length) return { statusCode: 404, body: JSON.stringify({ error: 'Customer not found' }) };

    if (balanceDelta !== 0) {
      var logRes = await fetch(`${SUPABASE_URL}/rest/v1/gift_card_adjustments`, {
        method: 'POST',
        headers: supabaseHeaders(),
        body: JSON.stringify({
          customer_id: body.customerId,
          previous_balance: previousBalance,
          new_balance: giftCardBalance,
          delta: balanceDelta,
          reason: reason,
          source: 'pos',
          processed_by: session.displayName
        })
      });
      if (!logRes.ok) throw new Error(`Logging the adjustment failed: ${logRes.status}`);
    }

    return { statusCode: 200, body: JSON.stringify({ customer: rows[0] }) };
  } catch (e) {
    console.error('pos-update-customer error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not save changes, please try again' }) };
  }
};
