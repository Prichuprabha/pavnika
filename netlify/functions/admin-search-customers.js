// netlify/functions/admin-search-customers.js
//
// POST { adminToken, query }
// - Searches past orders for customers whose name, email, or phone
//   matches the query, returning distinct customers (deduped by
//   email) along with their most recent billing address on file —
//   powers the "search existing customer" autocomplete on the Manual
//   Order page, so a returning customer's details (and address) can
//   be filled in automatically instead of retyped.

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

  const query = (body.query || '').trim();
  if (query.length < 2) {
    return { statusCode: 200, body: JSON.stringify({ customers: [] }) };
  }

  try {
    const encoded = encodeURIComponent(`*${query}*`);
    const filter = `or=(customer_name.ilike.${encoded},customer_email.ilike.${encoded},customer_phone.ilike.${encoded})`;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?select=customer_name,customer_email,customer_phone,billing_address,created_at&${filter}&order=created_at.desc&limit=100`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );
    if (!res.ok) throw new Error(`Supabase error ${res.status}`);
    const rows = await res.json();

    const seen = {};
    const customers = [];
    rows.forEach(function (r) {
      var key = (r.customer_email || r.customer_phone || r.customer_name || '').toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = true;
      customers.push({
        name: r.customer_name,
        email: r.customer_email,
        phone: r.customer_phone,
        billingAddress: r.billing_address
      });
    });

    return { statusCode: 200, body: JSON.stringify({ customers: customers.slice(0, 8) }) };
  } catch (err) {
    console.error('admin-search-customers failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to search customers: ' + err.message }) };
  }
};
