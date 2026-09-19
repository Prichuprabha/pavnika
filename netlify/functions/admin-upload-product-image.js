// netlify/functions/admin-upload-product-image.js
//
// POST { adminToken, filename, dataUrl }
// - Verifies the admin token (see _admin-auth.js).
// - Commits ONE photo to assets/products/<filename> via GitHub's
//   Contents API and returns its final public URL.
//
// Why one photo per request instead of bundling several into the
// product save: Netlify Functions cap a request body at 6MB, and a
// base64-encoded image effectively eats that down to ~4.5MB. A single
// resized saree photo (a few hundred KB) fits easily, but several
// photos bundled into one request for a saree with a full gallery
// could not be relied on to stay under that ceiling. Uploading one at
// a time removes that ceiling entirely — admin-save-product.js only
// ever receives plain URLs afterwards, exactly like it always has.
//
// The browser is expected to have already resized/compressed the
// photo (see the image picker in admin.js) — this function just
// commits whatever bytes it's given.

const { verifyAdminToken } = require('./_admin-auth');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const IMAGE_BASE_URL = 'https://pavnika.ae/assets/products/';

// Only ever writes into assets/products/, and only filenames shaped
// like an existing saree ID convention (letters/digits, a dash, a
// number, .jpg) — rejects anything else so this can't be pointed at
// an arbitrary path in the repo.
const FILENAME_PATTERN = /^[A-Za-z0-9]+-[0-9]+\.jpg$/;

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
  const dataUrl = body.dataUrl || '';

  if (!filename || !FILENAME_PATTERN.test(filename)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid filename.' }) };
  }

  const match = dataUrl.match(/^data:image\/jpeg;base64,(.+)$/);
  if (!match) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Expected a JPEG image (the browser should have already converted it).' }) };
  }
  const base64Content = match[1];

  // Roughly 4.5MB of base64 text — comfortably inside Netlify's request
  // limit with headroom, and already far above what a correctly resized
  // photo should ever be, so this is just a sanity backstop.
  if (base64Content.length > 6_000_000) {
    return { statusCode: 413, body: JSON.stringify({ error: 'That photo is too large even after resizing. Try a different file.' }) };
  }

  try {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/assets/products/${filename}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: githubHeaders(),
      body: JSON.stringify({
        message: `Admin: add photo ${filename}`,
        content: base64Content,
        branch: GITHUB_BRANCH
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 422 && errText.indexOf('already exists') !== -1) {
        return { statusCode: 409, body: JSON.stringify({ error: `${filename} already exists — this shouldn't normally happen; try again.` }) };
      }
      throw new Error(`GitHub error ${res.status}: ${errText}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, url: IMAGE_BASE_URL + filename })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to upload photo: ' + err.message }) };
  }
};
