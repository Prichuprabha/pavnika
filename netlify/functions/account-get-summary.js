// netlify/functions/account-get-summary.js
//
// POST { visitorToken }
// Returns everything the customer account page needs for the ONE
// email that token was issued to:
//   - online orders (orders table, matched on customer_email)
//   - in-store purchases (pos_sales, via the pos_customers row with
//     the same email — so walk-ins who never gave an email won't
//     appear, which is expected)
//   - gift card balance, plus a real credit/debit history
//   - lifetime total spent
//
// The email is taken from the SIGNED TOKEN, never from the request
// body — otherwise anyone could read a stranger's order history just
// by typing their email address.
//
// Gift card history is reconstructed from two existing sources rather
// than a dedicated ledger table:
//   credits — pos_returns rows with refund_method = 'gift_card'
//   debits  — pos_sales rows whose payment_breakdown includes a
//             gift_card entry
// Both were already being recorded, so the history is genuine rather
// than inferred from the running balance.

const { verifyVisitorToken } = require('./_visitor-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
}

// Statuses that represent money actually received, matching how the
// admin dashboard counts revenue — a cancelled or pending order
// shouldn't inflate a customer's "total spent".
const PAID_ONLINE_STATUSES = ['paid', 'shipped', 'delivered', 'delivered_direct_pay'];

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

  var session = verifyVisitorToken(body.visitorToken);
  if (!session) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Please verify your email again to view your account.' }) };
  }
  var email = String(session.email || '').toLowerCase();
  if (!email) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Session is missing an email address.' }) };
  }

  try {
    var enc = encodeURIComponent(email);

    // Online orders and the POS customer record don't depend on each
    // other, so fetch them together rather than one after the other.
    var initial = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/orders?customer_email=eq.${enc}&select=id,order_number,created_at,customer_name,customer_email,items,subtotal,discount_amount,total,status,payment_method,promo_code&order=created_at.desc`, { headers: supabaseHeaders() })
        .then(function (r) { return r.ok ? r.json() : []; }),
      fetch(`${SUPABASE_URL}/rest/v1/pos_customers?email=eq.${enc}&select=id,name,gift_card_balance`, { headers: supabaseHeaders() })
        .then(function (r) { return r.ok ? r.json() : []; })
    ]);

    var onlineOrders = initial[0] || [];
    var posCustomer = (initial[1] || [])[0] || null;

    var shopSales = [];
    var giftCardBalance = 0;
    var giftHistory = [];

    if (posCustomer) {
      giftCardBalance = Number(posCustomer.gift_card_balance) || 0;

      var salesRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_sales?customer_id=eq.${encodeURIComponent(posCustomer.id)}&select=id,bill_number,created_at,items,subtotal,discount_amount,total,payment_method,payment_breakdown,sales_person&order=created_at.desc`,
        { headers: supabaseHeaders() }
      );
      shopSales = salesRes.ok ? await salesRes.json() : [];

      // Debits: any sale where part or all was paid by gift card.
      shopSales.forEach(function (s) {
        var breakdown = s.payment_breakdown;
        if (typeof breakdown === 'string') {
          try { breakdown = JSON.parse(breakdown); } catch (e) { breakdown = null; }
        }
        if (!Array.isArray(breakdown)) return;
        breakdown.forEach(function (part) {
          var method = String(part.method || '').toLowerCase().replace(/[\s-]/g, '_');
          var amount = Number(part.amount) || 0;
          if (method === 'gift_card' && amount > 0) {
            giftHistory.push({
              type: 'debit',
              amount: amount,
              date: s.created_at,
              reference: s.bill_number,
              label: 'Used on purchase'
            });
          }
        });
      });

      // Credits: returns/exchanges refunded to the gift card.
      if (shopSales.length) {
        var saleIds = shopSales.map(function (s) { return s.id; }).join(',');
        var returnsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/pos_returns?original_sale_id=in.(${saleIds})&select=original_sale_id,refund_amount,refund_method,created_at`,
          { headers: supabaseHeaders() }
        );
        var returns = returnsRes.ok ? await returnsRes.json() : [];
        var billBySaleId = {};
        shopSales.forEach(function (s) { billBySaleId[s.id] = s.bill_number; });

        returns.forEach(function (r) {
          if (String(r.refund_method || '') !== 'gift_card') return;
          var amount = Number(r.refund_amount) || 0;
          if (amount <= 0) return;
          giftHistory.push({
            type: 'credit',
            amount: amount,
            date: r.created_at,
            reference: billBySaleId[r.original_sale_id] || '',
            label: 'Exchange credit'
          });
        });
      }

      giftHistory.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    }

    var onlineSpent = onlineOrders
      .filter(function (o) { return PAID_ONLINE_STATUSES.indexOf(o.status) !== -1; })
      .reduce(function (sum, o) { return sum + (Number(o.total) || 0); }, 0);
    var shopSpent = shopSales.reduce(function (sum, s) { return sum + (Number(s.total) || 0); }, 0);

    return {
      statusCode: 200,
      body: JSON.stringify({
        email: email,
        name: posCustomer ? posCustomer.name : (onlineOrders[0] ? onlineOrders[0].customer_name : ''),
        onlineOrders: onlineOrders,
        shopSales: shopSales,
        giftCardBalance: giftCardBalance,
        giftHistory: giftHistory,
        totalSpent: onlineSpent + shopSpent,
        orderCount: onlineOrders.length + shopSales.length
      })
    };
  } catch (e) {
    console.error('account-get-summary error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load your account right now.' }) };
  }
};
