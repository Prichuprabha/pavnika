// pos-script.js — Pavnika POS. Runs standalone, entirely separate
// from the customer-facing site's script.js (no cart/wishlist/gate
// overlay system here — this is a distinct staff-only tool).

var POS_TOKEN_KEY = 'pavnika_pos_token';
var POS_NAME_KEY = 'pavnika_pos_display_name';
var POS_USERNAME_KEY = 'pavnika_pos_username';
var POS_LOGIN_TIME_KEY = 'pavnika_pos_login_time';
var POS_SAVED_STATE_KEY = 'pavnika_pos_saved_state';
var SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

var posState = {
  cart: [],           // [{ id, name, price, qty, image }]
  selectedCustomer: null, // set once picked from the list, or created via Proceed to Billing
  currentQty: 1,
  currentLookupItem: null,
  billNumber: null,     // fetched once per transaction, not re-fetched on revisiting the step
  discountType: 'percent', // 'percent' or 'amount'
  discountValue: 0,
  loyaltyRedeemed: 0,    // points being redeemed this sale
  paymentMethod: 'Cash',
  amountReceived: 0,
  printedOrSent: false,  // tracks whether Print or Send was used before Complete Sale
  transactionSalesPerson: null // set only if changed mid-transaction; falls back to the logged-in user's name
};
var currentStepNum = 1; // tracked separately so it can be saved/restored alongside posState

// Placeholder conversion rate — the real loyalty program rules are
// still to be decided; this just makes the redeem button show
// something sensible until that's defined.
var LOYALTY_POINT_VALUE_AED = 0.10;

// ---------- Transaction state persistence ----------
// Saved continuously (not just on logout) so an in-progress
// transaction survives both an accidental page refresh and an 8-hour
// session timeout. Deliberately not cleared on logout or session
// expiry — restored on the next successful login regardless of which
// staff member logs back in, matching the confirmed behavior: a shift
// change mid-sale should be able to pick up exactly where it left off.

function saveTransactionState() {
  try {
    var toSave = {
      cart: posState.cart,
      selectedCustomer: posState.selectedCustomer,
      discountType: posState.discountType,
      discountValue: posState.discountValue,
      loyaltyRedeemed: posState.loyaltyRedeemed,
      paymentMethod: posState.paymentMethod,
      transactionSalesPerson: posState.transactionSalesPerson,
      currentStepNum: currentStepNum
    };
    localStorage.setItem(POS_SAVED_STATE_KEY, JSON.stringify(toSave));
  } catch (e) { /* ignore storage errors */ }
}

function restoreTransactionState() {
  try {
    var raw = localStorage.getItem(POS_SAVED_STATE_KEY);
    if (!raw) return;
    var saved = JSON.parse(raw);
    posState.cart = saved.cart || [];
    posState.selectedCustomer = saved.selectedCustomer || null;
    posState.discountType = saved.discountType || 'percent';
    posState.discountValue = saved.discountValue || 0;
    posState.loyaltyRedeemed = saved.loyaltyRedeemed || 0;
    posState.paymentMethod = saved.paymentMethod || 'Cash';
    posState.transactionSalesPerson = saved.transactionSalesPerson || null;
    renderCart();
    refreshStepLocks();
    showStep(saved.currentStepNum || 1);
  } catch (e) { /* ignore malformed saved state */ }
}

// ---------- Login ----------

function getPosToken() {
  return localStorage.getItem(POS_TOKEN_KEY);
}

function isSessionExpired() {
  var loginTime = localStorage.getItem(POS_LOGIN_TIME_KEY);
  if (!loginTime) return true;
  return (Date.now() - parseInt(loginTime, 10)) > SESSION_DURATION_MS;
}

function posLogout() {
  localStorage.removeItem(POS_TOKEN_KEY);
  localStorage.removeItem(POS_NAME_KEY);
  localStorage.removeItem(POS_LOGIN_TIME_KEY);
  // Deliberately NOT removing POS_USERNAME_KEY or POS_SAVED_STATE_KEY —
  // both are needed to pre-fill the username and restore the
  // in-progress transaction on the next login, by design.
  window.location.reload();
}

