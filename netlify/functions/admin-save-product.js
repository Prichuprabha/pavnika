// netlify/functions/admin-save-product.js
//
// POST { adminToken, action: 'add' | 'edit' | 'delete', product: {...},
//        newImages?: [{filename, dataUrl}], removedImages?: [filename, ...] }
// - Verifies the admin token (see _admin-auth.js).
// - Applies the add/edit/delete to products-data.js and commits it.
// - If newImages or removedImages are present, those photo file changes
//   are folded into the SAME commit as the product-data change (via
//   GitHub's Git Data API — blobs/trees/commits/refs) rather than each
//   being its own commit. One press of "Save to GitHub" — whatever
//   combination of text-field edits, new photos, and removed photos it
//   represents — is always exactly one commit, one deploy.
// - This also closes the "forgot to save" gap a different way than an
//   earlier version of this feature did: nothing about photos touches
//   GitHub until this single save happens, so forgetting to press Save
//   now means nothing happened yet (fully consistent), never a photo
//   deleted with the record left pointing at it.
// - Returns the real commit SHA and a link to view it on GitHub.

const { verifyAdminToken } = require('./_admin-auth');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = 'products-data.js';
const IMAGE_BASE_URL = 'https://pavnika.ae/assets/products/';

const FILENAME_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-[0-9]+\.jpe?g$/i;

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

