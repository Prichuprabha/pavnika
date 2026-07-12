// netlify/functions/admin-bulk-save-products.js
//
// POST { adminToken, products: [...] }
// - Overwrites products-data.js with the full product list provided,
//   in one single commit — used by the CSV bulk add/edit feature.
// - The client is responsible for merging existing + new/edited rows
//   into the final list before calling this; the server just validates
//   basic sanity (unique, non-empty IDs) and commits.

const { verifyAdminToken } = require('./_admin-auth');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = 'products-data.js';

function githubHeaders() {
  return {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

async function getFileSha() {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) throw new Error(`GitHub read error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.sha;
}

async function putFile(newContent, sha, message) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: githubHeaders(),
    body: JSON.stringify({
      message: message,
      content: Buffer.from(newContent, 'utf-8').toString('base64'),
      sha: sha,
      branch: GITHUB_BRANCH
    })
  });
  if (!res.ok) throw new Error(`GitHub write error ${res.status}: ${await res.text()}`);
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

  const products = body.products;
  if (!Array.isArray(products) || !products.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'At least one saree is required.' }) };
  }

  const ids = products.map(function (p) { return (p.id || '').trim().toUpperCase(); });
  if (ids.some(function (id) { return !id; })) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Every saree must have a non-empty ID.' }) };
  }
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Duplicate IDs found in the submitted list. Each saree ID must be unique.' }) };
  }

  try {
    const sha = await getFileSha();
    const newContent = 'window.PRODUCTS = ' + JSON.stringify(products, null, 2) + ';\n';
    const message = `Admin: bulk update via CSV (${products.length} sarees)`;
    const result = await putFile(newContent, sha, message);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        count: products.length,
        commitSha: result.commit.sha.slice(0, 7),
        commitUrl: result.commit.html_url
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save: ' + err.message }) };
  }
};
