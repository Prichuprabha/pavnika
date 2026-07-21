var ADMIN_TOKEN_KEY = 'pavnika_admin_token';

// Used only to build the "View on GitHub" link on the Stats page.
// Update these if your GitHub username or repo name ever changes.
var GITHUB_OWNER = 'Prichuprabha';
var GITHUB_REPO = 'pavnika';

var SERIES_CODES = {
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

document.addEventListener('DOMContentLoaded', function () {
  var existingToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (existingToken) {
    var email = decodeTokenEmail(existingToken);
    showAdminPanel(existingToken, email);
  } else {
    initAdminLogin();
  }
});

function decodeTokenEmail(token) {
  try {
    var payloadB64 = token.split('.')[0];
    var payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    return payload.email;
  } catch (e) {
    return 'Admin';
  }
}

/* ---------- Login ---------- */
function initAdminLogin() {
  var sendBtn = document.getElementById('admin-send-btn');
  var verifyBtn = document.getElementById('admin-verify-btn');
  var email = '';

  function showStepCode() {
    document.getElementById('admin-step-details').style.display = 'none';
    document.getElementById('admin-step-code').style.display = 'block';
    document.getElementById('admin-gate-code').focus();
  }

  sendBtn.addEventListener('click', function () {
    var emailInput = document.getElementById('admin-gate-email').value.trim();
    var errorEl = document.getElementById('admin-error-1');
    errorEl.textContent = '';

    if (!emailInput || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
      errorEl.textContent = 'Please enter a valid email address.';
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';

    fetch('/.netlify/functions/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailInput })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) {
          errorEl.textContent = result.data.error || 'Something went wrong.';
          return;
        }
        email = emailInput;
        showStepCode();
      })
      .catch(function () { errorEl.textContent = 'Network error. Please try again.'; })
      .finally(function () {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send Verification Code';
      });
  });

  verifyBtn.addEventListener('click', function () {
    var code = document.getElementById('admin-gate-code').value.trim();
    var errorEl = document.getElementById('admin-error-2');
    errorEl.textContent = '';

    if (!code || code.length !== 4) {
      errorEl.textContent = 'Please enter the 4-digit code.';
      return;
    }

    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verifying...';

    fetch('/.netlify/functions/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, code: code })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) {
          errorEl.textContent = result.data.error || 'Incorrect code.';
          return;
        }
        if (!result.data.adminToken) {
          errorEl.textContent = 'This email is not authorized for admin access.';
          return;
        }
        sessionStorage.setItem(ADMIN_TOKEN_KEY, result.data.adminToken);
        showAdminPanel(result.data.adminToken, email);
      })
      .catch(function () { errorEl.textContent = 'Network error. Please try again.'; })
      .finally(function () {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify & Enter';
      });
  });
}

function showAdminPanel(token, email) {
  document.body.classList.remove('login-page');
  document.getElementById('admin-login-bg').style.display = 'none';
  document.getElementById('admin-login-wrap').style.display = 'none';
  document.getElementById('admin-shell').style.display = 'flex';
  document.getElementById('admin-email-display').textContent = email || 'Admin';
  initSareeEditor(token);
  initReviewsEditor(token);
  initBannersEditor(token);
  initSidebarAdsEditor(token);
  initVideosEditor(token);
  initPromoCodesEditor(token);
  initStatsDashboard(token);
  initOrdersView(token);
  initSidebarNav();

  document.getElementById('admin-logout-btn').addEventListener('click', function () {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    window.location.reload();
  });
}

/* ---------- Sidebar view switching ---------- */
function initSidebarNav() {
  var navItems = document.querySelectorAll('.admin-nav-item');
  navItems.forEach(function (item) {
    item.addEventListener('click', function () {
      var view = item.getAttribute('data-view');
      navItems.forEach(function (n) { n.classList.remove('active'); });
      item.classList.add('active');
      document.querySelectorAll('.admin-view').forEach(function (v) { v.style.display = 'none'; });
      var target = document.getElementById('admin-view-' + view);
      if (target) target.style.display = 'block';
      if (view === 'stats' && window.__refreshStats) window.__refreshStats();
    });
  });
}

