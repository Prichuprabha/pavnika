// pos-script.js — Pavnika POS. Runs standalone, entirely separate
// from the customer-facing site's script.js (no cart/wishlist/gate
// overlay system here — this is a distinct staff-only tool).

var POS_TOKEN_KEY = 'pavnika_pos_token';
var POS_NAME_KEY = 'pavnika_pos_display_name';

var posState = {
  cart: [],           // [{ id, name, price, qty, image }]
  selectedCustomer: null, // set once picked from the list, or created via Proceed to Billing
  currentQty: 1,
  currentLookupItem: null,
  billNumber: null,     // fetched once per transaction, not re-fetched on revisiting the step
  discountType: 'percent', // 'percent' or 'amount'
  discountValue: 0,
  loyaltyRedeemed: 0     // points being redeemed this sale
};

// Placeholder conversion rate — the real loyalty program rules are
// still to be decided; this just makes the redeem button show
// something sensible until that's defined.
var LOYALTY_POINT_VALUE_AED = 0.10;

// ---------- Login ----------

function getPosToken() {
  return localStorage.getItem(POS_TOKEN_KEY);
}

function posLogout() {
  localStorage.removeItem(POS_TOKEN_KEY);
  localStorage.removeItem(POS_NAME_KEY);
  window.location.reload();
}

function showPosApp(displayName) {
  document.getElementById('pos-login-screen').style.display = 'none';
  document.getElementById('pos-app').style.display = 'flex';
  document.querySelector('.pos-brand').textContent = 'Pavnika POS \u2014 ' + displayName;
}

function attemptLogin() {
  var username = document.getElementById('pos-login-username').value.trim();
  var password = document.getElementById('pos-login-password').value;
  var errorEl = document.getElementById('pos-login-error');
  errorEl.textContent = '';

  if (!username || !password) {
    errorEl.textContent = 'Please enter both username and password.';
    return;
  }

  var btn = document.getElementById('pos-login-btn');
  btn.disabled = true;
  btn.textContent = 'Signing in...';

  fetch('/.netlify/functions/pos-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username, password: password })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      btn.disabled = false;
      btn.textContent = 'Sign In';
      if (!result.ok) {
        errorEl.textContent = result.data.error || 'Invalid username or password.';
        return;
      }
      localStorage.setItem(POS_TOKEN_KEY, result.data.token);
      localStorage.setItem(POS_NAME_KEY, result.data.displayName);
      showPosApp(result.data.displayName);
    })
    .catch(function (e) {
      btn.disabled = false;
      btn.textContent = 'Sign In';
      errorEl.textContent = 'Could not reach the server. Please check your connection and try again.';
      console.error('pos login error:', e);
    });
}

// ---------- Datetime ----------

function updatePosDatetime() {
  var now = new Date();
  var timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  var dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  document.getElementById('pos-datetime').textContent = timeStr + ' \u00b7 ' + dateStr;
}

// ---------- Step navigation + validation ----------
// A step can't be reached (by clicking the sidebar or the step
// tracker directly) until the previous one's requirements are met —
// only completing "Proceed" buttons should normally advance, but
// direct clicks need the same gate, or someone could skip straight to
// Payment with an empty cart.

function canAccessStep(n) {
  if (n <= 1) return true;
  if (n === 2) return posState.cart.length > 0;
  if (n >= 3) return posState.cart.length > 0 && !!posState.selectedCustomer;
  return true;
}

function showStep(n) {
  if (!canAccessStep(n)) {
    if (n === 2) alert('Add at least one item to the cart first.');
    else alert('Complete the Customer step (name and mobile number) first.');
    return;
  }
  document.querySelectorAll('.step-content').forEach(function (el) { el.style.display = 'none'; });
  document.getElementById('step-' + n).style.display = 'grid';
  document.querySelectorAll('.nav-link[data-step]').forEach(function (el) {
    el.classList.toggle('active', el.getAttribute('data-step') === String(n));
  });
  document.querySelectorAll('.step-item').forEach(function (el) {
    var s = parseInt(el.getAttribute('data-s'), 10);
    el.classList.remove('active', 'done');
    var circle = el.querySelector('.circle');
    if (s === n) { el.classList.add('active'); circle.textContent = s; }
    else if (s < n) { el.classList.add('done'); circle.innerHTML = '&#10003;'; }
    else { circle.textContent = s; }
  });
  document.querySelectorAll('.step-line').forEach(function (el) {
    var idx = parseInt(el.getAttribute('data-line'), 10);
    el.classList.toggle('done', idx < n);
  });
  if (n === 3) renderBillingStep();
  refreshStepLocks();
}