function showPosApp(displayName) {
  document.getElementById('pos-login-screen').style.display = 'none';
  document.getElementById('pos-app').style.display = 'flex';
  document.querySelector('.pos-brand').textContent = 'Pavnika POS \u2014 ' + displayName;
  loadRecentCustomers();
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
      localStorage.setItem(POS_USERNAME_KEY, result.data.username);
      localStorage.setItem(POS_LOGIN_TIME_KEY, String(Date.now()));
      showPosApp(result.data.displayName);
      restoreTransactionState();
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
  currentStepNum = n;
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
  if (n === 4) renderPaymentStep();
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

function showBrowseView() {
  document.getElementById('pos-preview-heading').textContent = 'Browse Sarees';
  document.getElementById('pos-browse-cats').style.display = 'flex';
  document.getElementById('pos-browse-grid').style.display = 'grid';
  document.getElementById('pos-selected-preview').style.display = 'none';
}

function showSelectedView() {
  document.getElementById('pos-preview-heading').textContent = 'Preview';
  document.getElementById('pos-browse-cats').style.display = 'none';
  document.getElementById('pos-browse-grid').style.display = 'none';
  document.getElementById('pos-selected-preview').style.display = 'flex';
}

function populateItemFields(match) {
  posState.currentLookupItem = match;
  document.getElementById('pos-item-matched-code').value = match.id;
  document.getElementById('pos-item-name').value = itemDisplayName(match);
  document.getElementById('pos-item-category').value = match.category || '\u2014';
  document.getElementById('pos-item-material').value = match.material || '\u2014';
  document.getElementById('pos-item-colour').value = match.shade || '\u2014';
  document.getElementById('pos-item-design').value = match.design || match.pattern || '\u2014';
  document.getElementById('pos-item-price').value = formatAED(match.price);
  document.getElementById('pos-item-stock').value = match.sold ? 'Out of Stock' : 'Available';

  var boxEl = document.getElementById('pos-preview-box');
  if (match.image) {
    boxEl.innerHTML = '<img src="' + match.image + '" alt="">';
  } else {
    boxEl.innerHTML = '<div id="pos-item-noimg" class="pos-noimg">No image available</div>';
  }

  posState.currentQty = 1;
  document.getElementById('pos-qty-num').textContent = '1';
  document.getElementById('pos-add-to-cart-btn').disabled = false;
  showSelectedView();

  var errorEl = document.getElementById('pos-item-error');
  errorEl.textContent = match.sold ? 'Warning: this item is already marked sold. Double-check before adding.' : '';
}

function clearItemFields() {
  document.getElementById('pos-item-code').value = '';
  document.getElementById('pos-item-matched-code').value = '';
  document.getElementById('pos-item-name').value = '';
  document.getElementById('pos-item-category').value = '';
  document.getElementById('pos-item-material').value = '';
  document.getElementById('pos-item-colour').value = '';
  document.getElementById('pos-item-design').value = '';
  document.getElementById('pos-item-price').value = '';
  document.getElementById('pos-item-stock').value = '';
  document.getElementById('pos-item-error').textContent = '';
  document.getElementById('pos-preview-box').innerHTML = '<div id="pos-item-noimg" class="pos-noimg">Scan or enter a code to preview the item</div>';
  document.getElementById('pos-add-to-cart-btn').disabled = true;
  posState.currentLookupItem = null;
  posState.currentQty = 1;
  document.getElementById('pos-qty-num').textContent = '1';
  hideSuggestions();
  showBrowseView();
}

// ---------- Visual browse grid ----------

function renderBrowseCats() {
  var products = window.PRODUCTS || [];
  var cats = [];
  products.forEach(function (p) { if (p.category && cats.indexOf(p.category) === -1) cats.push(p.category); });
  cats.sort();
  var el = document.getElementById('pos-browse-cats');
  el.innerHTML = '<button type="button" class="pos-browse-cat-btn active" data-cat="All">All</button>' +
    cats.map(function (c) { return '<button type="button" class="pos-browse-cat-btn" data-cat="' + c + '">' + c + '</button>'; }).join('');
  el.querySelectorAll('.pos-browse-cat-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      el.querySelectorAll('.pos-browse-cat-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      renderBrowseGrid(btn.getAttribute('data-cat'));
    });
  });
}