/* ---------- Saree editor ---------- */
function initSareeEditor(token) {
  var rowsEl = document.getElementById('admin-product-rows');
  var formCard = document.getElementById('admin-form-card');
  var form = document.getElementById('admin-product-form');
  var seriesSelect = document.getElementById('admin-f-series');
  var idField = document.getElementById('admin-f-id');
  var idWrap = document.getElementById('admin-f-id-wrap');
  var idHint = document.getElementById('admin-id-hint');
  var idWarning = document.getElementById('admin-id-warning');
  var imagesList = document.getElementById('admin-images-list');
  var statusMsg = document.getElementById('admin-status-msg');
  var formTitle = document.getElementById('admin-form-title');
  var searchInput = document.getElementById('admin-search-input');
  var paginationEl = document.getElementById('admin-pagination');
  var editingId = null;
  var isAddMode = false;
  var PAGE_SIZE = 80;
  var currentPage = 1;
  var searchQuery = '';
  var hideSold = false;

  function seriesTitle(code) {
    return code.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  Object.keys(SERIES_CODES).forEach(function (series) {
    var opt = document.createElement('option');
    opt.value = series;
    opt.textContent = seriesTitle(series);
    seriesSelect.appendChild(opt);
  });

  function getFilteredProducts() {
    var q = searchQuery.trim().toLowerCase();
    var products = window.PRODUCTS || [];
    if (hideSold) products = products.filter(function (p) { return !p.sold; });
    if (!q) return products;
    var fields = ['id', 'design', 'type', 'sareeType', 'pattern', 'series', 'category'];
    return products.filter(function (p) {
      return fields.some(function (f) { return p[f] && String(p[f]).toLowerCase().indexOf(q) !== -1; });
    });
  }

  function renderPagination(totalItems) {
    var totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    if (totalPages <= 1) { paginationEl.innerHTML = ''; return; }

    var buttons = [];
    buttons.push('<button type="button" class="admin-page-btn" data-page="' + (currentPage - 1) + '"' + (currentPage === 1 ? ' disabled' : '') + '>&lsaquo;</button>');
    for (var i = 1; i <= totalPages; i++) {
      buttons.push('<button type="button" class="admin-page-btn' + (i === currentPage ? ' active' : '') + '" data-page="' + i + '">' + i + '</button>');
    }
    buttons.push('<button type="button" class="admin-page-btn" data-page="' + (currentPage + 1) + '"' + (currentPage === totalPages ? ' disabled' : '') + '>&rsaquo;</button>');
    paginationEl.innerHTML = buttons.join('');
  }

  function renderTable() {
    var filtered = getFilteredProducts();
    var start = (currentPage - 1) * PAGE_SIZE;
    var pageItems = filtered.slice(start, start + PAGE_SIZE);

    rowsEl.innerHTML = pageItems.map(function (p) {
      return (
        '<tr class="' + (p.sold ? 'is-sold' : '') + '">' +
          '<td><img src="' + (p.image || '') + '" alt="' + p.id + '" style="width:36px; height:46px; object-fit:cover; border-radius:3px;"></td>' +
          '<td>' + p.id + '</td>' +
          '<td>' + p.design + ' — ' + seriesTitle(p.series) + '</td>' +
          '<td>' + p.category + '</td>' +
          '<td>' + (p.sold ? '<span class="admin-sold-badge">Sold out</span>' : '<span class="admin-avail-badge">Available</span>') + '</td>' +
          '<td><span class="admin-edit-link" data-id="' + p.id + '">Edit</span> &middot; <span class="admin-delete-link" data-id="' + p.id + '">Delete</span></td>' +
        '</tr>'
      );
    }).join('');

    renderPagination(filtered.length);
  }

  searchInput.addEventListener('input', function () {
    searchQuery = searchInput.value;
    currentPage = 1;
    renderTable();
  });

  var hideSoldToggle = document.getElementById('admin-hide-sold-toggle');
  if (hideSoldToggle) {
    hideSoldToggle.addEventListener('change', function () {
      hideSold = hideSoldToggle.checked;
      currentPage = 1;
      renderTable();
    });
  }

  paginationEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.admin-page-btn');
    if (!btn || btn.disabled) return;
    var target = parseInt(btn.getAttribute('data-page'), 10);
    if (!target || target === currentPage) return;
    currentPage = target;
    renderTable();
  });

  function addImageRow(value) {
    var row = document.createElement('div');
    row.className = 'admin-image-row';
    row.innerHTML = '<input type="text" value="' + (value || '') + '" placeholder="https://..."><button type="button">Remove</button>';
    row.querySelector('button').addEventListener('click', function () { row.remove(); });
    imagesList.appendChild(row);
  }

  function checkIdDuplicate() {
    if (!isAddMode) return;
    var typed = idField.value.trim().toUpperCase();
    var exists = typed && (window.PRODUCTS || []).some(function (p) { return p.id.toUpperCase() === typed; });
    idWarning.style.display = exists ? 'block' : 'none';
    idWrap.classList.toggle('has-duplicate', !!exists);
  }

  function updateIdSuggestion() {
    var series = seriesSelect.value;
    var code = SERIES_CODES[series];
    if (!isAddMode || !code) return;
    var products = window.PRODUCTS || [];
    var highest = 0;
    products.forEach(function (p) {
      if (p.id && p.id.indexOf(code) === 0) {
        var num = parseInt(p.id.slice(2), 10);
        if (!isNaN(num) && num > highest) highest = num;
      }
    });
    var next = String(highest + 1).padStart(3, '0');
    idField.value = code + next;
    idHint.textContent = 'Suggested: ' + code + ' = ' + seriesTitle(series) + ', ' + next + ' = next free number. You can type your own ID instead if you prefer.';
    checkIdDuplicate();
  }

  seriesSelect.addEventListener('change', updateIdSuggestion);
  idField.addEventListener('input', checkIdDuplicate);

  function resetForm() {
    editingId = null;
    isAddMode = true;
    formTitle.textContent = 'Add New Saree';
    form.reset();
    idField.readOnly = false;
    idWrap.classList.remove('readonly');
    idWarning.style.display = 'none';
    idWrap.classList.remove('has-duplicate');
    imagesList.innerHTML = '';
    addImageRow('');
    seriesSelect.selectedIndex = 0;
    updateIdSuggestion();
  }

  function openFormForAdd() {
    resetForm();
    formCard.style.display = 'block';
    formCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function openFormForEdit(id) {
    var product = (window.PRODUCTS || []).find(function (p) { return p.id === id; });
    if (!product) return;
    editingId = id;
    isAddMode = false;
    formTitle.textContent = 'Edit Saree — ' + id;
    seriesSelect.value = product.series;
    idField.value = product.id;
    idField.readOnly = true;
    idWrap.classList.add('readonly');
    idWarning.style.display = 'none';
    idWrap.classList.remove('has-duplicate');
    idHint.textContent = 'Editing an existing saree — ID stays fixed.';
    document.getElementById('admin-f-category').value = product.category || 'Budget';
    document.getElementById('admin-f-type').value = product.type || '';
    document.getElementById('admin-f-sareeType').value = product.sareeType || '';
    document.getElementById('admin-f-pattern').value = product.pattern || '';
    document.getElementById('admin-f-design').value = product.design || '';
    document.getElementById('admin-f-material').value = product.material || '';
    document.getElementById('admin-f-price').value = product.price || '';
    document.getElementById('admin-f-sold').checked = !!product.sold;
    imagesList.innerHTML = '';
    (product.images && product.images.length ? product.images : ['']).forEach(function (src) { addImageRow(src); });
    formCard.style.display = 'block';
    formCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  document.getElementById('admin-add-new-btn').addEventListener('click', openFormForAdd);
  document.getElementById('admin-cancel-btn').addEventListener('click', function () { formCard.style.display = 'none'; });
  document.getElementById('admin-add-image-btn').addEventListener('click', function () { addImageRow(''); });

  /* ----- CSV download ----- */
  var CSV_COLUMNS = ['Unique ID', 'Series', 'Category', 'Type', 'Saree Type', 'Pattern', 'Design', 'Cost AED', 'Sold',
    'Image_1', 'Image_2', 'Image_3', 'Image_4', 'Image_5', 'Image_6', 'Image_7', 'Video', 'Material'];

  function csvEscape(val) {
    val = val === undefined || val === null ? '' : String(val);
    if (val.indexOf(',') !== -1 || val.indexOf('"') !== -1 || val.indexOf('\n') !== -1) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  }

  document.getElementById('admin-download-csv-btn').addEventListener('click', function () {
    var rows = [CSV_COLUMNS.join(',')];
    (window.PRODUCTS || []).forEach(function (p) {
      var images = p.images || [];
      var row = [
        p.id, p.series, p.category, p.type, p.sareeType, p.pattern, p.design, p.price,
        p.sold ? 'TRUE' : 'FALSE',
        images[0] || '', images[1] || '', images[2] || '', images[3] || '', images[4] || '', images[5] || '', images[6] || '',
        '', p.material || ''
      ].map(csvEscape);
      rows.push(row.join(','));
    });
    var blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pavnika-sarees-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  });

  /* ----- CSV bulk upload ----- */
  var csvFileInput = document.getElementById('admin-csv-file-input');
  var csvPreviewCard = document.getElementById('admin-csv-preview-card');
  var csvSummary = document.getElementById('admin-csv-summary');
  var csvPreviewList = document.getElementById('admin-csv-preview-list');
  var pendingBulkProducts = null;

  document.getElementById('admin-upload-csv-btn').addEventListener('click', function () {
    csvFileInput.click();
  });

  function parseCsv(text) {
    var lines = text.replace(/\r\n/g, '\n').split('\n').filter(function (l) { return l.trim().length; });
    if (!lines.length) return [];

    function parseLine(line) {
      var result = [];
      var cur = '';
      var inQuotes = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') { inQuotes = false; }
          else { cur += ch; }
        } else {
          if (ch === '"') inQuotes = true;
          else if (ch === ',') { result.push(cur); cur = ''; }
          else cur += ch;
        }
      }
      result.push(cur);
      return result;
    }

    var headers = parseLine(lines[0]).map(function (h) { return h.trim(); });
    return lines.slice(1).map(function (line) {
      var cells = parseLine(line);
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = (cells[i] || '').trim(); });
      return obj;
    });
  }

  function csvRowToProduct(row) {
    var images = [];
    for (var i = 1; i <= 7; i++) {
      var url = row['Image_' + i];
      if (url) images.push(url);
    }
    var soldRaw = (row['Sold'] || '').toLowerCase();
    return {
      id: (row['Unique ID'] || '').trim().toUpperCase(),
      series: row['Series'] || '',
      category: row['Category'] || '',
      type: row['Type'] || '',
      sareeType: row['Saree Type'] || '',
      pattern: row['Pattern'] || '',
      design: row['Design'] || '',
      material: row['Material'] || '',
      price: parseInt(row['Cost AED'], 10) || 0,
      sold: soldRaw === 'true' || soldRaw === '1' || soldRaw === 'yes',
      images: images,
      image: images[0] || ''
    };
  }

  csvFileInput.addEventListener('change', function () {
    var file = csvFileInput.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (e) {
      var rows;
      try {
        rows = parseCsv(e.target.result);
      } catch (err) {
        showStatus('error', 'Could not read that CSV file. Please check its format.');
        return;
      }

      if (!rows.length) {
        showStatus('error', 'That CSV file appears to be empty.');
        return;
      }

      var existingById = {};
      (window.PRODUCTS || []).forEach(function (p) { existingById[p.id.toUpperCase()] = p; });

      var newRows = [];
      var editedRows = [];
      var invalidRows = [];

      function productsEqual(a, b) {
        var fields = ['series', 'category', 'type', 'sareeType', 'pattern', 'design', 'price', 'sold'];
        for (var i = 0; i < fields.length; i++) {
          if ((a[fields[i]] || '') !== (b[fields[i]] || '')) return false;
        }
        var imgA = a.images || [];
        var imgB = b.images || [];
        if (imgA.length !== imgB.length) return false;
        for (var j = 0; j < imgA.length; j++) {
          if (imgA[j] !== imgB[j]) return false;
        }
        return true;
      }

      rows.forEach(function (row) {
        var product = csvRowToProduct(row);
        if (!product.id) { invalidRows.push(row); return; }
        var existing = existingById[product.id];
        if (existing) {
          if (!productsEqual(existing, product)) {
            editedRows.push(product);
          }
          // else: identical to what's already saved — not a real change, skip it
        } else {
          newRows.push(product);
        }
      });

      if (invalidRows.length) {
        showStatus('error', invalidRows.length + ' row(s) are missing a Unique ID and were skipped. Please fix and re-upload if needed.');
      }

      if (!newRows.length && !editedRows.length) {
        if (rows.length && !invalidRows.length) {
          showStatus('success', 'No changes detected — every row in this CSV already matches what\'s saved. Nothing to save.');
        } else {
          showStatus('error', 'No valid rows found in that CSV.');
        }
        return;
      }

      // Build the final merged list: existing products not touched by the
      // CSV stay as-is; edited ones get replaced; new ones get appended.
      var merged = (window.PRODUCTS || []).map(function (p) {
        var editMatch = editedRows.find(function (r) { return r.id === p.id.toUpperCase(); });
        return editMatch || p;
      });
      newRows.forEach(function (r) { merged.push(r); });

      pendingBulkProducts = merged;

      csvSummary.textContent = newRows.length + ' new saree(s) will be added, ' + editedRows.length + ' existing saree(s) will be edited.';
      csvPreviewList.innerHTML =
        newRows.map(function (r) { return '<div class="admin-csv-row"><span>' + r.id + ' — ' + (r.design || '') + '</span><span class="tag new">New</span></div>'; }).join('') +
        editedRows.map(function (r) { return '<div class="admin-csv-row"><span>' + r.id + ' — ' + (r.design || '') + '</span><span class="tag edit">Edit</span></div>'; }).join('');

      csvPreviewCard.style.display = 'block';
      csvPreviewCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      csvFileInput.value = '';
    };
    reader.readAsText(file);
  });

  document.getElementById('admin-csv-cancel-btn').addEventListener('click', function () {
    pendingBulkProducts = null;
    csvPreviewCard.style.display = 'none';
  });

  document.getElementById('admin-csv-confirm-btn').addEventListener('click', function () {
    if (!pendingBulkProducts) return;
    var confirmBtn = document.getElementById('admin-csv-confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Saving...';

    fetch('/.netlify/functions/admin-bulk-save-products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, products: pendingBulkProducts })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showStatus('error', result.data.error || 'Bulk save failed.'); return; }
        window.PRODUCTS = pendingBulkProducts;
        pendingBulkProducts = null;
        csvPreviewCard.style.display = 'none';
        renderTable();
        showStatus('success',
          'Saved ' + result.data.count + ' sarees — commit <code>' + result.data.commitSha + '</code> pushed to GitHub. ' +
          '<a href="' + result.data.commitUrl + '" target="_blank" rel="noopener">View the commit on GitHub &rarr;</a>'
        );
      })
      .catch(function () { showStatus('error', 'Network error — bulk changes were not saved.'); })
      .finally(function () {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm & Save to GitHub';
      });
  });

  rowsEl.addEventListener('click', function (e) {
    var editLink = e.target.closest('.admin-edit-link');
    if (editLink) {
      openFormForEdit(editLink.getAttribute('data-id'));
      return;
    }
    var deleteLink = e.target.closest('.admin-delete-link');
    if (deleteLink) {
      var id = deleteLink.getAttribute('data-id');
      if (!confirm('Delete saree ' + id + '? This commits the removal to GitHub immediately and cannot be undone from here.')) return;
      deleteSaree(id);
    }
  });

  function deleteSaree(id) {
    showStatus('success', 'Deleting ' + id + '...');
    statusMsg.className = 'admin-status-msg success';
    statusMsg.style.display = 'block';

    fetch('/.netlify/functions/admin-save-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, action: 'delete', product: { id: id } })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) {
          if (result.data && result.data.error === 'Not authorized. Please sign in again.') {
            sessionStorage.removeItem(ADMIN_TOKEN_KEY);
            alert('Your admin session expired. Please sign in again.');
            window.location.reload();
            return;
          }
          showStatus('error', result.data.error || 'Delete failed.');
          return;
        }
        showStatus('success',
          'Deleted ' + id + ' — commit <code>' + result.data.commitSha + '</code> pushed to GitHub. ' +
          '<a href="' + result.data.commitUrl + '" target="_blank" rel="noopener">View the commit on GitHub &rarr;</a>'
        );
        window.PRODUCTS = window.PRODUCTS.filter(function (p) { return p.id !== id; });
        renderTable();
      })
      .catch(function () { showStatus('error', 'Network error — saree was not deleted.'); });
  }

  function showStatus(type, html) {
    statusMsg.className = 'admin-status-msg ' + type;
    statusMsg.innerHTML = html;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var saveBtn = document.getElementById('admin-save-btn');
    var images = Array.from(imagesList.querySelectorAll('input')).map(function (i) { return i.value.trim(); }).filter(Boolean);

    if (isAddMode) {
      checkIdDuplicate();
      if (idWrap.classList.contains('has-duplicate')) {
        showStatus('error', 'That ID is already in use — please choose a different one before saving.');
        return;
      }
      if (!idField.value.trim()) {
        showStatus('error', 'Please provide an ID (or select a series to auto-generate one).');
        return;
      }
    }

    var productData = {
      series: seriesSelect.value,
      category: document.getElementById('admin-f-category').value,
      type: document.getElementById('admin-f-type').value.trim(),
      material: document.getElementById('admin-f-material').value.trim(),
      sareeType: document.getElementById('admin-f-sareeType').value.trim(),
      pattern: document.getElementById('admin-f-pattern').value.trim(),
      design: document.getElementById('admin-f-design').value.trim(),
      price: parseInt(document.getElementById('admin-f-price').value, 10) || 0,
      sold: document.getElementById('admin-f-sold').checked,
      images: images,
      image: images[0] || ''
    };

    var action;
    if (editingId) {
      action = 'edit';
      productData.id = editingId;
    } else {
      action = 'add';
      productData.id = idField.value.trim().toUpperCase();
      productData.seriesCode = SERIES_CODES[seriesSelect.value];
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    statusMsg.style.display = 'none';

    fetch('/.netlify/functions/admin-save-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, action: action, product: productData })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) {
          if (result.data && result.data.error === 'Not authorized. Please sign in again.') {
            sessionStorage.removeItem(ADMIN_TOKEN_KEY);
            alert('Your admin session expired. Please sign in again.');
            window.location.reload();
            return;
          }
          showStatus('error', result.data.error || 'Save failed.');
          return;
        }
        showStatus('success',
          'Saved — commit <code>' + result.data.commitSha + '</code> pushed to GitHub. ' +
          '<a href="' + result.data.commitUrl + '" target="_blank" rel="noopener">View the commit on GitHub &rarr;</a> ' +
          'Netlify will redeploy automatically in a minute or two.'
        );
        if (action === 'add') {
          window.PRODUCTS.push(result.data.product);
        } else {
          var idx = window.PRODUCTS.findIndex(function (p) { return p.id === result.data.product.id; });
          if (idx !== -1) window.PRODUCTS[idx] = result.data.product;
        }
        renderTable();
        formCard.style.display = 'none';
      })
      .catch(function () { showStatus('error', 'Network error — changes were not saved.'); })
      .finally(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save to GitHub';
      });
  });

  renderTable();
}