function refreshStepLocks() {
  document.querySelectorAll('.nav-link[data-step]').forEach(function (el) {
    var n = parseInt(el.getAttribute('data-step'), 10);
    el.classList.toggle('locked', !canAccessStep(n));
  });
  document.querySelectorAll('.step-item').forEach(function (el) {
    var n = parseInt(el.getAttribute('data-s'), 10);
    el.classList.toggle('locked', !canAccessStep(n));
  });
}

// ---------- Item lookup + live search (Step 1) ----------

function formatAED(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function itemDisplayName(item) {
  return (item.series ? item.series + ' \u2014 ' : '') + (item.type || item.material || '');
}

function populateItemFields(match) {
  posState.currentLookupItem = match;
  document.getElementById('pos-item-name').value = itemDisplayName(match);
  document.getElementById('pos-item-category').value = match.category || '\u2014';
  document.getElementById('pos-item-material').value = match.material || '\u2014';
  document.getElementById('pos-item-colour').value = match.shade || '\u2014';
  document.getElementById('pos-item-design').value = match.design || match.pattern || '\u2014';
  document.getElementById('pos-item-price').value = formatAED(match.price);
  document.getElementById('pos-item-stock').value = match.sold ? 'Already Sold' : 'Available';

  var imgEl = document.getElementById('pos-item-image');
  var noImgEl = document.getElementById('pos-item-noimg');
  if (match.image) {
    imgEl.src = match.image;
    imgEl.style.display = 'block';
    noImgEl.style.display = 'none';
  } else {
    imgEl.style.display = 'none';
    noImgEl.style.display = 'flex';
  }

  posState.currentQty = 1;
  document.getElementById('pos-qty-num').textContent = '1';
  document.getElementById('pos-add-to-cart-btn').disabled = false;

  var errorEl = document.getElementById('pos-item-error');
  errorEl.textContent = match.sold ? 'Warning: this item is already marked sold. Double-check before adding.' : '';
}

function lookupItem() {
  var code = document.getElementById('pos-item-code').value.trim().toUpperCase();
  var errorEl = document.getElementById('pos-item-error');
  errorEl.textContent = '';
  hideSuggestions();
  if (!code) return;

  var products = window.PRODUCTS || [];
  var match = products.filter(function (p) { return p.id.toUpperCase() === code; })[0];

  if (!match) {
    errorEl.textContent = 'No item found with code "' + code + '".';
    posState.currentLookupItem = null;
    document.getElementById('pos-add-to-cart-btn').disabled = true;
    return;
  }
  populateItemFields(match);
}

function hideSuggestions() {
  var list = document.getElementById('pos-suggest-list');
  list.classList.remove('open');
  list.innerHTML = '';
}

function showSuggestions(query) {
  var list = document.getElementById('pos-suggest-list');
  if (!query) { hideSuggestions(); return; }

  var q = query.toUpperCase();
  var products = window.PRODUCTS || [];
  var matches = products.filter(function (p) {
    return p.id.toUpperCase().indexOf(q) !== -1 ||
      (p.type && p.type.toUpperCase().indexOf(q) !== -1) ||
      (p.series && p.series.toUpperCase().indexOf(q) !== -1) ||
      (p.material && p.material.toUpperCase().indexOf(q) !== -1);
  }).slice(0, 8);

  if (!matches.length) { hideSuggestions(); return; }

  list.innerHTML = matches.map(function (m) {
    var imgTag = m.image ? '<img src="' + m.image + '">' : '<div style="width:36px;height:46px;border-radius:5px;background:var(--ivory-deep);flex-shrink:0;"></div>';
    return '<div class="pos-suggest-item' + (m.sold ? ' si-sold' : '') + '" data-id="' + m.id + '">' + imgTag +
      '<div class="si-info"><div class="si-name">' + m.id + ' \u2014 ' + itemDisplayName(m) + '</div>' +
      '<div class="si-sub">AED ' + formatAED(m.price) + (m.sold ? ' \u2014 Sold' : '') + '</div></div></div>';
  }).join('');
  list.classList.add('open');

  list.querySelectorAll('[data-id]').forEach(function (el) {
    el.addEventListener('click', function () {
      var id = el.getAttribute('data-id');
      var match = products.filter(function (p) { return p.id === id; })[0];
      document.getElementById('pos-item-code').value = id;
      hideSuggestions();
      if (match) populateItemFields(match);
    });
  });
}

function changeQty(delta) {
  posState.currentQty = Math.max(1, posState.currentQty + delta);
  document.getElementById('pos-qty-num').textContent = String(posState.currentQty);
}

function addToCart() {
  var item = posState.currentLookupItem;
  if (!item) return;

  var existing = posState.cart.filter(function (c) { return c.id === item.id; })[0];
  if (existing) {
    existing.qty += posState.currentQty;
    existing.dupeWarning = true; // added as a separate action a second time — likely an accidental re-scan
  } else {
    posState.cart.push({ id: item.id, name: itemDisplayName(item), price: item.price, qty: posState.currentQty, image: item.image || '', dupeWarning: false });
  }
  renderCart();
  refreshStepLocks();

  document.getElementById('pos-item-code').value = '';
  document.getElementById('pos-item-name').value = '';
  document.getElementById('pos-item-category').value = '';
  document.getElementById('pos-item-material').value = '';
  document.getElementById('pos-item-colour').value = '';
  document.getElementById('pos-item-design').value = '';
  document.getElementById('pos-item-price').value = '';
  document.getElementById('pos-item-stock').value = '';
  document.getElementById('pos-item-error').textContent = '';
  document.getElementById('pos-item-image').style.display = 'none';
  document.getElementById('pos-item-noimg').style.display = 'flex';
  document.getElementById('pos-add-to-cart-btn').disabled = true;
  posState.currentLookupItem = null;
  posState.currentQty = 1;
  document.getElementById('pos-qty-num').textContent = '1';
  document.getElementById('pos-item-code').focus();
}

function removeFromCart(id) {
  posState.cart = posState.cart.filter(function (c) { return c.id !== id; });
  renderCart();
  refreshStepLocks();
}

function cartTotal() {
  return posState.cart.reduce(function (sum, c) { return sum + c.price * c.qty; }, 0);
}

function cartItemCount() {
  return posState.cart.reduce(function (sum, c) { return sum + c.qty; }, 0);
}

function renderCart() {
  var listEl = document.getElementById('pos-cart-list');
  if (!posState.cart.length) {
    listEl.innerHTML = '<p class="pos-empty-note">No items added yet.</p>';
  } else {
    listEl.innerHTML = posState.cart.map(function (c) {
      var imgTag = c.image ? '<img src="' + c.image + '">' : '<div style="width:42px;height:54px;border-radius:6px;background:var(--ivory-deep);flex-shrink:0;"></div>';
      var dupeClass = c.dupeWarning ? ' pos-dupe-warning' : '';
      var dupeNote = c.dupeWarning ? '<div class="ci-sub" style="color:#B8142A;">Added twice separately \u2014 check this is intended</div>' : '';
      return '<div class="pos-cart-item' + dupeClass + '">' + imgTag +
        '<div class="ci-info"><div class="ci-name">' + c.id + ' \u2014 ' + c.name + '</div>' +
        '<div class="ci-sub">Qty ' + c.qty + ' &times; AED ' + formatAED(c.price) + '</div>' + dupeNote + '</div>' +
        '<div class="ci-total">' + formatAED(c.price * c.qty) + '</div>' +
        '<button class="del-btn" data-remove="' + c.id + '">&times;</button></div>';
    }).join('');
  }
  document.getElementById('pos-cart-total').textContent = 'AED ' + formatAED(cartTotal());
  var countEl = document.getElementById('pos-cart-count');
  if (countEl) countEl.textContent = posState.cart.length ? '(' + cartItemCount() + ' item' + (cartItemCount() === 1 ? '' : 's') + ')' : '';

  listEl.querySelectorAll('[data-remove]').forEach(function (btn) {
    btn.addEventListener('click', function () { removeFromCart(btn.getAttribute('data-remove')); });
  });
}

// ---------- Customer (Step 2) ----------

var custSearchDebounce = null;

function hideCustDropdown() {
  var list = document.getElementById('pos-cust-suggest-list');
  list.classList.remove('open');
  list.innerHTML = '';
}

function searchCustomers(query) {
  var emptyNote = document.getElementById('pos-cust-empty-note');
  clearTimeout(custSearchDebounce);

  if (!query) {
    hideCustDropdown();
    emptyNote.textContent = 'Type to search existing customers.';
    emptyNote.style.display = 'block';
    return;
  }

  // Show feedback immediately rather than leaving the UI looking idle
  // while the debounce timer and network round-trip are in progress.
  hideCustDropdown();
  emptyNote.textContent = 'Searching...';
  emptyNote.style.display = 'block';

  custSearchDebounce = setTimeout(function () {
    fetch('/.netlify/functions/pos-search-customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posToken: getPosToken(), query: query })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var customers = data.customers || [];
        var list = document.getElementById('pos-cust-suggest-list');
        if (!customers.length) {
          hideCustDropdown();
          emptyNote.textContent = 'No matching customers.';
          emptyNote.style.display = 'block';
          return;
        }
        emptyNote.style.display = 'none';
        list.innerHTML = customers.map(function (c) {
          return '<div class="pos-suggest-item" data-cust-id="' + c.id + '">' +
            '<div class="si-info"><div class="si-name">' + c.name + '</div>' +
            '<div class="si-sub">' + c.phone_country_code + ' ' + c.phone + '</div></div></div>';
        }).join('');
        list.classList.add('open');
        list.querySelectorAll('[data-cust-id]').forEach(function (el) {
          el.addEventListener('click', function () {
            var picked = customers.filter(function (c) { return c.id === el.getAttribute('data-cust-id'); })[0];
            hideCustDropdown();
            document.getElementById('pos-cust-search').value = picked.name;
            selectCustomer(picked);
          });
        });
      })
      .catch(function (e) { console.error('customer search error:', e); });
  }, 150);
}

