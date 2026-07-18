// netlify/functions/keep-alive.js
//
// Scheduled function — runs automatically on the cron schedule below.
// Makes a trivial read against Supabase so the free-tier project never
// goes a full 7 days without activity (which would otherwise pause it).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async function () {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/verified_visitors?select=id&limit=1`, {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    console.log('keep-alive ping status:', res.status);
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('keep-alive failed:', err);
    return { statusCode: 500, body: 'failed' };
  }
};

exports.config = {
  schedule: '0 6 * * *' // once daily at 06:00 UTC
};