/* ---------- Reviews editor ---------- */
function initReviewsEditor(token) {
  var rowsEl = document.getElementById('admin-review-rows');
  var formCard = document.getElementById('admin-review-form-card');
  var form = document.getElementById('admin-review-form');
  var formTitle = document.getElementById('admin-review-form-title');
  var statusMsg = document.getElementById('admin-review-status-msg');
  var reviews = [];
  var editingIndex = null;

  function starString(n) {
    var count = Math.max(0, Math.min(5, parseInt(n, 10) || 0));
    var filled = '';
    for (var i = 0; i < count; i++) filled += '\u2605';
    for (var i = count; i < 5; i++) filled += '\u2606';
    return filled;
  }

  function renderTable() {
    rowsEl.innerHTML = reviews.map(function (r, i) {
      var quotePreview = r.quote ? (r.quote.length > 60 ? r.quote.slice(0, 60) + '…' : r.quote) : '<em>(star only)</em>';
      return (
        '<tr>' +
          '<td>' + (r.name || '') + '</td>' +
          '<td>' + starString(r.stars) + '</td>' +
          '<td>' + quotePreview + '</td>' +
          '<td><span class="admin-edit-link" data-idx="' + i + '">Edit</span> &middot; <span class="admin-delete-link" data-idx="' + i + '">Delete</span></td>' +
        '</tr>'
      );
    }).join('');
  }

  function loadReviews() {
    fetch('assets/reviews/reviews.json?_=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (data) {
        reviews = data || [];
        renderTable();
      })
      .catch(function () { rowsEl.innerHTML = '<tr><td colspan="4">Could not load reviews.</td></tr>'; });
  }

  function showStatus(type, html) {
    statusMsg.className = 'admin-status-msg ' + type;
    statusMsg.innerHTML = html;
    statusMsg.style.display = 'block';
  }

  function resetForm() {
    editingIndex = null;
    formTitle.textContent = 'Add New Review';
    form.reset();
    document.getElementById('admin-r-stars').value = 5;
  }

  document.getElementById('admin-add-review-btn').addEventListener('click', function () {
    resetForm();
    formCard.style.display = 'block';
    formCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.getElementById('admin-review-cancel-btn').addEventListener('click', function () {
    formCard.style.display = 'none';
  });

  rowsEl.addEventListener('click', function (e) {
    var editLink = e.target.closest('.admin-edit-link');
    if (editLink) {
      var idx = parseInt(editLink.getAttribute('data-idx'), 10);
      var r = reviews[idx];
      editingIndex = idx;
      formTitle.textContent = 'Edit Review — ' + r.name;
      document.getElementById('admin-r-name').value = r.name || '';
      document.getElementById('admin-r-stars').value = r.stars || 5;
      document.getElementById('admin-r-photo').value = r.photo || '';
      document.getElementById('admin-r-quote').value = r.quote || '';
      formCard.style.display = 'block';
      formCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    var deleteLink = e.target.closest('.admin-delete-link');
    if (deleteLink) {
      var delIdx = parseInt(deleteLink.getAttribute('data-idx'), 10);
      var name = reviews[delIdx].name || 'this review';
      if (!confirm('Delete review from ' + name + '? This commits to GitHub immediately.')) return;

      fetch('/.netlify/functions/admin-save-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminToken: token, action: 'delete', index: delIdx })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok) { showStatus('error', result.data.error || 'Delete failed.'); return; }
          reviews = result.data.reviews;
          renderTable();
          showStatus('success', 'Deleted — commit <code>' + result.data.commitSha + '</code> pushed. <a href="' + result.data.commitUrl + '" target="_blank" rel="noopener">View on GitHub &rarr;</a>');
        })
        .catch(function () { showStatus('error', 'Network error — review was not deleted.'); });
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var saveBtn = document.getElementById('admin-review-save-btn');
    var reviewData = {
      name: document.getElementById('admin-r-name').value.trim(),
      stars: parseInt(document.getElementById('admin-r-stars').value, 10) || 5,
      photo: document.getElementById('admin-r-photo').value.trim(),
      quote: document.getElementById('admin-r-quote').value.trim()
    };

    if (!reviewData.name) {
      showStatus('error', 'Reviewer name is required.');
      return;
    }

    var action = editingIndex !== null ? 'edit' : 'add';
    var payload = { adminToken: token, action: action, review: reviewData };
    if (action === 'edit') payload.index = editingIndex;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    fetch('/.netlify/functions/admin-save-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showStatus('error', result.data.error || 'Save failed.'); return; }
        reviews = result.data.reviews;
        renderTable();
        formCard.style.display = 'none';
        showStatus('success', 'Saved — commit <code>' + result.data.commitSha + '</code> pushed. <a href="' + result.data.commitUrl + '" target="_blank" rel="noopener">View on GitHub &rarr;</a>');
      })
      .catch(function () { showStatus('error', 'Network error — changes were not saved.'); })
      .finally(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save to GitHub';
      });
  });

  loadReviews();
}

