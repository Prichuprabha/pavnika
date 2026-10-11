// netlify/functions/admin-save-settings.js
//
// POST { adminToken, soldOutVisibleDays }
// - Overwrites assets/settings/site-settings.json with the given
//   duration (in days). The live site (script.js) fetches this file
//   directly, the same way it already reads assets/banners/banners.json
//   -- no database, just a small committed JSON file, consistent with
//   how the rest of this site's admin-editable content works.
// - soldOutVisibleDays controls how long a sold-out item keeps showing
//   (with its "Sold Out" badge) in the live collection grids after it
//   was marked sold/ran out of stock, before it disappears from the
//   listing entirely. See isSoldOutExpired() in script.js.

const { verifyAdminToken } = require('./_admin-auth');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = 'assets/settings/site-settings.json';

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

  var days = Number(body.soldOutVisibleDays);
  if (!Number.isFinite(days) || days < 1 || days > 3650) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Enter a number of days between 1 and 3650.' }) };
  }
  days = Math.round(days);

  try {
    const sha = await getFileSha();
    const settings = { soldOutVisibleDays: days };
    const newContent = JSON.stringify(settings, null, 2) + '\n';
    const result = await putFile(newContent, sha, `Admin: sold-out visibility window set to ${days} day(s)`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        settings: settings,
        commitSha: result.commit.sha.slice(0, 7),
        commitUrl: result.commit.html_url
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save: ' + err.message }) };
  }
};
