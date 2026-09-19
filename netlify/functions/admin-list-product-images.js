// netlify/functions/admin-list-product-images.js
//
// POST { adminToken, productId }
// - Verifies the admin token.
// - Lists assets/products/ on GitHub and returns just the files that
//   belong to this product (name starts with "<productId>-").
//
// This exists to answer a question the admin panel couldn't answer on
// its own before: what photo files are ACTUALLY sitting in GitHub for
// this saree right now, independent of whatever products-data.js says
// or whatever the browser happens to remember from this editing
// session. Three things depend on that ground truth:
//   1. The "Photos in GitHub" note shown in the edit form.
//   2. Picking a collision-free filename for a newly uploaded photo —
//      without this, a photo that was uploaded then Removed earlier in
//      the same session (see admin-delete-product-image.js — deletion
//      can fail) could have its number silently reused.
//   3. Knowing a file's current sha, which deleting it requires.

const { verifyAdminToken } = require('./_admin-auth');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const IMAGE_BASE_URL = 'https://pavnika.ae/assets/products/';

function githubHeaders() {
  return {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
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

  const productId = String(body.productId || '').trim().toUpperCase();
  if (!productId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing productId.' }) };
  }

  try {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/assets/products?ref=${GITHUB_BRANCH}`;
    const res = await fetch(url, { headers: githubHeaders() });
    if (!res.ok) throw new Error(`GitHub error ${res.status}: ${await res.text()}`);
    const listing = await res.json();

    const prefix = productId + '-';
    const pattern = new RegExp('^' + productId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)\\.jpe?g$', 'i');

    const files = listing
      .filter(function (f) { return f.type === 'file' && f.name.toLowerCase().indexOf(prefix.toLowerCase()) === 0 && pattern.test(f.name); })
      .map(function (f) {
        var m = f.name.match(pattern);
        return { filename: f.name, sha: f.sha, url: IMAGE_BASE_URL + f.name, index: m ? parseInt(m[1], 10) : 0 };
      })
      .sort(function (a, b) { return a.index - b.index; });

    return { statusCode: 200, body: JSON.stringify({ success: true, files: files }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to list photos: ' + err.message }) };
  }
};