/* ---------- Collections sidebar ads editor ---------- */
function initSidebarAdsEditor(token) {
  var saveBtn = document.getElementById('admin-ads-save-btn');
  if (!saveBtn) return;
  var statusMsg = document.getElementById('admin-ads-status-msg');
  var inputs = [1, 2, 3].map(function (i) { return document.getElementById('admin-ad-slot-' + i); });

  function showStatus(type, html) {
    statusMsg.className = 'admin-status-msg ' + type;
    statusMsg.innerHTML = html;
    statusMsg.style.display = 'block';
  }

  fetch('assets/ads/collections-ads.json?t=' + Date.now())
    .then(function (res) { return res.json(); })
    .then(function (list) {
      (Array.isArray(list) ? list : []).slice(0, 3).forEach(function (item, i) {
        if (inputs[i]) inputs[i].value = (item && item.file) || '';
      });
    })
    .catch(function () { /* file may not exist yet */ });

  saveBtn.addEventListener('click', function () {
    var ads = inputs
      .map(function (inp) { return inp.value.trim(); })
      .filter(Boolean)
      .map(function (f) { return { file: f }; });
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    fetch('/.netlify/functions/admin-save-collection-ads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, ads: ads })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showStatus('error', result.data.error || 'Save failed.'); return; }
        showStatus('success', 'Sidebar ads saved. Netlify will redeploy the site in a minute or two.');
      })
      .catch(function () { showStatus('error', 'Network error — ads were not saved.'); })
      .finally(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Sidebar Ads to GitHub';
      });
  });
}

