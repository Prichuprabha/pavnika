// Deletes a POS sale permanently, from the admin Orders page's Shop
// Orders tab. Relies on pos_returns' foreign key CASCADE (see
// SETUP_pos_sales_delete_cascade.sql) to also remove any associated
// return/exchange record automatically.
//
// Important, and this is exactly why the frontend shows a detailed
// warning before calling this: if that return had credited a
// customer's gift card, deleting the return's audit record here does
// NOT reverse that balance. pos_customers.gift_card_balance is a
// separate running total, untouched by this cascade — the customer
// keeps whatever credit they were given, only the record explaining
// where it came from is gone.
//
// Also restores the sale's items to "available" in the live catalogue
// (products-data.js), since deleting a sale that marked real
// inventory as sold would otherwise leave those items permanently
// stuck as unavailable. Guarded: an item is only restored if it isn't
// currently sold via some OTHER, still-existing sale — deleting an
// old sale should never accidentally un-sell an item that's since
// been legitimately sold to someone else.
const { verifyAdminToken } = require('./_admin-auth');
const { markSareesAvailable } = require('./_order-shared');

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

  if (!body.saleId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing sale id' }) };
  }

  try {
    // Fetch the sale's items BEFORE deleting — once the row is gone,
    // there's no way to know which items to restore.
    var saleRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_sales?id=eq.${encodeURIComponent(body.saleId)}&select=id,items`, { headers: supabaseHeaders() });
    if (!saleRes.ok) throw new Error(`Supabase query failed: ${saleRes.status}`);
    var saleRows = await saleRes.json();
    if (!saleRows.length) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Sale not found' }) };
    }
    var itemIds = (saleRows[0].items || []).map(function (it) { return it.id; });

    var res = await fetch(`${SUPABASE_URL}/rest/v1/pos_sales?id=eq.${encodeURIComponent(body.saleId)}`, {
      method: 'DELETE',
      headers: Object.assign({}, supabaseHeaders(), { 'Prefer': 'return=representation' })
    });
    if (!res.ok) {
      var errText = await res.text();
      console.error('admin-delete-pos-sale: Supabase delete failed:', errText);
      throw new Error(`Supabase delete failed: ${res.status}`);
    }
    var deleted = await res.json();
    if (!deleted.length) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Sale not found' }) };
    }

    // Only restore an item if no OTHER still-existing sale currently
    // includes it — otherwise it's legitimately sold to someone else
    // now, and this deletion shouldn't un-sell it out from under them.
    if (itemIds.length) {
      var otherSalesRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_sales?select=items`, { headers: supabaseHeaders() });
      var otherSales = otherSalesRes.ok ? await otherSalesRes.json() : [];
      var stillSoldIds = {};
      otherSales.forEach(function (s) {
        (s.items || []).forEach(function (it) { stillSoldIds[it.id] = true; });
      });
      var toRestore = itemIds.filter(function (id) { return !stillSoldIds[id]; });
      if (toRestore.length) {
        try {
          await markSareesAvailable(toRestore);
        } catch (e) {
          // The sale itself is already deleted at this point — log
          // but don't fail the whole request over a catalogue-commit
          // hiccup; worst case an item stays marked sold and needs a
          // manual fix, rather than the delete silently not happening.
          console.error('admin-delete-pos-sale: could not restore item availability:', e);
        }
      }
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (e) {
    console.error('admin-delete-pos-sale error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not delete this sale' }) };
  }
};
