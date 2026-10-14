// netlify/functions/admin-save-business-settings.js
//
// POST { adminToken, legalName, tradeLicenseNumber, licensingAuthority,
//        registeredAddress, vatRegistered, trn, corporateTaxTrn }
// - Upserts the single business_settings row (id = 1), edited from the
//   admin panel's Company Settings tab. Called only from admin.html
//   (same origin) -- no CORS needed here, unlike the read side.
// - This is the one place these details are edited; the invoice email
//   (_order-shared.js) reads from this same row, so a save here
//   updates every invoice sent after it, without touching any code.

const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=representation'
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

  const legalName = (body.legalName || '').trim();
  const registeredAddress = (body.registeredAddress || '').trim();
  if (!legalName || !registeredAddress) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Legal trading name and registered address are required.' }) };
  }

  const row = {
    id: 1,
    legal_name: legalName,
    trade_license_number: (body.tradeLicenseNumber || '').trim(),
    licensing_authority: (body.licensingAuthority || '').trim(),
    registered_address: registeredAddress,
    vat_registered: !!body.vatRegistered,
    trn: (body.trn || '').trim(),
    corporate_tax_trn: (body.corporateTaxTrn || '').trim(),
    updated_at: new Date().toISOString(),
    updated_by: session.displayName || session.username || null
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/business_settings`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify(row)
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('admin-save-business-settings: Supabase error', res.status, errText);
      throw new Error(`Supabase error ${res.status}`);
    }
    const saved = await res.json();
    return { statusCode: 200, body: JSON.stringify({ success: true, settings: saved[0] }) };
  } catch (err) {
    console.error('admin-save-business-settings error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not save settings: ' + err.message }) };
  }
};