function renderBrowseGrid(categoryFilter) {
  var products = window.PRODUCTS || [];
  var filtered = (!categoryFilter || categoryFilter === 'All') ? products : products.filter(function (p) { return p.category === categoryFilter; });
  var el = document.getElementById('pos-browse-grid');
  if (!filtered.length) { el.innerHTML = '<p class="pos-empty-note">No items in this category.</p>'; return; }
  el.innerHTML = filtered.map(function (p) {
    var imgTag = p.image ? '<img src="' + p.image + '">' : '<div style="height:90px;background:var(--ivory-deep);"></div>';
    return '<div class="pos-browse-tile' + (p.sold ? ' pt-sold' : '') + '" data-browse-id="' + p.id + '">' + imgTag +
      '<div class="pt-code">' + p.id + '</div><div class="pt-price">AED ' + formatAED(p.price) + (p.sold ? ' \u2014 Sold' : '') + '</div></div>';
  }).join('');
  el.querySelectorAll('[data-browse-id]').forEach(function (tile) {
    tile.addEventListener('click', function () {
      var id = tile.getAttribute('data-browse-id');
      var match = products.filter(function (p) { return p.id === id; })[0];
      if (match) populateItemFields(match);
    });
  });
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
    document.getElementById('pos-preview-box').innerHTML = '<div id="pos-item-noimg" class="pos-noimg">Scan or enter a code to preview the item</div>';
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

  clearItemFields();
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

var recentCustomersCache = [];

function loadRecentCustomers() {
  fetch('/.netlify/functions/pos-search-customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ posToken: getPosToken(), query: '' })
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      recentCustomersCache = data.customers || [];
      renderCustomerList(recentCustomersCache);
    })
    .catch(function (e) {
      console.error('load recent customers error:', e);
      document.getElementById('pos-cust-list').innerHTML = '<p class="pos-empty-note">Could not load customers.</p>';
    });
}

function renderCustomerList(customers) {
  var listEl = document.getElementById('pos-cust-list');
  if (!customers.length) {
    listEl.innerHTML = '<p class="pos-empty-note">No customers found.</p>';
    return;
  }
  listEl.innerHTML = customers.map(function (c) {
    return '<div class="cust-list-item" data-cust-id="' + c.id + '">' +
      '<span class="name">' + c.name + '</span>' +
      '<span class="phone">' + c.phone_country_code + ' ' + c.phone + '</span></div>';
  }).join('');
  listEl.querySelectorAll('[data-cust-id]').forEach(function (el) {
    el.addEventListener('click', function () {
      var picked = customers.filter(function (c) { return c.id === el.getAttribute('data-cust-id'); })[0];
      if (picked) selectCustomer(picked);
    });
  });
}

// Filters the already-fetched list client-side — no network round-trip
// per keystroke, since the whole recent-customers list is already in
// memory. This is what actually fixes the earlier "search feels slow"
// complaint properly: the remaining delay was genuinely network
// latency per request, so removing the repeated requests removes the
// delay entirely, rather than just shortening a debounce timer.
function filterCustomerList(query) {
  var q = query.trim().toLowerCase();
  if (!q) { renderCustomerList(recentCustomersCache); return; }
  var filtered = recentCustomersCache.filter(function (c) {
    return c.name.toLowerCase().indexOf(q) !== -1 || c.phone.indexOf(q) !== -1;
  });
  renderCustomerList(filtered);
}

function loadCustomerSummary(customerId) {
  var box = document.getElementById('pos-cust-summary');
  fetch('/.netlify/functions/pos-customer-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ posToken: getPosToken(), customerId: customerId })
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      document.getElementById('pos-cust-summary-purchases').textContent = data.totalPurchases;
      document.getElementById('pos-cust-summary-spent').textContent = 'AED ' + formatAED(data.totalSpent);
      document.getElementById('pos-cust-summary-visit').textContent = data.lastVisit ? new Date(data.lastVisit).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
      document.getElementById('pos-cust-summary-points').textContent = (posState.selectedCustomer && posState.selectedCustomer.loyalty_points) || 0;
      box.style.display = 'block';
    })
    .catch(function (e) { console.error('customer summary error:', e); });
}