/* ---------- Banners editor ---------- */
function initBannersEditor(token) {
  var listEl = document.getElementById('admin-banner-list');
  var statusMsg = document.getElementById('admin-banner-status-msg');
  var banners = [];

  function showStatus(type, html) {
    statusMsg.className = 'admin-status-msg ' + type;
    statusMsg.innerHTML = html;
    statusMsg.style.display = 'block';
  }

  function renderList() {
    listEl.innerHTML = '';
    banners.forEach(function (b, i) {
      var row = document.createElement('div');
      row.className = 'admin-banner-item';
      row.innerHTML =
        '<div class="admin-banner-thumbs">' +
          '<img class="thumb-desktop" src="assets/banners/' + b.image + '" alt="desktop">' +
          (b.mobileImage
            ? '<img class="thumb-mobile" src="assets/banners/' + b.mobileImage + '" alt="mobile" title="Mobile image: ' + b.mobileImage + '">'
            : '<span class="thumb-mobile thumb-mobile-empty" title="No mobile image set">&mdash;</span>') +
        '</div>' +
        '<div class="admin-field"><label>Image file (desktop, wide)</label><input type="text" value="' + b.image + '" data-role="image"></div>' +
        '<div class="admin-field"><label>Mobile image (portrait, optional)</label><input type="text" value="' + (b.mobileImage || '') + '" data-role="mobileImage" placeholder="Empty = reuse desktop image"></div>' +
        '<div class="admin-field"><label>Link</label><input type="text" value="' + (b.link || '') + '" data-role="link"></div>' +
        '<div class="admin-field admin-field-check"><label style="display:flex; align-items:center; gap:8px; cursor:pointer;">' +
          '<input type="checkbox" data-role="hideText"' + (b.hideText ? ' checked' : '') + ' style="width:auto;"> Hide text &amp; buttons (full image clickable)</label></div>' +
        '<div class="admin-banner-controls">' +
          '<button type="button" data-action="up" title="Move up">&uarr;</button>' +
          '<button type="button" data-action="down" title="Move down">&darr;</button>' +
          '<button type="button" data-action="remove" class="admin-banner-remove" title="Remove">&times;</button>' +
        '</div>';
      listEl.appendChild(row);
    });
  }

  function readListFromDom() {
    var rows = listEl.querySelectorAll('.admin-banner-item');
    banners = Array.from(rows).map(function (row) {
      return {
        image: row.querySelector('[data-role="image"]').value.trim(),
        mobileImage: row.querySelector('[data-role="mobileImage"]').value.trim(),
        link: row.querySelector('[data-role="link"]').value.trim() || 'collections.html',
        hideText: row.querySelector('[data-role="hideText"]').checked
      };
    });
  }

  function loadBanners() {
    fetch('assets/banners/banners.json?_=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (data) {
        banners = data || [];
        renderList();
      })
      .catch(function () { listEl.innerHTML = '<p>Could not load banners.</p>'; });
  }

  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;
    readListFromDom();
    var row = btn.closest('.admin-banner-item');
    var idx = Array.from(listEl.children).indexOf(row);
    var action = btn.getAttribute('data-action');

    if (action === 'up' && idx > 0) {
      var tmp = banners[idx - 1];
      banners[idx - 1] = banners[idx];
      banners[idx] = tmp;
    } else if (action === 'down' && idx < banners.length - 1) {
      var tmp2 = banners[idx + 1];
      banners[idx + 1] = banners[idx];
      banners[idx] = tmp2;
    } else if (action === 'remove') {
      banners.splice(idx, 1);
    }
    renderList();
  });

  document.getElementById('admin-banner-refresh-btn').addEventListener('click', function () {
    loadBanners();
    showStatus('success', 'Reloaded the current banner list from GitHub.');
  });

  document.getElementById('admin-banner-save-btn').addEventListener('click', function () {
    readListFromDom();
    if (!banners.length) {
      showStatus('error', 'At least one banner is required — use Refresh to restore the list if you removed them all by mistake.');
      return;
    }

    fetch('/.netlify/functions/admin-save-banner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, banners: banners })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showStatus('error', result.data.error || 'Save failed.'); return; }
        showStatus('success', 'Saved — commit <code>' + result.data.commitSha + '</code> pushed. <a href="' + result.data.commitUrl + '" target="_blank" rel="noopener">View on GitHub &rarr;</a>');
      })
      .catch(function () { showStatus('error', 'Network error — changes were not saved.'); });
  });

  loadBanners();
}

