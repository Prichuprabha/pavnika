// netlify/functions/admin-delete-business-expense.js
//
// POST { adminToken, id }
// - Permanently deletes one business_expenses row, from the admin
//   panel's Company -> Business Expenses section.

const { verifyAdminToken } = require('./_admin-auth');

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
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!verifyAdminToken(body.adminToken)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authorized. Please sign in again.' }) };
  }

  if (!body.id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing expense id' }) };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/business_expenses?id=eq.${encodeURIComponent(body.id)}`, {
      method: 'DELETE',
      headers: supabaseHeaders()
    });
    if (!res.ok) {
      console.error('admin-delete-business-expense: Supabase error', res.status, await res.text());
      throw new Error(`Supabase error ${res.status}`);
    }
    const deleted = await res.json();
    if (!deleted.length) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Expense not found.' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('admin-delete-business-expense error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not delete this expense: ' + err.message }) };
  }
};
