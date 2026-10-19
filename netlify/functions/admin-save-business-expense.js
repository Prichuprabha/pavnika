// netlify/functions/admin-save-business-expense.js
//
// POST { adminToken, id?, date, category, description?, amount,
//        currency ('AED'|'INR'|'USD'), fxRate? }
// - Creates a new business_expenses row (id omitted) or updates an
//   existing one (id given) -- called only from admin.html (same
//   origin), no CORS needed here, unlike the read side.
// - currency === 'AED' stores amount as amount_aed directly, with
//   orig_currency/orig_amount/fx_rate cleared. Any other currency
//   requires fxRate (1 <currency> = ? AED) and stores both the
//   converted AED figure AND the original currency/amount/rate, same
//   convention the old offline-tool Add Expense form used.

const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders(extra) {
  return Object.assign({
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  }, extra || {});
}

function toFriendly(row) {
  return {
    id: row.id,
    date: row.expense_date,
    category: row.category,
    description: row.description || '',
    amount: Number(row.amount_aed),
    origCurrency: row.orig_currency || null,
    origAmount: row.orig_amount !== null && row.orig_amount !== undefined ? Number(row.orig_amount) : null,
    fxRate: row.fx_rate !== null && row.fx_rate !== undefined ? Number(row.fx_rate) : null,
    createdAt: row.created_at,
    createdBy: row.created_by || null,
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null
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

  const session = verifyAdminToken(body.adminToken);
  if (!session) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authorized. Please sign in again.' }) };
  }

  const date = (body.date || '').trim();
  const category = (body.category || '').trim();
  const description = (body.description || '').trim();
  const amountEntered = Number(body.amount);
  const currency = (body.currency || 'AED').trim().toUpperCase();

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'A valid date (YYYY-MM-DD) is required.' }) };
  }
  if (!category) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Category is required.' }) };
  }
  if (!amountEntered || isNaN(amountEntered) || amountEntered <= 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Amount must be a positive number.' }) };
  }

  const row = {
    expense_date: date,
    category: category,
    description: description,
    updated_at: new Date().toISOString(),
    updated_by: session.displayName || session.username || null
  };

  if (currency !== 'AED') {
    const rate = Number(body.fxRate);
    if (!rate || isNaN(rate) || rate <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Enter the exchange rate (1 ' + currency + ' = ? AED).' }) };
    }
    row.amount_aed = Math.round(amountEntered * rate * 100) / 100;
    row.orig_currency = currency;
    row.orig_amount = amountEntered;
    row.fx_rate = rate;
  } else {
    row.amount_aed = amountEntered;
    row.orig_currency = null;
    row.orig_amount = null;
    row.fx_rate = null;
  }

  try {
    var res, saved;
    if (body.id) {
      res = await fetch(`${SUPABASE_URL}/rest/v1/business_expenses?id=eq.${encodeURIComponent(body.id)}`, {
        method: 'PATCH',
        headers: supabaseHeaders({ 'Prefer': 'return=representation' }),
        body: JSON.stringify(row)
      });
      if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
      saved = await res.json();
      if (!saved.length) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Expense not found.' }) };
      }
    } else {
      row.created_at = new Date().toISOString();
      row.created_by = session.displayName || session.username || null;
      res = await fetch(`${SUPABASE_URL}/rest/v1/business_expenses`, {
        method: 'POST',
        headers: supabaseHeaders({ 'Prefer': 'return=representation' }),
        body: JSON.stringify(row)
      });
      if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
      saved = await res.json();
    }
    return { statusCode: 200, body: JSON.stringify({ success: true, expense: toFriendly(saved[0]) }) };
  } catch (err) {
    console.error('admin-save-business-expense error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not save this expense: ' + err.message }) };
  }
};
