// netlify/functions/admin-bulk-save-business-expenses.js
//
// POST { adminToken, expenses: [{ id?, date, category, description?,
//        amount, currency, fxRate? }, ...] }
// - Used by the CSV import flow in the admin panel's Company -> Business
//   Expenses section. Replaces the earlier approach of one
//   admin-save-business-expense call per row: a 100+ row CSV meant 100+
//   sequential network round trips from the browser, and on a slow or
//   flaky connection some of those could silently fail partway through
//   while the UI had already reported success (the "only 62 of 110 rows
//   showed up" bug).
// - Does the whole import in (at most) TWO requests instead of one per
//   row: all rows carrying an id go in a single Supabase upsert call
//   (on_conflict=id, updating those existing rows), and all rows without
//   an id go in a single plain insert call (the DB assigns each a fresh
//   id). Two calls, not one, because PostgREST requires every object in
//   one bulk request to share the same set of keys -- rows with and
//   without `id` can't be mixed in a single call. Each of the (at most
//   two) Postgres statements is all-or-nothing on its own, so there's no
//   silent partial-import state to land in.
// - Rows failing basic validation are rejected up front with which row
//   (by position) failed, rather than silently dropped.

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

  const input = Array.isArray(body.expenses) ? body.expenses : [];
  if (!input.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No expenses to import.' }) };
  }
  if (input.length > 2000) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Too many rows in one import (max 2000). Split the CSV and try again.' }) };
  }

  const who = session.displayName || session.username || null;
  const nowIso = new Date().toISOString();
  // PostgREST's bulk insert/upsert requires every object in one request
  // to have the exact same set of keys ("all object keys must match") --
  // it builds a single INSERT with one shared column list, so a mix of
  // rows with and without `id` in the same array fails outright. Rows
  // are split into two homogeneous batches (update-by-id vs. brand-new)
  // and sent as up to two requests instead of one, rather than one
  // request per row like the original import did.
  const updateRows = [];
  const newRows = [];

  for (let i = 0; i < input.length; i++) {
    const e = input[i];
    const date = (e.date || '').trim();
    const category = (e.category || '').trim();
    const description = (e.description || '').trim();
    const amountEntered = Number(e.amount);
    const currency = (e.currency || 'AED').trim().toUpperCase();

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { statusCode: 400, body: JSON.stringify({ error: `Row ${i + 1}: a valid date (YYYY-MM-DD) is required.` }) };
    }
    if (!category) {
      return { statusCode: 400, body: JSON.stringify({ error: `Row ${i + 1}: category is required.` }) };
    }
    if (!amountEntered || isNaN(amountEntered) || amountEntered <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: `Row ${i + 1}: amount must be a positive number.` }) };
    }

    const row = {
      expense_date: date,
      category: category,
      description: description,
      updated_at: nowIso,
      updated_by: who
    };

    if (currency !== 'AED') {
      const rate = Number(e.fxRate);
      if (!rate || isNaN(rate) || rate <= 0) {
        return { statusCode: 400, body: JSON.stringify({ error: `Row ${i + 1}: enter the exchange rate (1 ${currency} = ? AED).` }) };
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

    if (e.id) {
      row.id = e.id;
      updateRows.push(row);
    } else {
      row.created_at = nowIso;
      row.created_by = who;
      newRows.push(row);
    }
  }

  try {
    const saved = [];

    if (updateRows.length) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/business_expenses?on_conflict=id`, {
        method: 'POST',
        headers: supabaseHeaders({ 'Prefer': 'resolution=merge-duplicates,return=representation' }),
        body: JSON.stringify(updateRows)
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error('admin-bulk-save-business-expenses: Supabase error (updates)', res.status, errText);
        return { statusCode: 500, body: JSON.stringify({ error: 'Import failed while saving updates -- nothing from this import was saved. (' + errText + ')' }) };
      }
      saved.push.apply(saved, await res.json());
    }

    if (newRows.length) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/business_expenses`, {
        method: 'POST',
        headers: supabaseHeaders({ 'Prefer': 'return=representation' }),
        body: JSON.stringify(newRows)
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error('admin-bulk-save-business-expenses: Supabase error (new rows)', res.status, errText);
        return {
          statusCode: 500,
          body: JSON.stringify({
            error: updateRows.length
              ? (updateRows.length + ' update(s) were saved, but the new rows failed, so nothing new was added. (' + errText + ')')
              : ('Import failed -- nothing was saved. (' + errText + ')')
          })
        };
      }
      saved.push.apply(saved, await res.json());
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, count: saved.length, expenses: saved.map(toFriendly) }) };
  } catch (err) {
    console.error('admin-bulk-save-business-expenses error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not import expenses: ' + err.message }) };
  }
};