function selectCustomer(customer) {
  posState.selectedCustomer = customer;
  document.getElementById('pos-cust-name').value = customer.name;
  document.getElementById('pos-cust-code').value = customer.phone_country_code;
  document.getElementById('pos-cust-phone').value = customer.phone;
  document.getElementById('pos-cust-email').value = customer.email || '';
  document.getElementById('pos-cust-address').value = customer.address || '';
  document.querySelectorAll('#pos-cust-emirate .seg-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-v') === customer.emirate);
  });
  refreshStepLocks();
}

function clearCustomerForm() {
  posState.selectedCustomer = null;
  document.getElementById('pos-cust-search').value = '';
  document.getElementById('pos-cust-name').value = '';
  document.getElementById('pos-cust-phone').value = '';
  document.getElementById('pos-cust-email').value = '';
  document.getElementById('pos-cust-address').value = '';
  document.getElementById('pos-cust-error').textContent = '';
  document.querySelectorAll('#pos-cust-emirate .seg-btn').forEach(function (btn, i) {
    btn.classList.toggle('active', i === 0);
  });
  hideCustDropdown();
  refreshStepLocks();
}

function proceedToBilling() {
  var name = document.getElementById('pos-cust-name').value.trim();
  var phone = document.getElementById('pos-cust-phone').value.trim();
  var errorEl = document.getElementById('pos-cust-error');
  errorEl.textContent = '';

  if (!name || !phone) {
    errorEl.textContent = 'Customer name and mobile number are required.';
    return;
  }

  if (posState.selectedCustomer && posState.selectedCustomer.name === name && posState.selectedCustomer.phone === phone) {
    showStep(3);
    return;
  }

  var emirateBtn = document.querySelector('#pos-cust-emirate .seg-btn.active');
  var btn = document.getElementById('pos-proceed-billing-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  fetch('/.netlify/functions/pos-create-customer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      posToken: getPosToken(),
      name: name,
      phone: phone,
      phoneCountryCode: document.getElementById('pos-cust-code').value.trim() || '+971',
      email: document.getElementById('pos-cust-email').value.trim() || null,
      emirate: emirateBtn ? emirateBtn.getAttribute('data-v') : null,
      address: document.getElementById('pos-cust-address').value.trim() || null
    })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      btn.disabled = false;
      btn.textContent = 'Proceed to Billing \u2192';
      if (!result.ok) {
        errorEl.textContent = result.data.error || 'Could not save customer.';
        return;
      }
      posState.selectedCustomer = result.data.customer;
      refreshStepLocks();
      showStep(3);
    })
    .catch(function (e) {
      btn.disabled = false;
      btn.textContent = 'Proceed to Billing \u2192';
      errorEl.textContent = 'Could not reach the server. Please try again.';
      console.error('create customer error:', e);
    });
}