function selectCustomer(customer) {
  posState.selectedCustomer = customer;
  document.getElementById('pos-cust-search').value = customer.name;
  document.getElementById('pos-cust-name').value = customer.name;
  document.getElementById('pos-cust-code').value = customer.phone_country_code;
  document.getElementById('pos-cust-phone').value = customer.phone;
  document.getElementById('pos-cust-email').value = customer.email || '';
  document.getElementById('pos-cust-address').value = customer.address || '';
  document.querySelectorAll('#pos-cust-emirate .seg-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-v') === customer.emirate);
  });
  loadCustomerSummary(customer.id);
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
  document.getElementById('pos-cust-summary').style.display = 'none';
  document.querySelectorAll('#pos-cust-emirate .seg-btn').forEach(function (btn, i) {
    btn.classList.toggle('active', i === 0);
  });
  renderCustomerList(recentCustomersCache);
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

  var summaryRow = document.getElementById('pos-discount-summary-row');
  if (posState.discountValue > 0) {
    summaryRow.style.display = 'flex';
    var label = posState.discountType === 'percent' ? 'Discount (' + posState.discountValue + '%)' : 'Discount';
    document.getElementById('pos-discount-summary-label').textContent = label;
    document.getElementById('pos-discount-summary-value').textContent = '\u2212 AED ' + formatAED(discountAmount);
  } else {
    summaryRow.style.display = 'none';
  }

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
        el.textContent = data.billNumber;
      } else {
        el.textContent = 'Will be assigned on completion';
      }
    })
    .catch(function () { el.textContent = 'Will be assigned on completion'; });
}

