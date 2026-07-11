// netlify/functions/admin-clear-views.js
//
// POST { adminToken, olderThanDays }
// - Deletes saree_views rows older than the given number of days.
// - Keeps the view-log table from growing indefinitely — purely a
//   tidiness feature, not required for correctness at current scale.

const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const session = verifyAdminToken(body.adminToken);
  if (!session) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authorized. Please sign in again.' }) };
  }

  const days = parseInt(body.olderThanDays, 10);
  if (!days || days < 1) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please provide a valid number of days.' }) };
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/saree_views?created_at=lt.${encodeURIComponent(cutoff)}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Prefer': 'return=representation'
        }
      }
    );
    if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
    const deleted = await res.json();

    return { statusCode: 200, body: JSON.stringify({ success: true, deletedCount: deleted.length, cutoff: cutoff }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to clear old views: ' + err.message }) };
  }
};
