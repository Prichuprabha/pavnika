// netlify/functions/check-item-availability.js
//
// POST { sareeIds: [id, id, ...] }
// - Returns { soldIds: [...] } — whichever of the given IDs are
//   currently marked sold in the live catalogue on GitHub.
// - Public/read-only, no auth needed — this is the same information
//   already visible to any visitor browsing the site; the whole point
//   here is just checking it FRESH rather than relying on whatever
//   copy of products-data.js the browser already has loaded, which
//   can go stale the moment anyone else's purchase updates it.
// - Used by the checkout page to catch the exact scenario where a
//   customer had something in their cart, came back later, and it
//   sold to someone else in the meantime.

const { fetchProductsFromGitHub } = require('./_order-shared');

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

  const sareeIds = Array.isArray(body.sareeIds) ? body.sareeIds : [];
  if (!sareeIds.length) {
    return { statusCode: 200, body: JSON.stringify({ soldIds: [] }) };
  }

  try {
    const products = (await fetchProductsFromGitHub()).products;
    const soldIds = products
      .filter(function (p) { return sareeIds.indexOf(p.id) !== -1 && p.sold; })
      .map(function (p) { return p.id; });
    return { statusCode: 200, body: JSON.stringify({ soldIds: soldIds }) };
  } catch (err) {
    console.error('check-item-availability failed:', err);
    // Fail open rather than closed — if this check itself breaks, a
    // customer shouldn't be blocked from paying for items that are
    // very likely still genuinely available. The final safety net is
    // still the fact that a human reviews every order before shipping.
    return { statusCode: 200, body: JSON.stringify({ soldIds: [], checkFailed: true }) };
  }
};