function renderBillingStep() {
  renderBillItems();
  document.getElementById('pos-bill-salesperson').textContent = posState.transactionSalesPerson || localStorage.getItem(POS_NAME_KEY) || '';

  if (posState.billNumber) {
    document.getElementById('pos-bill-number').textContent = posState.billNumber;
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

// ---------- Payment (Step 4) ----------

function renderPaymentStep() {
  if (!posState.billNumber) fetchBillNumber();
  var totals = recalcBillingTotals();
  document.getElementById('pos-pay-subtotal').textContent = 'AED ' + formatAED(totals.subtotal);
  document.getElementById('pos-pay-total').textContent = 'AED ' + formatAED(totals.grandTotal);

  var discountRow = document.getElementById('pos-pay-discount-row');
  var totalDiscount = totals.discountAmount + totals.loyaltyAmount;
  if (totalDiscount > 0) {
    discountRow.style.display = 'flex';
    document.getElementById('pos-pay-discount-value').textContent = '\u2212 AED ' + formatAED(totalDiscount);
  } else {
    discountRow.style.display = 'none';
  }

  posState.amountReceived = 0;
  document.getElementById('pos-amount-received').value = '0';
  document.getElementById('pos-pay-change').textContent = 'AED ' + formatAED(-totals.grandTotal);
  document.getElementById('pos-pay-reference').value = '';
  posState.printedOrSent = false;
  document.getElementById('pos-payment-error').textContent = '';

  var sendBtn = document.getElementById('pos-send-btn');
  var hasEmail = posState.selectedCustomer && posState.selectedCustomer.email;
  sendBtn.disabled = !hasEmail;
  sendBtn.textContent = hasEmail ? 'Send Bill (Email)' : 'Send Bill (no email on file)';
}

function recalcChange() {
  var totals = recalcBillingTotals();
  var change = posState.amountReceived - totals.grandTotal;
  document.getElementById('pos-pay-change').textContent = 'AED ' + formatAED(change);
}

function setAmountReceived(newValueStr) {
  if (newValueStr.length > 8) return;
  if ((newValueStr.match(/\./g) || []).length > 1) return;
  posState.amountReceived = parseFloat(newValueStr) || 0;
  document.getElementById('pos-amount-received').value = newValueStr || '0';
  recalcChange();
}

function handleAmountKeypad(key) {
  var current = document.getElementById('pos-amount-received').value;
  if (key === 'clear') { setAmountReceived('0'); return; }
  if (key === 'back') { setAmountReceived(current.length > 1 ? current.slice(0, -1) : '0'); return; }
  var next = (current === '0' && key !== '.') ? key : current + key;
  setAmountReceived(next);
}

function buildPrintReceiptHtml() {
  var totals = recalcBillingTotals();
  var custName = posState.selectedCustomer ? posState.selectedCustomer.name : '';
  var itemRows = posState.cart.map(function (c) {
    return '<tr><td>' + c.id + ' - ' + c.name + ' (x' + c.qty + ')</td><td style="text-align:right;">' + formatAED(c.price * c.qty) + '</td></tr>';
  }).join('');
  return '<h2>Pavnika by Saranya</h2>' +
    '<div class="pr-sub">' + (posState.billNumber || '') + '<br>' + new Date().toLocaleString() + '<br>' + custName + '</div>' +
    '<table>' + itemRows +
    '<tr><td>Subtotal</td><td style="text-align:right;">AED ' + formatAED(totals.subtotal) + '</td></tr>' +
    (totals.discountAmount + totals.loyaltyAmount > 0 ? '<tr><td>Discount</td><td style="text-align:right;">- AED ' + formatAED(totals.discountAmount + totals.loyaltyAmount) + '</td></tr>' : '') +
    '<tr><td>VAT</td><td style="text-align:right;">Not applicable</td></tr>' +
    '<tr class="pr-total-row"><td>Total</td><td style="text-align:right;">AED ' + formatAED(totals.grandTotal) + '</td></tr>' +
    '</table>' +
    '<div class="pr-footer">Thank you for shopping with us!</div>';
}

function printBill() {
  document.getElementById('pos-print-receipt').innerHTML = buildPrintReceiptHtml();
  posState.printedOrSent = true;
  window.print();
}

function sendBillEmail() {
  var errorEl = document.getElementById('pos-payment-error');
  errorEl.textContent = '';
  if (!posState.selectedCustomer || !posState.selectedCustomer.email) return;

  var totals = recalcBillingTotals();
  var btn = document.getElementById('pos-send-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  fetch('/.netlify/functions/pos-send-bill-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      posToken: getPosToken(),
      email: posState.selectedCustomer.email,
      billNumber: posState.billNumber,
      items: posState.cart,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount + totals.loyaltyAmount,
      total: totals.grandTotal
    })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      btn.disabled = false;
      btn.textContent = 'Send Bill (Email)';
      if (!result.ok) { errorEl.textContent = result.data.error || 'Could not send email.'; return; }
      posState.printedOrSent = true;
    })
    .catch(function (e) {
      btn.disabled = false;
      btn.textContent = 'Send Bill (Email)';
      errorEl.textContent = 'Could not reach the server. Please try again.';
      console.error('send bill email error:', e);
    });
}

function completeSale() {
  var totals = recalcBillingTotals();
  var errorEl = document.getElementById('pos-payment-error');
  errorEl.textContent = '';

  var btn = document.getElementById('pos-complete-sale-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  fetch('/.netlify/functions/pos-complete-sale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      posToken: getPosToken(),
      items: posState.cart,
      customerId: posState.selectedCustomer ? posState.selectedCustomer.id : null,
      subtotal: totals.subtotal,
      discountType: posState.discountType,
      discountValue: posState.discountValue,
      discountAmount: totals.discountAmount,
      loyaltyPointsRedeemed: posState.loyaltyRedeemed,
      vatAmount: 0,
      total: totals.grandTotal,
      paymentMethod: posState.paymentMethod,
      amountReceived: posState.amountReceived,
      referenceId: document.getElementById('pos-pay-reference').value.trim() || null,
      salesPersonOverride: posState.transactionSalesPerson || null,
      notes: document.getElementById('pos-bill-notes').value.trim() || null
    })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      btn.disabled = false;
      btn.textContent = 'Complete Sale';
      if (!result.ok) { errorEl.textContent = result.data.error || 'Could not complete the sale.'; return; }
      alert('Sale completed! Bill number: ' + result.data.billNumber);
      resetTransaction();
    })
    .catch(function (e) {
      btn.disabled = false;
      btn.textContent = 'Complete Sale';
      errorEl.textContent = 'Could not reach the server. Please try again.';
      console.error('complete sale error:', e);
    });
}

