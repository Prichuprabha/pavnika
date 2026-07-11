// netlify/functions/admin-save-product.js
//
// POST { adminToken, action: 'add' | 'edit', product: {...} }
// - Verifies the admin token (see _admin-auth.js).
// - Fetches products-data.js from GitHub, applies the add/edit, and
//   commits the change back — which triggers a normal Netlify deploy,
//   the same as if you'd edited and uploaded the file yourself.
// - Returns the real commit SHA and a link to view it on GitHub.

const { verifyAdminToken } = require('./_admin-auth');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = 'products-data.js';

const SERIES_CODES = {
  'VALUE WEAVES': 'VW',
  'PASTEL POETRY': 'PP',
  'GOLDEN GLOW': 'GG',
  'SUMANGALI': 'SU',
  'SANSKRITI': 'SA',
  'DEVATHA AURA': 'DA',
  'PAVNIKA SIGNATURE': 'PS',
  'SHIMMER STORIES': 'SS',
  'SOFT SILK': 'SO',
  'FESTIVE VIBES': 'FV',
  'BRIDAL BLISS': 'BB'
};

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

function parseProducts(fileContent) {
  const match = fileContent.match(/window\.PRODUCTS\s*=\s*(\[[\s\S]*\]);?\s*$/);
  if (!match) throw new Error('Could not parse products-data.js');
  return JSON.parse(match[1]);
}

function serializeProducts(products) {
  return 'window.PRODUCTS = ' + JSON.stringify(products, null, 2) + ';\n';
}

function nextIdForSeries(products, seriesCode) {
  var highest = 0;
  products.forEach(function (p) {
    if (p.id && p.id.indexOf(seriesCode) === 0) {
      var num = parseInt(p.id.slice(2), 10);
      if (!isNaN(num) && num > highest) highest = num;
    }
  });
  var next = highest + 1;
  return seriesCode + String(next).padStart(3, '0');
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
  const productInput = body.product;
  if (!action || !productInput) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing action or product data.' }) };
  }

  try {
    const file = await getFile();
    const products = parseProducts(file.content);

    var commitMessage;
    var savedProduct;

    if (action === 'add') {
      var seriesCode = productInput.seriesCode || SERIES_CODES[productInput.series];
      if (!seriesCode) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Unknown series — please provide a 2-letter series code.' }) };
      }
      var newId = nextIdForSeries(products, seriesCode);
      savedProduct = Object.assign({}, productInput, { id: newId });
      delete savedProduct.seriesCode;
      products.push(savedProduct);
      commitMessage = `Admin: add saree ${newId}`;
    } else if (action === 'edit') {
      var idx = products.findIndex(function (p) { return p.id === productInput.id; });
      if (idx === -1) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Saree ID not found.' }) };
      }
      products[idx] = Object.assign({}, products[idx], productInput);
      savedProduct = products[idx];
      commitMessage = `Admin: edit saree ${productInput.id}`;
    } else if (action === 'delete') {
      var delIdx = products.findIndex(function (p) { return p.id === productInput.id; });
      if (delIdx === -1) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Saree ID not found.' }) };
      }
      savedProduct = products[delIdx];
      products.splice(delIdx, 1);
      commitMessage = `Admin: delete saree ${productInput.id}`;
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action.' }) };
    }

    const newContent = serializeProducts(products);
    const result = await putFile(newContent, file.sha, commitMessage);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        product: savedProduct,
        commitSha: result.commit.sha.slice(0, 7),
        commitUrl: result.commit.html_url
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save: ' + err.message }) };
  }
};
