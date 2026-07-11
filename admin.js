var ADMIN_TOKEN_KEY = 'pavnika_admin_token';

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
    var phone = document.getElementById('admin-gate-phone').value.trim();
    var errorEl = document.getElementById('admin-error-1');
    errorEl.textContent = '';

    if (!emailInput || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
      errorEl.textContent = 'Please enter a valid email address.';
      return;
    }
    if (!phone) {
      errorEl.textContent = 'Please enter a mobile number.';
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';

    fetch('/.netlify/functions/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailInput, phone: phone })
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

  document.getElementById('admin-logout-btn').addEventListener('click', function () {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    window.location.reload();
  });
}

/* ---------- Saree editor ---------- */
function initSareeEditor(token) {
  var rowsEl = document.getElementById('admin-product-rows');
  var formCard = document.getElementById('admin-form-card');
  var form = document.getElementById('admin-product-form');
  var seriesSelect = document.getElementById('admin-f-series');
  var idField = document.getElementById('admin-f-id');
  var idHint = document.getElementById('admin-id-hint');
  var imagesList = document.getElementById('admin-images-list');
  var statusMsg = document.getElementById('admin-status-msg');
  var formTitle = document.getElementById('admin-form-title');
  var editingId = null;

  function seriesTitle(code) {
    return code.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  Object.keys(SERIES_CODES).forEach(function (series) {
    var opt = document.createElement('option');
    opt.value = series;
    opt.textContent = seriesTitle(series);
    seriesSelect.appendChild(opt);
  });

  function renderTable() {
    var products = window.PRODUCTS || [];
    rowsEl.innerHTML = products.map(function (p) {
      return (
        '<tr class="' + (p.sold ? 'is-sold' : '') + '">' +
          '<td>' + p.id + '</td>' +
          '<td>' + p.design + ' — ' + seriesTitle(p.series) + '</td>' +
          '<td>' + p.category + '</td>' +
          '<td>' + (p.sold ? '<span class="admin-sold-badge">Sold out</span>' : '<span class="admin-avail-badge">Available</span>') + '</td>' +
          '<td><span class="admin-edit-link" data-id="' + p.id + '">Edit</span> &middot; <span class="admin-delete-link" data-id="' + p.id + '">Delete</span></td>' +
        '</tr>'
      );
    }).join('');
  }

  function addImageRow(value) {
    var row = document.createElement('div');
    row.className = 'admin-image-row';
    row.innerHTML = '<input type="text" value="' + (value || '') + '" placeholder="https://..."><button type="button">Remove</button>';
    row.querySelector('button').addEventListener('click', function () { row.remove(); });
    imagesList.appendChild(row);
  }

  function updateIdPreview() {
    var series = seriesSelect.value;
    var code = SERIES_CODES[series];
    if (editingId) return; // don't regenerate when editing an existing saree
    if (!code) {
      idField.value = '';
      idHint.textContent = '';
      return;
    }
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
    idHint.textContent = code + ' = ' + seriesTitle(series) + ', ' + next + ' = next free number in that series.';
  }

  seriesSelect.addEventListener('change', updateIdPreview);

  function resetForm() {
    editingId = null;
    formTitle.textContent = 'Add New Saree';
    form.reset();
    imagesList.innerHTML = '';
    addImageRow('');
    seriesSelect.selectedIndex = 0;
    updateIdPreview();
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
    formTitle.textContent = 'Edit Saree — ' + id;
    seriesSelect.value = product.series;
    idField.value = product.id;
    idHint.textContent = 'Editing an existing saree — ID stays fixed.';
    document.getElementById('admin-f-category').value = product.category || 'Budget';
    document.getElementById('admin-f-type').value = product.type || '';
    document.getElementById('admin-f-sareeType').value = product.sareeType || '';
    document.getElementById('admin-f-pattern').value = product.pattern || '';
    document.getElementById('admin-f-design').value = product.design || '';
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

    var productData = {
      series: seriesSelect.value,
      category: document.getElementById('admin-f-category').value,
      type: document.getElementById('admin-f-type').value.trim(),
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