function resetTransaction() {
  posState.cart = [];
  posState.selectedCustomer = null;
  posState.billNumber = null;
  posState.discountType = 'percent';
  posState.discountValue = 0;
  posState.loyaltyRedeemed = 0;
  posState.paymentMethod = 'Cash';
  posState.amountReceived = 0;
  posState.printedOrSent = false;
  posState.transactionSalesPerson = null;
  clearItemFields();
  clearCustomerForm();
  renderCart();
  refreshStepLocks();
  showStep(1);
  saveTransactionState();
}

// ---------- Change sales person mid-transaction ----------

var pendingSalesPersonChange = null; // { username, displayName } while password modal is open

function showSalesPersonDropdown() {
  var dropdown = document.getElementById('pos-salesperson-dropdown');
  fetch('/.netlify/functions/pos-list-usernames', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ posToken: getPosToken() })
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var users = data.users || [];
      if (!users.length) { dropdown.classList.remove('open'); return; }
      dropdown.innerHTML = users.map(function (u) {
        return '<div class="pos-suggest-item" data-username="' + u.username + '" data-displayname="' + u.display_name + '"><div class="si-info"><div class="si-name">' + u.display_name + '</div></div></div>';
      }).join('');
      dropdown.classList.add('open');
      dropdown.querySelectorAll('[data-username]').forEach(function (el) {
        el.addEventListener('click', function () {
          dropdown.classList.remove('open');
          pendingSalesPersonChange = { username: el.getAttribute('data-username'), displayName: el.getAttribute('data-displayname') };
          document.getElementById('pos-salesperson-pw-prompt').textContent = 'Enter password for ' + pendingSalesPersonChange.displayName + ' to confirm.';
          document.getElementById('pos-salesperson-pw-input').value = '';
          document.getElementById('pos-salesperson-pw-error').textContent = '';
          document.getElementById('pos-salesperson-pw-modal').classList.add('open');
        });
      });
    })
    .catch(function () { dropdown.classList.remove('open'); });
}

function confirmSalesPersonChange() {
  if (!pendingSalesPersonChange) return;
  var errorEl = document.getElementById('pos-salesperson-pw-error');
  var password = document.getElementById('pos-salesperson-pw-input').value;
  errorEl.textContent = '';
  if (!password) { errorEl.textContent = 'Password is required.'; return; }

  var btn = document.getElementById('pos-salesperson-pw-confirm');
  btn.disabled = true;
  btn.textContent = 'Checking...';

  fetch('/.netlify/functions/pos-verify-user-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ posToken: getPosToken(), username: pendingSalesPersonChange.username, password: password })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      btn.disabled = false;
      btn.textContent = 'Confirm';
      if (!result.ok) { errorEl.textContent = result.data.error || 'Incorrect password.'; return; }
      posState.transactionSalesPerson = result.data.displayName;
      document.getElementById('pos-bill-salesperson').textContent = result.data.displayName;
      document.getElementById('pos-salesperson-pw-modal').classList.remove('open');
      pendingSalesPersonChange = null;
    })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = 'Confirm';
      errorEl.textContent = 'Could not reach the server. Please try again.';
    });
}

// ---------- Wire everything up ----------

