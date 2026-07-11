// netlify/functions/admin-get-stats.js
//
// POST { adminToken }
// - Returns: recent visitor logins, visitor counts by country, and
//   saree view counts grouped by product ID.
// - Admin-only, same signed-token check as the other admin functions.

const { verifyAdminToken } = require('./_admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function supabaseFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
  return res.json();
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

  try {
    const visitors = await supabaseFetch(
      'verified_visitors?select=email,phone,country,region,verified_at&verified=eq.true&order=verified_at.desc&limit=200'
    );

    const views = await supabaseFetch('saree_views?select=product_id,created_at&order=created_at.desc&limit=5000');

    const viewCounts = {};
    views.forEach(function (v) {
      viewCounts[v.product_id] = (viewCounts[v.product_id] || 0) + 1;
    });
    const mostViewed = Object.keys(viewCounts)
      .map(function (id) { return { productId: id, views: viewCounts[id] }; })
      .sort(function (a, b) { return b.views - a.views; })
      .slice(0, 20);

    const regionCounts = {};
    visitors.forEach(function (v) {
      var label;
      if (!v.country) {
        label = 'Unknown';
      } else if (v.region) {
        label = v.region + ', ' + v.country;
      } else {
        label = v.country;
      }
      regionCounts[label] = (regionCounts[label] || 0) + 1;
    });
    const regions = Object.keys(regionCounts)
      .map(function (label) { return { country: label, count: regionCounts[label] }; })
      .sort(function (a, b) { return b.count - a.count; });

    return {
      statusCode: 200,
      body: JSON.stringify({
        totalVisitors: visitors.length,
        totalViews: views.length,
        recentLogins: visitors.slice(0, 50),
        mostViewed: mostViewed,
        regions: regions
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load stats: ' + err.message }) };
  }
};
