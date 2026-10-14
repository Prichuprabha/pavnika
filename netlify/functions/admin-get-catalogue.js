// netlify/functions/admin-get-catalogue.js
//
// POST { adminToken }
// - Returns a trimmed copy of the live product catalogue (products-data.js
//   on GitHub) -- just the fields needed to list every product with its
//   selling price, for the offline Finance app's Costs & Expenses tab
//   (so cost prices can be entered against every product, not only
//   ones that have already sold).
// - CORS-enabled (see _cors.js): this is one of the few functions the
//   offline app -- run from your own computer, never deployed to
//   pavnika.ae -- calls directly. Still requires a valid adminToken.
// - Read-only. This never writes anything back to the catalogue.

const { verifyAdminToken } = require('./_admin-auth');
const { CORS_HEADERS, corsPreflight } = require('./_cors');
const { fetchProductsFromGitHub } = require('./_order-shared');

exports.handler = async function (event) {
  var preflight = corsPreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!verifyAdminToken(body.adminToken)) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Not authorized. Please sign in again.' }) };
  }

  try {
    const { products } = await fetchProductsFromGitHub();
    const trimmed = products.map(function (p) {
      return {
        id: p.id,
        department: p.department || 'saree',
        name: p.series ? (p.series + ' ' + (p.type || '')).trim() : (p.type || p.category || p.id),
        price: p.price,
        sold: !!p.sold,
        quantity: (p.quantity === null || p.quantity === undefined) ? null : Number(p.quantity)
      };
    });
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ products: trimmed }) };
  } catch (err) {
    console.error('admin-get-catalogue error:', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Failed to load catalogue: ' + err.message }) };
  }
};
