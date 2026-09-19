// netlify/functions/admin-batch-update-product-images.js
//
// POST { adminToken, productId, uploads: [{filename, dataUrl}], deletions: [filename, ...] }
//
// Does everything a "Remove selected" or "Upload selected" click needs
// — adding new photo files, removing old ones, and updating this
// product's images/image fields in products-data.js — as ONE single
// GitHub commit, using the Git Data API (blobs/trees/commits/refs)
// instead of one Contents-API PUT per file.
//
// Why this exists: the earlier version of this feature committed each
// photo individually (admin-upload-product-image.js /
// admin-delete-product-image.js), plus a separate commit to sync the
// product record. Every commit is a push, and every push is a Netlify
// deploy trigger — so uploading 5 photos meant up to 6 deploys, each
// one costing build-minute/deploy credits regardless of whether
// Netlify's dashboard later shows some of them as "Skipped" (that
// skipping is a best-effort race against build start time, not
// something to rely on for cost control). Bundling everything into one
// commit means one batch action is always exactly one deploy, full stop.

const { verifyAdminToken } = require('./_admin-auth');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const IMAGE_BASE_URL = 'https://pavnika.ae/assets/products/';
const PRODUCTS_FILE_PATH = 'products-data.js';

const FILENAME_PATTERN = /^[A-Za-z0-9]+-[0-9]+\.jpe?g$/i;

function githubHeaders() {
  return {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

async function githubApi(path, options) {
  const res = await fetch(`https://api.github.com${path}`, Object.assign({ headers: githubHeaders() }, options || {}));
  if (!res.ok) throw new Error(`GitHub ${options && options.method || 'GET'} ${path} -> ${res.status}: ${await res.text()}`);
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
  const uploads = Array.isArray(body.uploads) ? body.uploads : [];
  const deletions = Array.isArray(body.deletions) ? body.deletions : [];

  if (!productId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing productId.' }) };
  if (!uploads.length && !deletions.length) return { statusCode: 400, body: JSON.stringify({ error: 'Nothing to do — no uploads or deletions given.' }) };

  for (const u of uploads) {
    if (!u.filename || !FILENAME_PATTERN.test(u.filename)) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid upload filename: ' + u.filename }) };
    if (!u.dataUrl || !/^data:image\/jpeg;base64,/.test(u.dataUrl)) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid image data for ' + u.filename }) };
  }
  for (const f of deletions) {
    if (!FILENAME_PATTERN.test(f)) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid delete filename: ' + f }) };
  }

  try {
    // 1. Where the branch currently points, and the tree that commit uses.
    const ref = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}`);
    const baseCommitSha = ref.object.sha;
    const baseCommit = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${baseCommitSha}`);
    const baseTreeSha = baseCommit.tree.sha;

    // 2. Read products-data.js as it stands right now (off the same
    //    base commit, so this batch can't silently clobber a change
    //    made by someone else between "load the form" and "click the
    //    button"), and apply the images update in memory — but only if
    //    this product already has a live record to sync. A brand-new
    //    saree being created (Add mode) has no row yet — its photos
    //    still get committed together in this same single commit, they
    //    just don't touch products-data.js until the whole new saree
    //    is saved for the first time.
    const dataFile = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${PRODUCTS_FILE_PATH}?ref=${baseCommitSha}`);
    const products = parseProducts(Buffer.from(dataFile.content, 'base64').toString('utf-8'));
    const idx = products.findIndex(function (p) { return p.id === productId; });
    const productExists = idx !== -1;

    let images = [];
    if (productExists) {
      images = products[idx].images ? products[idx].images.slice() : [];
      deletions.forEach(function (filename) {
        images = images.filter(function (u) { return String(u).split('/').pop() !== filename; });
      });
    }
    const uploadedUrls = uploads.map(function (u) { return IMAGE_BASE_URL + u.filename; });
    if (productExists) {
      images = images.concat(uploadedUrls);
      products[idx] = Object.assign({}, products[idx], { images: images, image: images[0] || '' });
    }
    const newProductsContent = serializeProducts(products);

    // 3. One blob per changed file — new photos, plus the rewritten
    //    products-data.js. Deletions don't need a blob at all; the
    //    tree entry below with sha: null is what removes them.
    const treeEntries = [];

    for (const u of uploads) {
      const base64Content = u.dataUrl.replace(/^data:image\/jpeg;base64,/, '');
      const blob = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: base64Content, encoding: 'base64' })
      });
      treeEntries.push({ path: `assets/products/${u.filename}`, mode: '100644', type: 'blob', sha: blob.sha });
    }

    deletions.forEach(function (filename) {
      treeEntries.push({ path: `assets/products/${filename}`, mode: '100644', type: 'blob', sha: null });
    });

    if (productExists) {
      const dataBlob = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: newProductsContent, encoding: 'utf-8' })
      });
      treeEntries.push({ path: PRODUCTS_FILE_PATH, mode: '100644', type: 'blob', sha: dataBlob.sha });
    }

    // 4. One tree, one commit, one ref update — this is the actual
    //    single push, whether the batch touched 1 photo or 20.
    const newTree = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries })
    });

    const uploadCount = uploads.length, deleteCount = deletions.length;
    const parts = [];
    if (uploadCount) parts.push(`add ${uploadCount} photo${uploadCount === 1 ? '' : 's'}`);
    if (deleteCount) parts.push(`remove ${deleteCount} photo${deleteCount === 1 ? '' : 's'}`);
    const commitMessage = `Admin: ${parts.join(', ')} for ${productId}`;

    const newCommit = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message: commitMessage, tree: newTree.sha, parents: [baseCommitSha] })
    });

    await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${GITHUB_BRANCH}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha })
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        product: productExists ? products[idx] : null,
        uploadedUrls: uploadedUrls,
        commitSha: newCommit.sha.slice(0, 7)
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Batch update failed: ' + err.message }) };
  }
};
