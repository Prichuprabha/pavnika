// Scheduled function (see netlify.toml — runs hourly) that permanently
// deletes "pending" orders older than 24 hours.
//
// "pending" is created the moment checkout starts, before Nomod
// confirms payment. It's meant to be a brief, in-transit state — but
// if a customer abandons the payment page or never returns to the
// site, nothing ever moves it forward, so it would otherwise sit in
// the database indefinitely. A genuine payment confirmation from
// Nomod normally comes back within minutes, so 24 hours is a very
// generous window before treating one as abandoned.
//
// Safe to delete outright rather than just marking as expired: if a
// customer genuinely did pay but returns to the site late, this
// system's own recovery path in verify-nomod-order.js rebuilds the
// order directly from Nomod's records if the database row is
// missing — so removing stale rows here doesn't risk losing a real
// payment.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async function (event) {
  try {
    var cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    var res = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?status=eq.pending&created_at=lt.${cutoff}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Prefer': 'return=representation'
        }
      }
    );

    if (!res.ok) {
      var errText = await res.text();
      console.error(`cleanup-pending-orders: Supabase delete failed (${res.status}):`, errText);
      return { statusCode: 500, body: JSON.stringify({ error: 'Delete failed' }) };
    }

    var deleted = await res.json();
    console.log(`cleanup-pending-orders: removed ${deleted.length} stale pending order(s) older than ${cutoff}.`);

    return { statusCode: 200, body: JSON.stringify({ deletedCount: deleted.length }) };
  } catch (e) {
    console.error('cleanup-pending-orders error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
