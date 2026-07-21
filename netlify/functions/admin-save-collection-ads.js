// netlify/functions/admin-save-collection-ads.js
//
// POST { adminToken, ads: [{ file }, ...] }  (max 3)
// Overwrites assets/ads/collections-ads.json with the provided list.
// Media files themselves are uploaded to assets/ads/ via GitHub, same
// workflow as banners and homepage videos.

const { verifyAdminToken } = require('./_admin-auth');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = 'assets/ads/collections-ads.json';

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
  if (res.status === 404) return null; // file may not exist yet
  if (!res.ok) throw new Error(`GitHub read error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.sha;
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

  const raw = Array.isArray(body.ads) ? body.ads : [];
  const ads = raw
    .map((a) => ({ file: String((a && a.file) || '').trim() }))
    .filter((a) => a.file && !a.file.includes('/') && !a.file.includes('\\') && !a.file.includes('..'))
    .slice(0, 3);

  try {
    const sha = await getFileSha();
    const content = Buffer.from(JSON.stringify(ads, null, 2) + '\n').toString('base64');
    const payload = {
      message: `Admin: update collections sidebar ads (${ads.length} item${ads.length === 1 ? '' : 's'})`,
      content,
      branch: GITHUB_BRANCH
    };
    if (sha) payload.sha = sha;

    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: githubHeaders(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`GitHub write error ${res.status}:`, errText);
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not save to GitHub.' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, count: ads.length }) };
  } catch (err) {
    console.error('Save collection ads error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error saving ads.' }) };
  }
};