/* ---------- Stats dashboard ---------- */
function initStatsDashboard(token) {
  var statusMsg = document.getElementById('admin-stats-status-msg');
  var metricGrid = document.getElementById('admin-metric-grid');
  var mostViewedRows = document.getElementById('admin-most-viewed-rows');
  var regionsRows = document.getElementById('admin-regions-rows');
  var loginsRows = document.getElementById('admin-logins-rows');
  var latestStats = null;

  function showStatus(type, html) {
    statusMsg.className = 'admin-status-msg ' + type;
    statusMsg.innerHTML = html;
    statusMsg.style.display = 'block';
  }

  function findProductLabel(id) {
    var p = (window.PRODUCTS || []).find(function (x) { return x.id === id; });
    return p ? (p.design + ' — ' + id) : id;
  }

  function maskEmail(email) {
    if (!email) return '';
    var parts = email.split('@');
    if (parts.length !== 2) return email;
    var name = parts[0];
    var masked = name.length > 2 ? name[0] + '****' + name.slice(-1) : name;
    return masked + '@' + parts[1];
  }

  function timeAgo(iso) {
    if (!iso) return '';
    var diffMs = Date.now() - new Date(iso).getTime();
    var mins = Math.floor(diffMs / 60000);
    if (mins < 60) return mins + ' min ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + ' hour' + (hours === 1 ? '' : 's') + ' ago';
    var days = Math.floor(hours / 24);
    return days + ' day' + (days === 1 ? '' : 's') + ' ago';
  }

  function renderStats(data) {
    latestStats = data;
    var inStock = (window.PRODUCTS || []).filter(function (p) { return !p.sold; }).length;
    var soldOut = (window.PRODUCTS || []).filter(function (p) { return p.sold; }).length;

    if (data.filtered) {
      showStatus('success', 'Showing results for the selected date range.');
    } else {
      statusMsg.style.display = 'none';
    }

    metricGrid.innerHTML =
      '<div class="admin-metric-card"><p class="label">In stock</p><p class="value">' + inStock + '</p></div>' +
      '<div class="admin-metric-card accent-red"><p class="label">Sold out</p><p class="value">' + soldOut + '</p></div>' +
      '<div class="admin-metric-card accent-gold"><p class="label">Verified visitors</p><p class="value">' + data.totalVisitors + '</p></div>' +
      '<div class="admin-metric-card accent-gold"><p class="label">Saree views logged</p><p class="value">' + data.totalViews + '</p></div>';

    // Unfiltered view: top 10 only. Filtered (date range): show all,
    // inside a scrollable box so the page doesn't grow endlessly.
    var mostViewedList = data.filtered ? data.mostViewed : data.mostViewed.slice(0, 10);
    mostViewedRows.classList.toggle('admin-scroll-list', !!data.filtered && data.mostViewed.length > 10);
    mostViewedRows.innerHTML = mostViewedList.length
      ? mostViewedList.map(function (v) {
          return '<div class="admin-rank-row"><span>' + findProductLabel(v.productId) + '</span><span class="rank-value">' + v.views + ' view' + (v.views === 1 ? '' : 's') + '</span></div>';
        }).join('')
      : '<p style="font-size:0.82rem; opacity:0.6;">No views logged yet.</p>';

    var maxRegionCount = data.regions.length ? Math.max.apply(null, data.regions.map(function (r) { return r.count; })) : 1;
    regionsRows.innerHTML = data.regions.length
      ? data.regions.map(function (r, i) {
          var pct = Math.round((r.count / maxRegionCount) * 100);
          var barColor = i === 0 ? 'var(--green)' : (i === 1 ? 'var(--gold)' : 'var(--stone)');
          return (
            '<div class="admin-bar-row">' +
              '<div class="bar-label"><span>' + r.country + '</span><span class="bar-count">' + r.count + '</span></div>' +
              '<div class="admin-bar-track"><div class="admin-bar-fill" style="width:' + pct + '%; background:' + barColor + ';"></div></div>' +
            '</div>'
          );
        }).join('')
      : '<p style="font-size:0.82rem; opacity:0.6;">No data yet.</p>';

    renderLoginsList();
  }

  function renderLoginsList() {
    if (!latestStats) return;
    var showFull = document.getElementById('admin-show-emails-toggle').checked;
    var loginsList = latestStats.filtered ? latestStats.recentLogins : latestStats.recentLogins.slice(0, 10);
    loginsRows.classList.toggle('admin-scroll-list', !!latestStats.filtered && latestStats.recentLogins.length > 10);
    loginsRows.innerHTML = loginsList.length
      ? loginsList.map(function (v) {
          var emailDisplay = showFull ? (v.email || '') : maskEmail(v.email);
          var location = v.country ? (v.region ? v.region + ', ' + v.country : v.country) : 'Unknown';
          return '<div class="admin-rank-row"><span>' + emailDisplay + '<br><span style="font-size:0.7rem; opacity:0.6;">' + location + '</span></span><span style="color:var(--ink); opacity:0.6; font-weight:400;">' + timeAgo(v.verified_at) + '</span></div>';
        }).join('')
      : '<p style="font-size:0.82rem; opacity:0.6;">No logins yet.</p>';
  }

  document.getElementById('admin-show-emails-toggle').addEventListener('change', renderLoginsList);

  function loadStats() {
    metricGrid.innerHTML = '<p style="font-size:0.85rem; opacity:0.6;">Loading stats...</p>';
    var fromDate = document.getElementById('admin-stats-from').value || null;
    var toDate = document.getElementById('admin-stats-till').value || null;
    fetch('/.netlify/functions/admin-get-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, fromDate: fromDate, toDate: toDate })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showStatus('error', result.data.error || 'Could not load stats.'); return; }
        renderStats(result.data);
      })
      .catch(function () { showStatus('error', 'Network error loading stats.'); });
  }

  document.getElementById('admin-stats-apply-btn').addEventListener('click', function () {
    var from = document.getElementById('admin-stats-from').value;
    var till = document.getElementById('admin-stats-till').value;
    if (!from && !till) {
      showStatus('error', 'Pick at least one date, or use "Reset to all-time" instead.');
      return;
    }
    loadStats();
  });

  document.getElementById('admin-stats-reset-btn').addEventListener('click', function () {
    document.getElementById('admin-stats-from').value = '';
    document.getElementById('admin-stats-till').value = '';
    loadStats();
  });

  document.getElementById('admin-track-btn').addEventListener('click', function () {
    var from = document.getElementById('admin-track-from').value;
    var to = document.getElementById('admin-track-to').value;
    if (!from || !to) {
      showStatus('error', 'Please choose both a from and to date.');
      return;
    }
    var url = 'https://github.com/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/commits/main?since=' + from + '&until=' + to;
    window.open(url, '_blank', 'noopener');
  });

  document.getElementById('admin-clear-views-btn').addEventListener('click', function () {
    var days = parseInt(document.getElementById('admin-clear-days').value, 10);
    if (!days || days < 1) {
      showStatus('error', 'Please enter a valid number of days.');
      return;
    }
    if (!confirm('Delete all view logs older than ' + days + ' days? This cannot be undone.')) return;

    fetch('/.netlify/functions/admin-clear-views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, olderThanDays: days })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showStatus('error', result.data.error || 'Could not clear old views.'); return; }
        showStatus('success', 'Cleared ' + result.data.deletedCount + ' old view log entries.');
        loadStats();
      })
      .catch(function () { showStatus('error', 'Network error clearing old views.'); });
  });

  document.getElementById('admin-export-stats-btn').addEventListener('click', function () {
    if (!latestStats) { showStatus('error', 'Stats have not loaded yet.'); return; }
    var inStock = (window.PRODUCTS || []).filter(function (p) { return !p.sold; }).length;
    var soldOut = (window.PRODUCTS || []).filter(function (p) { return p.sold; }).length;

    var lines = [];
    lines.push('Pavnika by Saranya — Stats Export');
    lines.push('Generated: ' + new Date().toString());
    lines.push('');
    lines.push('In stock: ' + inStock);
    lines.push('Sold out: ' + soldOut);
    lines.push('Verified visitors: ' + latestStats.totalVisitors);
    lines.push('Saree views logged: ' + latestStats.totalViews);
    lines.push('');
    lines.push('Most viewed sarees:');
    latestStats.mostViewed.forEach(function (v) { lines.push('  ' + findProductLabel(v.productId) + ' — ' + v.views + ' views'); });
    lines.push('');
    lines.push('Visitor regions:');
    latestStats.regions.forEach(function (r) { lines.push('  ' + r.country + ' — ' + r.count); });
    lines.push('');
    lines.push('Recent logins:');
    latestStats.recentLogins.forEach(function (v) { lines.push('  ' + maskEmail(v.email) + ' — ' + (v.verified_at || '')); });

    var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pavnika-stats-' + new Date().toISOString().slice(0, 10) + '.txt';
    a.click();
  });

  window.__refreshStats = loadStats;
  loadStats();
}

