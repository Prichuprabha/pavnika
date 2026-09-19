// netlify/functions/admin-delete-product-image.js
//
// POST { adminToken, filename }
// - Verifies the admin token.
// - Looks up the file's CURRENT sha itself (rather than trusting one
//   the browser might be holding onto from earlier in the session —
//   GitHub requires the current sha to delete a file, and a stale one
//   would just fail) and deletes assets/products/<filename>.
//
// This is a genuine, permanent delete — unlike admin-save-product.js's
// "delete" action (which only removes the product record and leaves
// photo files alone on purpose), this is what actually removes a photo
// from the repo, used when Remove is clicked on a real, already-
// uploaded photo in the edit form.

const { verifyAdminToken } = require('./_admin-auth');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const FILENAME_PATTERN = /^[A-Za-z0-9]+-[0-9]+\.jpe?g$/i;

function githubHeaders() {
  return {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
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

  const filename = body.filename;
  if (!filename || !FILENAME_PATTERN.test(filename)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid filename.' }) };
  }

  const path = `assets/products/${filename}`;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;

  try {
    const getRes = await fetch(`${url}?ref=${GITHUB_BRANCH}`, { headers: githubHeaders() });
    if (getRes.status === 404) {
      // Already gone (e.g. a retry after a previous delete actually
      // succeeded but the response was lost) — treat as success rather
      // than an error, since the end state the admin wanted is already true.
      return { statusCode: 200, body: JSON.stringify({ success: true, alreadyGone: true }) };
    }
    if (!getRes.ok) throw new Error(`GitHub read error ${getRes.status}: ${await getRes.text()}`);
    const fileData = await getRes.json();

    const delRes = await fetch(url, {
      method: 'DELETE',
      headers: githubHeaders(),
      body: JSON.stringify({
        message: `Admin: remove photo ${filename}`,
        sha: fileData.sha,
        branch: GITHUB_BRANCH
      })
    });
    if (!delRes.ok) throw new Error(`GitHub delete error ${delRes.status}: ${await delRes.text()}`);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to delete photo: ' + err.message }) };
  }
};