// ---------- Billing (Step 3) ----------

function calculateDiscountAmount(subtotal) {
  var raw = posState.discountType === 'percent'
    ? subtotal * (posState.discountValue / 100)
    : posState.discountValue;
  return Math.min(Math.max(0, raw), subtotal); // never more than the subtotal itself
}

function calculateLoyaltyDiscount() {
  return posState.loyaltyRedeemed * LOYALTY_POINT_VALUE_AED;
}

function recalcBillingTotals() {
  var subtotal = cartTotal();
  var discountAmount = calculateDiscountAmount(subtotal);
  var loyaltyAmount = calculateLoyaltyDiscount();
  var grandTotal = Math.max(0, subtotal - discountAmount - loyaltyAmount);

  document.getElementById('pos-bill-subtotal').textContent = 'AED ' + formatAED(subtotal);
  document.getElementById('pos-grand-total').textContent = 'AED ' + formatAED(grandTotal);
  return { subtotal: subtotal, discountAmount: discountAmount, loyaltyAmount: loyaltyAmount, grandTotal: grandTotal };
}

function renderBillItems() {
  var el = document.getElementById('pos-bill-items');
  el.innerHTML = posState.cart.map(function (c) {
    var imgTag = c.image ? '<img src="' + c.image + '">' : '<div style="width:42px;height:54px;border-radius:6px;background:var(--ivory-deep);flex-shrink:0;"></div>';
    return '<div class="pos-cart-item">' + imgTag +
      '<div class="ci-info"><div class="ci-name">' + c.id + ' \u2014 ' + c.name + '</div>' +
      '<div class="ci-sub">Qty ' + c.qty + '</div></div>' +
      '<div class="ci-total">' + formatAED(c.price * c.qty) + '</div></div>';
  }).join('');
  var countEl = document.getElementById('pos-bill-count');
  if (countEl) countEl.textContent = '(' + cartItemCount() + ' item' + (cartItemCount() === 1 ? '' : 's') + ')';
}