/* ---------- Home page videos editor ---------- */
function initVideosEditor(token) {
  var listEl = document.getElementById('admin-video-list');
  var statusMsg = document.getElementById('admin-video-status-msg');
  var slots = [
    { file: '', link: '' }, { file: '', link: '' },
    { file: '', link: '' }, { file: '', link: '' }
  ];

  function normalizeSlot(s) {
    if (typeof s === 'string') return { file: s, link: '' };
    if (s && typeof s === 'object') return { file: s.file || '', link: s.link || '' };
    return { file: '', link: '' };
  }

  function showStatus(type, html) {
    statusMsg.className = 'admin-status-msg ' + type;
    statusMsg.innerHTML = html;
    statusMsg.style.display = 'block';
  }

  function renderList() {
    listEl.innerHTML = slots.map(function (slot, i) {
      return (
        '<div class="admin-video-item">' +
          '<div class="video-thumb">' + (slot.file ? '&#9654;' : '&#9711;') + '</div>' +
          '<div class="video-info">' +
            '<strong>Slot ' + (i + 1) + (i === 0 ? ' (currently the main brand video)' : '') + '</strong><br>' +
            '<input type="text" class="admin-video-slot-input" data-field="file" data-index="' + i + '" value="' + slot.file + '" placeholder="Empty — shows Pavnika mark + text"><br>' +
            '<input type="text" class="admin-video-slot-input" data-field="link" data-index="' + i + '" value="' + slot.link + '" placeholder="Click-through link (optional) — e.g. collections.html or https://..." style="margin-top:6px;">' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function loadVideos() {
    fetch('assets/videos/home-video-slots.json?_=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (data) {
        slots = (Array.isArray(data) ? data.slice(0, 4) : []).map(normalizeSlot);
        while (slots.length < 4) slots.push({ file: '', link: '' });
        renderList();
      })
      .catch(function () { listEl.innerHTML = '<p>Could not load video slots.</p>'; });
  }

  listEl.addEventListener('input', function (e) {
    var input = e.target.closest('.admin-video-slot-input');
    if (!input) return;
    var idx = parseInt(input.getAttribute('data-index'), 10);
    var field = input.getAttribute('data-field') || 'file';
    slots[idx][field] = input.value.trim();
  });

  document.getElementById('admin-video-refresh-btn').addEventListener('click', function () {
    loadVideos();
    showStatus('success', 'Reloaded the current video slots from GitHub.');
  });

  document.getElementById('admin-video-save-btn').addEventListener('click', function () {
    fetch('/.netlify/functions/admin-save-videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, videos: slots })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showStatus('error', result.data.error || 'Save failed.'); return; }
        showStatus('success', 'Saved — commit <code>' + result.data.commitSha + '</code> pushed. <a href="' + result.data.commitUrl + '" target="_blank" rel="noopener">View on GitHub &rarr;</a>');
      })
      .catch(function () { showStatus('error', 'Network error — changes were not saved.'); });
  });

  loadVideos();
}

/* ---------- Promo codes editor ---------- */
function initPromoCodesEditor(token) {
  var statusMsg = document.getElementById('admin-promo-status-msg');
  var activeList = document.getElementById('admin-promo-active-list');
  var historyRows = document.getElementById('admin-promo-history-rows');
  var countdownInterval = null;

  function showStatus(type, html) {
    statusMsg.className = 'admin-status-msg ' + type;
    statusMsg.innerHTML = html;
    statusMsg.style.display = 'block';
  }

  function formatCountdown(expiresAt) {
    var msLeft = new Date(expiresAt).getTime() - Date.now();
    if (msLeft <= 0) return 'expired';
    var mins = Math.floor(msLeft / 60000);
    var secs = Math.floor((msLeft % 60000) / 1000);
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
  }

  var clearBtn = document.getElementById('admin-promo-clear-history-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      if (!confirm('Clear promo history? This permanently deletes USED and EXPIRED codes only \u2014 any still-active code is kept and remains usable.')) return;
      clearBtn.textContent = 'Clearing...';
      fetch('/.netlify/functions/admin-clear-promo-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminToken: token })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          clearBtn.textContent = 'Clear history';
          if (!result.ok) { showStatus('error', result.data.error || 'Could not clear history.'); return; }
          showStatus('success', 'Removed ' + result.data.deleted + ' used/expired code' + (result.data.deleted === 1 ? '' : 's') + ' from history.');
          loadPromos();
        })
        .catch(function () { clearBtn.textContent = 'Clear history'; showStatus('error', 'Network error \u2014 history was not cleared.'); });
    });
  }

  function renderPromos(data) {
    if (countdownInterval) clearInterval(countdownInterval);

    if (!data.active.length) {
      activeList.innerHTML = '<p style="font-size:0.85rem; opacity:0.6;">No active codes right now.</p>';
    } else {
      activeList.innerHTML = data.active.map(function (p) {
        return (
          '<div class="admin-promo-item" data-code="' + p.code + '" data-expires="' + p.expires_at + '">' +
            '<div>' +
              '<p class="code">' + p.code + '</p>' +
              '<p class="meta">' + p.discount_percent + '% off &middot; expires in <span class="countdown">' + formatCountdown(p.expires_at) + '</span></p>' +
            '</div>' +
            '<div style="display:flex; align-items:center; gap:14px;">' +
              '<span class="copy-link" data-code="' + p.code + '">Copy</span>' +
              '<span class="deactivate-link" data-code="' + p.code + '">Deactivate</span>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      countdownInterval = setInterval(function () {
        document.querySelectorAll('.admin-promo-item').forEach(function (item) {
          var expires = item.getAttribute('data-expires');
          var countdownEl = item.querySelector('.countdown');
          if (!countdownEl) return;
          var text = formatCountdown(expires);
          countdownEl.textContent = text;
          if (text === 'expired') loadPromos();
        });
      }, 1000);
    }

    historyRows.innerHTML = data.history.length
      ? data.history.map(function (p) {
          var status = p.used ? 'Used' : (!p.active ? 'Deactivated' : 'Expired');
          return '<tr><td style="font-family:monospace;">' + p.code + '</td><td>' + p.discount_percent + '%</td><td>' + status + '</td></tr>';
        }).join('')
      : '<tr><td colspan="3">No history yet.</td></tr>';
  }

  function loadPromos() {
    fetch('/.netlify/functions/admin-get-promos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showStatus('error', result.data.error || 'Could not load promo codes.'); return; }
        renderPromos(result.data);
      })
      .catch(function () { showStatus('error', 'Network error loading promo codes.'); });
  }

  document.getElementById('admin-promo-create-btn').addEventListener('click', function () {
    var discount = parseInt(document.getElementById('admin-promo-discount').value, 10);
    if (!discount || discount < 1 || discount > 90) {
      showStatus('error', 'Please enter a discount between 1 and 90.');
      return;
    }

    fetch('/.netlify/functions/admin-create-promo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, discountPercent: discount })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showStatus('error', result.data.error || 'Could not create code.'); return; }
        showStatus('success', 'Created code <code>' + result.data.promo.code + '</code> — share this with the customer now, it expires in 10 minutes.');
        loadPromos();
      })
      .catch(function () { showStatus('error', 'Network error creating code.'); });
  });

  activeList.addEventListener('click', function (e) {
    var copyLink = e.target.closest('.copy-link');
    if (copyLink) {
      var code = copyLink.getAttribute('data-code');
      navigator.clipboard.writeText(code).then(function () {
        var original = copyLink.textContent;
        copyLink.textContent = 'Copied!';
        setTimeout(function () { copyLink.textContent = original; }, 1200);
      }).catch(function () {
        showStatus('error', 'Could not copy — please select and copy the code manually.');
      });
      return;
    }

    var link = e.target.closest('.deactivate-link');
    if (!link) return;
    var code = link.getAttribute('data-code');
    if (!confirm('Deactivate ' + code + '? It will no longer be usable.')) return;

    fetch('/.netlify/functions/admin-deactivate-promo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, code: code })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showStatus('error', result.data.error || 'Could not deactivate code.'); return; }
        showStatus('success', 'Deactivated ' + code + '.');
        loadPromos();
      })
      .catch(function () { showStatus('error', 'Network error deactivating code.'); });
  });

  loadPromos();
}

