// netlify/functions/check-item-availability.js
//
// POST { items: [{id, qty}, ...] } (preferred) or the older
//       { sareeIds: [id, id, ...] } (still accepted, qty assumed 1
//       each) -- lets any caller not yet updated for Stage 4 keep
//       working unchanged.
// - Returns { soldIds: [...], insufficientStockIds: [...] }:
//     soldIds — items that are entirely unavailable right now, either
//       the manual "sold" checkbox or a quantity-tracked item at 0.
//     insufficientStockIds — a quantity-tracked item that still has
//       SOME stock, but less than the qty being asked about.
// - Public/read-only, no auth needed — this is the same information
//   already visible to any visitor browsing the site; the whole point
//   here is just checking it FRESH rather than relying on whatever
//   copy of products-data.js the browser already has loaded, which
//   can go stale the moment anyone else's purchase updates it.
// - Used by the checkout page to catch the exact scenario where a
//   customer had something in their cart, came back later, and it
//   sold out (or ran short) in the meantime.

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

  const requestedItems = Array.isArray(body.items)
    ? body.items
    : (Array.isArray(body.sareeIds) ? body.sareeIds.map(function (id) { return { id: id, qty: 1 }; }) : []);
  if (!requestedItems.length) {
    return { statusCode: 200, body: JSON.stringify({ soldIds: [], insufficientStockIds: [] }) };
  }

  try {
    const products = (await fetchProductsFromGitHub()).products;
    const byId = {};
    products.forEach(function (p) { byId[p.id] = p; });

    const soldIds = [];
    const insufficientStockIds = [];
    requestedItems.forEach(function (it) {
      const p = byId[it.id];
      if (!p) { soldIds.push(it.id); return; } // no longer in the catalogue at all
      const hasQty = p.quantity !== null && p.quantity !== undefined;
      if (p.sold || (hasQty && Number(p.quantity) <= 0)) { soldIds.push(it.id); return; }
      const requestedQty = Number(it.qty) || 1;
      if (hasQty && requestedQty > Number(p.quantity)) insufficientStockIds.push(it.id);
    });
    return { statusCode: 200, body: JSON.stringify({ soldIds: soldIds, insufficientStockIds: insufficientStockIds }) };
  } catch (err) {
    console.error('check-item-availability failed:', err);
    // Fail open rather than closed — if this check itself breaks, a
    // customer shouldn't be blocked from paying for items that are
    // very likely still genuinely available. The final safety net is
    // still the fact that a human reviews every order before shipping.
    return { statusCode: 200, body: JSON.stringify({ soldIds: [], insufficientStockIds: [], checkFailed: true }) };
  }
};