document.addEventListener('DOMContentLoaded', function () {
  var existingToken = getPosToken();
  var existingName = localStorage.getItem(POS_NAME_KEY);
  var existingUsername = localStorage.getItem(POS_USERNAME_KEY);

  if (existingToken && existingName && !isSessionExpired()) {
    showPosApp(existingName);
    restoreTransactionState();
  } else if (existingUsername) {
    // A previous session existed but is now missing/expired — pre-fill
    // the username so continuing feels like resuming, not starting
    // over from scratch. The saved transaction state (if any) stays in
    // localStorage untouched either way, ready to restore on whoever
    // logs in next, per the confirmed behavior.
    document.getElementById('pos-login-username').value = existingUsername;
  }

  // Periodic save (covers any state change without needing to hook
  // every single mutation point) and periodic expiry check (catches
  // the 8-hour mark even if nobody reloads the page).
  setInterval(function () {
    if (document.getElementById('pos-app').style.display !== 'none') {
      saveTransactionState();
      if (isSessionExpired()) {
        localStorage.removeItem(POS_TOKEN_KEY);
        localStorage.removeItem(POS_NAME_KEY);
        localStorage.removeItem(POS_LOGIN_TIME_KEY);
        window.location.reload();
      }
    }
  }, 5000);

  document.getElementById('pos-login-btn').addEventListener('click', attemptLogin);
  document.getElementById('pos-login-password').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') attemptLogin();
  });
  document.getElementById('pos-logout-btn').addEventListener('click', posLogout);
  document.getElementById('pos-reset-btn').addEventListener('click', function () {
    if (posState.cart.length === 0 && !posState.selectedCustomer) { resetTransaction(); return; }
    if (confirm('Clear the current transaction and start over? This cannot be undone.')) resetTransaction();
  });

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
  document.getElementById('pos-clear-item-btn').addEventListener('click', clearItemFields);
  document.getElementById('pos-back-to-browse-btn').addEventListener('click', clearItemFields);
  renderBrowseCats();
  renderBrowseGrid('All');
  document.getElementById('pos-proceed-customer-btn').addEventListener('click', function () {
    if (!posState.cart.length) { alert('Add at least one item to the cart before proceeding.'); return; }
    showStep(2);
  });

  // Customer
  var custSearchInput = document.getElementById('pos-cust-search');
  custSearchInput.addEventListener('input', function (e) {
    filterCustomerList(e.target.value);
  });
  document.getElementById('pos-new-cust-btn').addEventListener('click', clearCustomerForm);
  document.getElementById('pos-clear-cust-btn').addEventListener('click', clearCustomerForm);

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

  document.getElementById('pos-change-salesperson-btn').addEventListener('click', showSalesPersonDropdown);
  document.addEventListener('click', function (e) {
    var dropdown = document.getElementById('pos-salesperson-dropdown');
    var btn = document.getElementById('pos-change-salesperson-btn');
    if (!dropdown.contains(e.target) && e.target !== btn) dropdown.classList.remove('open');
  });
  document.getElementById('pos-salesperson-pw-confirm').addEventListener('click', confirmSalesPersonChange);
  document.getElementById('pos-salesperson-pw-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') confirmSalesPersonChange();
  });
  document.getElementById('pos-salesperson-pw-cancel').addEventListener('click', function () {
    document.getElementById('pos-salesperson-pw-modal').classList.remove('open');
    pendingSalesPersonChange = null;
  });
  document.getElementById('pos-proceed-payment-btn').addEventListener('click', function () { showStep(4); });

  // Payment
  document.querySelectorAll('.pay-method').forEach(function (el) {
    el.addEventListener('click', function () {
      if (el.classList.contains('disabled')) return; // Card — not wired up yet
      document.querySelectorAll('.pay-method').forEach(function (p) { p.classList.remove('active'); });
      el.classList.add('active');
      posState.paymentMethod = el.getAttribute('data-method');
    });
  });
  document.querySelectorAll('[data-akp]').forEach(function (btn) {
    btn.addEventListener('click', function () { handleAmountKeypad(btn.getAttribute('data-akp')); });
  });
  document.getElementById('pos-print-btn').addEventListener('click', printBill);
  document.getElementById('pos-send-btn').addEventListener('click', sendBillEmail);
  document.getElementById('pos-complete-sale-btn').addEventListener('click', function () {
    if (!posState.printedOrSent) {
      document.getElementById('pos-confirm-modal').classList.add('open');
    } else {
      completeSale();
    }
  });
  document.getElementById('pos-modal-cancel').addEventListener('click', function () {
    document.getElementById('pos-confirm-modal').classList.remove('open');
  });
  document.getElementById('pos-modal-proceed').addEventListener('click', function () {
    document.getElementById('pos-confirm-modal').classList.remove('open');
    completeSale();
  });

  renderCart();
  refreshStepLocks();
  showStep(1);
});