/* ---------- Orders view ---------- */
function initOrdersView(token) {
  var statusMsg = document.getElementById('admin-orders-status-msg');
  var summaryEl = document.getElementById('admin-orders-summary');
  var pendingListEl = document.getElementById('admin-pending-list');
  var rowsEl = document.getElementById('admin-orders-rows');
  var statusFilter = document.getElementById('admin-orders-status-filter');
  var searchInput = document.getElementById('admin-orders-search');

  var allOrders = [];
  var sortKey = 'created_at';
  var sortDir = 'desc';

  function showStatus(type, html) {
    statusMsg.className = 'admin-status-msg ' + type;
    statusMsg.innerHTML = html;
    statusMsg.style.display = 'block';
  }

  function elapsedText(iso) {
    var diffMs = Date.now() - new Date(iso).getTime();
    var mins = Math.floor(diffMs / 60000);
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ' + (mins % 60) + 'm ago';
    var days = Math.floor(hours / 24);
    return days + 'd ' + (hours % 24) + 'h ago';
  }

  function statusLabel(s) {
    return (s || 'pending').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function renderSummary() {
    var pendingDispatch = allOrders.filter(function (o) { return o.status === 'paid'; });
    var totalOrders = allOrders.length;
    var totalRevenue = allOrders.filter(function (o) { return o.status !== 'cancelled' && o.status !== 'payment_error'; })
      .reduce(function (sum, o) { return sum + (Number(o.total) || 0); }, 0);

    summaryEl.innerHTML =
      '<div class="admin-metric-card"><p class="label">Total orders</p><p class="value">' + totalOrders + '</p></div>' +
      '<div class="admin-metric-card accent-gold"><p class="label">Pending dispatch</p><p class="value">' + pendingDispatch.length + '</p></div>' +
      '<div class="admin-metric-card"><p class="label">Total revenue (AED)</p><p class="value">' + Math.round(totalRevenue).toLocaleString() + '</p></div>';

    if (pendingDispatch.length) {
      pendingListEl.innerHTML =
        '<h3 class="admin-stats-subheading">Awaiting dispatch</h3>' +
        pendingDispatch.map(function (o) {
          return '<div class="admin-pending-card"><span>Order #' + (o.order_number || o.id) + ' — ' + (o.customer_name || 'Unknown') + '</span><span class="elapsed">' + elapsedText(o.created_at) + '</span></div>';
        }).join('');
    } else {
      pendingListEl.innerHTML = '';
    }
  }

  function getFilteredSorted() {
    var statusVal = statusFilter.value;
    var query = searchInput.value.trim().toLowerCase();

    var filtered = allOrders.filter(function (o) {
      var okStatus = !statusVal || (o.status || 'pending') === statusVal;
      var okSearch = !query ||
        (o.order_number || '').toLowerCase().indexOf(query) !== -1 ||
        (o.customer_name || '').toLowerCase().indexOf(query) !== -1 ||
        (o.customer_email || '').toLowerCase().indexOf(query) !== -1;
      return okStatus && okSearch;
    });

    filtered.sort(function (a, b) {
      var av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'total') { av = Number(av) || 0; bv = Number(bv) || 0; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }

  function renderTable() {
    var filtered = getFilteredSorted();
    rowsEl.innerHTML = filtered.length ? filtered.map(function (o) {
      var items = [];
      try { items = JSON.parse(o.items || '[]'); } catch (e) {}
      var itemsSummary = items.map(function (it) { return it.id; }).join(', ');

      return (
        '<tr>' +
          '<td>' + (o.order_number || '—') + '</td>' +
          '<td>' + new Date(o.created_at).toLocaleString() + '</td>' +
          '<td>' + (o.customer_name || '—') + '<br><span style="opacity:0.6; font-size:0.72rem;">' + (o.customer_email || '') + '</span></td>' +
          '<td style="font-size:0.76rem;">' + itemsSummary + '</td>' +
          '<td>AED ' + Number(o.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }) + '</td>' +
          '<td>' + buildStatusSelect(o) + '</td>' +
        '</tr>'
      );
    }).join('') : '<tr><td colspan="6">No orders match.</td></tr>';
  }

  function buildStatusSelect(o) {
    var statuses = ['pending', 'paid', 'shipped', 'delivered', 'payment_error', 'cancelled', 'refunded'];
    var options = statuses.map(function (s) {
      return '<option value="' + s + '"' + (o.status === s ? ' selected' : '') + '>' + statusLabel(s) + '</option>';
    }).join('');
    return '<select class="admin-order-status-select" data-id="' + o.id + '">' + options + '</select>';
  }

  rowsEl.addEventListener('change', function (e) {
    var select = e.target.closest('.admin-order-status-select');
    if (!select) return;
    var orderId = select.getAttribute('data-id');
    var newStatus = select.value;

    fetch('/.netlify/functions/admin-update-order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, orderId: orderId, status: newStatus })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showStatus('error', result.data.error || 'Could not update status.'); return; }
        var order = allOrders.find(function (o) { return String(o.id) === String(orderId); });
        if (order) order.status = newStatus;
        showStatus('success', 'Order #' + (order ? order.order_number : orderId) + ' updated to ' + statusLabel(newStatus) + '.');
        renderSummary();
      })
      .catch(function () { showStatus('error', 'Network error — status was not updated.'); });
  });

  document.querySelectorAll('.admin-sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDir = 'desc';
      }
      renderTable();
    });
  });

  statusFilter.addEventListener('change', renderTable);
  searchInput.addEventListener('input', renderTable);

  function loadOrders() {
    fetch('/.netlify/functions/admin-get-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showStatus('error', result.data.error || 'Could not load orders.'); return; }
        allOrders = result.data.orders || [];
        renderSummary();
        renderTable();
      })
      .catch(function () { showStatus('error', 'Network error loading orders.'); });
  }

  loadOrders();
}