function renderLoyaltyBox() {
  var box = document.getElementById('pos-loyalty-box');
  var textEl = document.getElementById('pos-loyalty-text');
  var btn = document.getElementById('pos-loyalty-redeem-btn');
  var points = (posState.selectedCustomer && posState.selectedCustomer.loyalty_points) || 0;

  if (!points) { box.style.display = 'none'; return; }

  box.style.display = 'flex';
  var redeeming = posState.loyaltyRedeemed > 0;
  textEl.innerHTML = 'Loyalty: <b>' + points + ' pts</b> (\u2248 AED ' + formatAED(points * LOYALTY_POINT_VALUE_AED) + ')' +
    (redeeming ? ' \u2014 redeeming all' : '');
  btn.textContent = redeeming ? 'Cancel' : 'Redeem';
}

function toggleLoyaltyRedeem() {
  var points = (posState.selectedCustomer && posState.selectedCustomer.loyalty_points) || 0;
  posState.loyaltyRedeemed = posState.loyaltyRedeemed > 0 ? 0 : points;
  renderLoyaltyBox();
  recalcBillingTotals();
}

function fetchBillNumber() {
  var el = document.getElementById('pos-bill-number');
  fetch('/.netlify/functions/pos-peek-bill-number', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ posToken: getPosToken() })
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.billNumber) {
        posState.billNumber = data.billNumber;
        el.value = data.billNumber;
      } else {
        el.value = 'Will be assigned on completion';
      }
    })
    .catch(function () { el.value = 'Will be assigned on completion'; });
}

function renderBillingStep() {
  renderBillItems();
  document.getElementById('pos-bill-salesperson').value = localStorage.getItem(POS_NAME_KEY) || '';

  if (posState.billNumber) {
    document.getElementById('pos-bill-number').value = posState.billNumber;
  } else {
    fetchBillNumber();
  }

  renderLoyaltyBox();
  recalcBillingTotals();
}

