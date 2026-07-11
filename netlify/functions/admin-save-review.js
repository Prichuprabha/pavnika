// netlify/functions/admin-save-review.js
//
// POST { adminToken, action: 'add' | 'edit' | 'delete', review: {...}, index }
// - Reviews have no unique ID, so edit/delete reference the review's
//   position in the array (index), which the admin panel already knows
//   since it just rendered the list from this same file.
// - Same GitHub-commit pattern as admin-save-product.js.

const { verifyAdminToken } = require('./_admin-auth');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = 'assets/reviews/reviews.json';

function githubHeaders() {
  return {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

async function getFile() {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) throw new Error(`GitHub read error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { content, sha: data.sha };
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

  const action = body.action;

  try {
    const file = await getFile();
    const reviews = JSON.parse(file.content);

    var commitMessage;

    if (action === 'add') {
      var newReview = {
        name: body.review.name || '',
        stars: parseInt(body.review.stars, 10) || 5,
        photo: body.review.photo || '',
        quote: body.review.quote || ''
      };
      reviews.push(newReview);
      commitMessage = `Admin: add review from ${newReview.name}`;
    } else if (action === 'edit') {
      var idx = body.index;
      if (typeof idx !== 'number' || !reviews[idx]) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Review not found.' }) };
      }
      reviews[idx] = {
        name: body.review.name || '',
        stars: parseInt(body.review.stars, 10) || 5,
        photo: body.review.photo || '',
        quote: body.review.quote || ''
      };
      commitMessage = `Admin: edit review from ${reviews[idx].name}`;
    } else if (action === 'delete') {
      var delIdx = body.index;
      if (typeof delIdx !== 'number' || !reviews[delIdx]) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Review not found.' }) };
      }
      var removedName = reviews[delIdx].name;
      reviews.splice(delIdx, 1);
      commitMessage = `Admin: delete review from ${removedName}`;
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action.' }) };
    }

    const newContent = JSON.stringify(reviews, null, 2) + '\n';
    const result = await putFile(newContent, file.sha, commitMessage);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        reviews: reviews,
        commitSha: result.commit.sha.slice(0, 7),
        commitUrl: result.commit.html_url
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save: ' + err.message }) };
  }
};
