// netlify/functions/_pos-shared.js
//
// Shared between pos-complete-sale.js (the real, final bill number)
// and pos-peek-bill-number.js (a read-only preview shown on the
// Billing step, before the sale is actually completed) — extracted
// here so both use identical logic rather than two copies that could
// drift apart.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
}

// POS-DDMOYY-SEQ — same method as the site's own order numbers
// (generateOrderNumber in _order-shared.js), minus the hour/minute,
// with a 3-digit daily sequence and a POS prefix: POS-220826-001.
//
// Note for callers: this counts today's existing pos_sales rows and
// adds 1 — it doesn't reserve a number. Two calls close together
// (a peek, then the real completion) could rarely land on the same
// value if another sale completes in between; harmless for a preview
// display, but the real insert should always treat bill_number as
// unique regardless.
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

  return 'POS-' + datePart + '-' + String(seq).padStart(3, '0');
}

module.exports = { generateBillNumber: generateBillNumber, supabaseHeaders: supabaseHeaders };
