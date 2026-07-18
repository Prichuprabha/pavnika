// netlify/functions/admin-save-banner.js
//
// POST { adminToken, banners: [{ image, link }, ...] }
// - Overwrites assets/banners/banners.json with the provided list, in
//   the order given — covers reordering, link edits, and removals in
//   a single commit, since the admin panel edits the list client-side
//   first and submits the whole result at once.
// - Does not handle uploading new image files — that still goes
//   through a normal GitHub upload, by design (see admin.html note).

const { verifyAdminToken } = require('./_admin-auth');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = 'assets/banners/banners.json';

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

  if (!Array.isArray(body.banners) || !body.banners.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'At least one banner is required.' }) };
  }

  try {
    const sha = await getFileSha();
    const cleanBanners = body.banners.map(function (b) {
      return { image: b.image, mobileImage: String(b.mobileImage || '').trim(), link: b.link || 'collections.html' };
    });
    const newContent = JSON.stringify(cleanBanners, null, 2) + '\n';
    const result = await putFile(newContent, sha, 'Admin: update banners');

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        banners: cleanBanners,
        commitSha: result.commit.sha.slice(0, 7),
        commitUrl: result.commit.html_url
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save: ' + err.message }) };
  }
};
