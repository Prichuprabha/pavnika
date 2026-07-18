// netlify/functions/admin-save-videos.js
//
// POST { adminToken, videos: ["video-1.mp4", "", "", ""] }
// - Overwrites assets/videos/home-video-slots.json with exactly 4
//   slots (a filename, or "" for an empty slot showing the fallback).
//   Empty strings are meaningful here — they mark an empty slot by
//   position, so they're kept rather than filtered out.
// - Does not handle uploading new video files — those still go
//   through a normal GitHub upload, by design (video files are large).

const { verifyAdminToken } = require('./_admin-auth');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = 'assets/videos/home-video-slots.json';

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

  if (!Array.isArray(body.videos)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Video slots must be a list.' }) };
  }

  try {
    const sha = await getFileSha();
    // Keep exactly 4 slots. Each slot is { file, link } — empty file
    // means an intentionally empty slot by position (shows the Pavnika
    // mark), so empties are preserved, not stripped. Old-format plain
    // strings are accepted and upgraded to { file, link: '' }.
    var cleanVideos = body.videos.slice(0, 4).map(function (v) {
      if (v && typeof v === 'object') {
        return { file: String(v.file || '').trim(), link: String(v.link || '').trim() };
      }
      return { file: String(v || '').trim(), link: '' };
    });
    while (cleanVideos.length < 4) cleanVideos.push({ file: '', link: '' });
    const newContent = JSON.stringify(cleanVideos, null, 2) + '\n';
    const result = await putFile(newContent, sha, 'Admin: update home page video slots');

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        videos: cleanVideos,
        commitSha: result.commit.sha.slice(0, 7),
        commitUrl: result.commit.html_url
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save: ' + err.message }) };
  }
};