function setDiscountValue(newValueStr) {
  if (newValueStr.length > 8) return;
  if ((newValueStr.match(/\./g) || []).length > 1) return;
  posState.discountValue = parseFloat(newValueStr) || 0;
  document.getElementById('pos-discount-value').value = newValueStr || '0';
  recalcBillingTotals();
}

function handleKeypadPress(key) {
  var current = document.getElementById('pos-discount-value').value;
  if (key === 'clear') { setDiscountValue('0'); return; }
  if (key === 'back') { setDiscountValue(current.length > 1 ? current.slice(0, -1) : '0'); return; }
  var next = (current === '0' && key !== '.') ? key : current + key;
  setDiscountValue(next);
}

// ---------- Wire everything up ----------

document.addEventListener('DOMContentLoaded', function () {
  var existingToken = getPosToken();
  var existingName = localStorage.getItem(POS_NAME_KEY);
  if (existingToken && existingName) {
    showPosApp(existingName);
  }

  document.getElementById('pos-login-btn').addEventListener('click', attemptLogin);
  document.getElementById('pos-login-password').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') attemptLogin();
  });
  document.getElementById('pos-logout-btn').addEventListener('click', posLogout);

  updatePosDatetime();
  setInterval(updatePosDatetime, 30000);

  document.querySelectorAll('.nav-link[data-step]').forEach(function (el) {
    el.addEventListener('click', function () { showStep(parseInt(el.getAttribute('data-step'), 10)); });
  });
  document.querySelectorAll('.step-item').forEach(function (el) {
    el.addEventListener('click', function () { showStep(parseInt(el.getAttribute('data-s'), 10)); });
  });

  // Item entry
  var codeInput = document.getElementById('pos-item-code');
  codeInput.addEventListener('input', function (e) { showSuggestions(e.target.value.trim()); });
  codeInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); lookupItem(); }
    if (e.key === 'Escape') hideSuggestions();
  });
  document.addEventListener('click', function (e) {
    if (!codeInput.contains(e.target) && !document.getElementById('pos-suggest-list').contains(e.target)) {
      hideSuggestions();
    }
  });
  document.getElementById('pos-item-lookup-btn').addEventListener('click', lookupItem);
  document.getElementById('pos-qty-minus').addEventListener('click', function () { changeQty(-1); });
  document.getElementById('pos-qty-plus').addEventListener('click', function () { changeQty(1); });
  document.getElementById('pos-add-to-cart-btn').addEventListener('click', addToCart);
  document.getElementById('pos-proceed-customer-btn').addEventListener('click', function () {
    if (!posState.cart.length) { alert('Add at least one item to the cart before proceeding.'); return; }
    showStep(2);
  });

  // Customer
  var custSearchInput = document.getElementById('pos-cust-search');
  custSearchInput.addEventListener('input', function (e) {
    searchCustomers(e.target.value.trim());
  });
  document.addEventListener('click', function (e) {
    if (!custSearchInput.contains(e.target) && !document.getElementById('pos-cust-suggest-list').contains(e.target)) {
      hideCustDropdown();
    }
  });
  document.getElementById('pos-new-cust-btn').addEventListener('click', clearCustomerForm);

  // Email domain quick-select — appends the tapped domain to whatever
  // was typed before any existing @, instead of requiring it be typed.
  document.querySelectorAll('.pos-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var emailEl = document.getElementById('pos-cust-email');
      var current = emailEl.value.split('@')[0];
      emailEl.value = current + '@' + chip.getAttribute('data-domain');
    });
  });
  document.querySelectorAll('#pos-cust-emirate .seg-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#pos-cust-emirate .seg-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
    });
  });
  document.getElementById('pos-proceed-billing-btn').addEventListener('click', proceedToBilling);

  // Billing
  document.querySelectorAll('.discount-toggle button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.discount-toggle button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      posState.discountType = btn.getAttribute('data-dtype');
      setDiscountValue('0'); // reset on switching, so "50" isn't misread as the wrong unit
    });
  });
  document.querySelectorAll('[data-kp]').forEach(function (btn) {
    btn.addEventListener('click', function () { handleKeypadPress(btn.getAttribute('data-kp')); });
  });
  document.getElementById('pos-loyalty-redeem-btn').addEventListener('click', toggleLoyaltyRedeem);
  document.getElementById('pos-proceed-payment-btn').addEventListener('click', function () { showStep(4); });

  renderCart();
  refreshStepLocks();
  showStep(1);
});