async function githubApi(path, options) {
  const res = await fetch(`https://api.github.com${path}`, Object.assign({ headers: githubHeaders() }, options || {}));
  if (!res.ok) {
    const err = new Error(`GitHub ${options && options.method || 'GET'} ${path} -> ${res.status}: ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function getFile() {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) throw new Error(`GitHub read error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { content, sha: data.sha };
}

// Stage 4 of the quantity feature (approved retry-on-conflict fix):
// a stale `sha` (someone else committed in between) gets a 409 from
// GitHub -- it never corrupts the file, but until now nothing here
// checked for it, so a second concurrent admin save was silently
// DROPPED (a lost update) rather than retried or even reported. The
// caller re-reads the file, reapplies its own change against that
// fresh copy, and calls this again; `err.status` is what lets it tell
// a real conflict (worth retrying) apart from any other failure.
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
  if (!res.ok) {
    const err = new Error(`GitHub write error ${res.status}: ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
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

// Applies the add/edit/delete to an in-memory products array (does NOT
// touch GitHub) — shared by both the simple path and the photo-aware
// Git Data API path below, so the actual product-editing logic only
// exists once.
function applyAction(products, action, productInput) {
  if (action === 'add') {
    var suppliedId = productInput.id && String(productInput.id).trim().toUpperCase();
    var finalId;
    if (suppliedId) {
      var duplicate = products.some(function (p) { return p.id.toUpperCase() === suppliedId; });
      if (duplicate) return { error: { statusCode: 409, message: `ID ${suppliedId} already exists. Choose a different one.` } };
      finalId = suppliedId;
    } else {
      var seriesCode = productInput.seriesCode || SERIES_CODES[productInput.series];
      if (!seriesCode) return { error: { statusCode: 400, message: 'Unknown series — please provide a 2-letter series code.' } };
      finalId = nextIdForSeries(products, seriesCode);
    }
    // Every field the client sent is kept (not a hardcoded saree-only
    // whitelist) so department-specific fields — department, colour,
    // note, baseId, size, salePrice, occasions — are never silently
    // dropped for a newly-added Jewellery or Accessory item. seriesCode
    // is purely an instruction for picking finalId above, never meant
    // to be stored on the product itself.
    var savedProduct = Object.assign({}, productInput, { id: finalId });
    delete savedProduct.seriesCode;
    products.push(savedProduct);
    var addedLabel = productInput.department === 'jewellery' ? 'jewellery item' : productInput.department === 'accessory' ? 'accessory' : 'saree';
    return { savedProduct: savedProduct, commitMessage: `Admin: add ${addedLabel} ${finalId}` };
  } else if (action === 'edit') {
    var idx = products.findIndex(function (p) { return p.id === productInput.id; });
    if (idx === -1) return { error: { statusCode: 404, message: 'Saree ID not found.' } };
    products[idx] = Object.assign({}, products[idx], productInput);
    var editedLabel = products[idx].department === 'jewellery' ? 'jewellery item' : products[idx].department === 'accessory' ? 'accessory' : 'saree';
    return { savedProduct: products[idx], commitMessage: `Admin: edit ${editedLabel} ${productInput.id}` };
  } else if (action === 'delete') {
    // Note: this only removes the product entry from products-data.js.
    // Its photo files under assets/products/ are intentionally left in
    // place rather than deleted — an unused file is harmless, whereas
    // deleting the wrong one (e.g. a race with a concurrent edit) is
    // not, so this trades a little disk space for that safety.
    var delIdx = products.findIndex(function (p) { return p.id === productInput.id; });
    if (delIdx === -1) return { error: { statusCode: 404, message: 'Saree ID not found.' } };
    var deleted = products[delIdx];
    products.splice(delIdx, 1);
    var deletedLabel = deleted.department === 'jewellery' ? 'jewellery item' : deleted.department === 'accessory' ? 'accessory' : 'saree';
    return { savedProduct: deleted, commitMessage: `Admin: delete ${deletedLabel} ${productInput.id}` };
  }
  return { error: { statusCode: 400, message: 'Unknown action.' } };
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
  const newImages = Array.isArray(body.newImages) ? body.newImages : [];
  const removedImages = Array.isArray(body.removedImages) ? body.removedImages : [];
  if (!action || !productInput) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing action or product data.' }) };
  }

  for (const u of newImages) {
    if (!u.filename || !FILENAME_PATTERN.test(u.filename)) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid upload filename: ' + u.filename }) };
    if (!u.dataUrl || !/^data:image\/jpeg;base64,/.test(u.dataUrl)) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid image data for ' + u.filename }) };
  }
  for (const f of removedImages) {
    if (!FILENAME_PATTERN.test(f)) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid delete filename: ' + f }) };
  }

  const MAX_ATTEMPTS = 4;

  try {
    const hasPhotoChanges = newImages.length > 0 || removedImages.length > 0;

    if (!hasPhotoChanges) {
      // The common case (editing text fields only) — same simple
      // single-file path this function has always used. Stage 4's
      // retry fix: on a 409 (someone else committed in between), this
      // re-reads the file and reapplies the SAME add/edit/delete
      // against that fresh copy, rather than the earlier attempt's
      // change being silently dropped.
      let commitResult, result;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const file = await getFile();
        const products = parseProducts(file.content);
        result = applyAction(products, action, productInput);
        if (result.error) return { statusCode: result.error.statusCode, body: JSON.stringify({ error: result.error.message }) };

        try {
          commitResult = await putFile(serializeProducts(products), file.sha, result.commitMessage);
          break;
        } catch (e) {
          if (e.status === 409 && attempt < MAX_ATTEMPTS) {
            console.warn(`admin-save-product: sha conflict on attempt ${attempt}, retrying against a fresh copy...`);
            continue;
          }
          throw e;
        }
      }
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          product: result.savedProduct,
          commitSha: commitResult.commit.sha.slice(0, 7),
          commitUrl: commitResult.commit.html_url
        })
      };
    }

    // Photos are involved — bundle the file changes and the
    // products-data.js update into one commit via the Git Data API.
    // New image blobs are content-addressed (their sha depends only on
    // their bytes, not on which base tree they end up attached to), so
    // they're created once, outside the retry loop below — only the
    // base ref/tree/commit and the final ref update need to be redone
    // against a fresh base on a conflict.
    const newImageBlobs = [];
    for (const u of newImages) {
      const base64Content = u.dataUrl.replace(/^data:image\/jpeg;base64,/, '');
      const blob = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: base64Content, encoding: 'base64' })
      });
      newImageBlobs.push({ filename: u.filename, sha: blob.sha });
    }

    let result, newCommit;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const ref = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}`);
      const baseCommitSha = ref.object.sha;
      const baseCommit = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${baseCommitSha}`);
      const baseTreeSha = baseCommit.tree.sha;

      const dataFile = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}?ref=${baseCommitSha}`);
      const products = parseProducts(Buffer.from(dataFile.content, 'base64').toString('utf-8'));
      result = applyAction(products, action, productInput);
      if (result.error) return { statusCode: result.error.statusCode, body: JSON.stringify({ error: result.error.message }) };

      const treeEntries = newImageBlobs.map(function (b) {
        return { path: `assets/products/${b.filename}`, mode: '100644', type: 'blob', sha: b.sha };
      });
      removedImages.forEach(function (filename) {
        treeEntries.push({ path: `assets/products/${filename}`, mode: '100644', type: 'blob', sha: null });
      });

      const dataBlob = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: serializeProducts(products), encoding: 'utf-8' })
      });
      treeEntries.push({ path: FILE_PATH, mode: '100644', type: 'blob', sha: dataBlob.sha });

      const newTree = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`, {
        method: 'POST',
        body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries })
      });

      const photoNote = [];
      if (newImages.length) photoNote.push(`+${newImages.length} photo${newImages.length === 1 ? '' : 's'}`);
      if (removedImages.length) photoNote.push(`-${removedImages.length} photo${removedImages.length === 1 ? '' : 's'}`);
      const commitMessage = `${result.commitMessage} (${photoNote.join(', ')})`;

      newCommit = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`, {
        method: 'POST',
        body: JSON.stringify({ message: commitMessage, tree: newTree.sha, parents: [baseCommitSha] })
      });

      try {
        await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${GITHUB_BRANCH}`, {
          method: 'PATCH',
          body: JSON.stringify({ sha: newCommit.sha })
        });
        break; // success
      } catch (e) {
        // A non-fast-forward update (branch moved since this attempt's
        // ref read) comes back as 422 from this endpoint, not 409 --
        // same underlying race as the plain Contents API's 409, just a
        // different status code for this particular endpoint.
        if ((e.status === 409 || e.status === 422) && attempt < MAX_ATTEMPTS) {
          console.warn(`admin-save-product: branch moved on attempt ${attempt} (photo commit), retrying against a fresh base...`);
          continue;
        }
        throw e;
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        product: result.savedProduct,
        commitSha: newCommit.sha.slice(0, 7)
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save: ' + err.message }) };
  }
};
