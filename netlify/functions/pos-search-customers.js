const { verifyPosToken } = require('./_pos-auth');

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

  if (!verifyPosToken(body.posToken)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Session expired, please log in again' }) };
  }

  var query = (body.query || '').trim();

  try {
    var url = `${SUPABASE_URL}/rest/v1/pos_customers?select=*&order=created_at.desc&limit=30`;
    if (query) {
      // Matches against name OR phone — a plain digit search (like
      // "5012") should find someone by phone just as easily as typing
      // part of their name.
      var encoded = encodeURIComponent(`%${query}%`);
      url = `${SUPABASE_URL}/rest/v1/pos_customers?select=*&or=(name.ilike.${encoded},phone.ilike.${encoded})&order=name.asc&limit=30`;
    }
    var res = await fetch(url, { headers: supabaseHeaders() });
    if (!res.ok) throw new Error(`Supabase query failed: ${res.status}`);
    var customers = await res.json();
    return { statusCode: 200, body: JSON.stringify({ customers: customers }) };
  } catch (e) {
    console.error('pos-search-customers error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong, please try again' }) };
  }
};
