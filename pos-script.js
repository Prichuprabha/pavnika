// pos-script.js — Pavnika POS. Runs standalone, entirely separate
// from the customer-facing site's script.js (no cart/wishlist/gate
// overlay system here — this is a distinct staff-only tool).

var POS_TOKEN_KEY = 'pavnika_pos_token';
var POS_NAME_KEY = 'pavnika_pos_display_name';

var posState = {
  cart: [],           // [{ id, name, price, qty, image }]
  selectedCustomer: null, // { id, name, phone, ... } once picked/created
  currentQty: 1,
  currentLookupItem: null
};

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
  var opts = { hour: '2-digit', minute: '2-digit', hour12: true };
  var timeStr = now.toLocaleTimeString('en-US', opts);
  var dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  document.getElementById('pos-datetime').textContent = timeStr + ' \u00b7 ' + dateStr;
}

// ---------- Step navigation ----------

function showStep(n) {
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
}

// ---------- Item lookup (Step 1) ----------

function formatAED(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function lookupItem() {
  var code = document.getElementById('pos-item-code').value.trim().toUpperCase();
  var errorEl = document.getElementById('pos-item-error');
  errorEl.textContent = '';

  if (!code) return;

  var products = window.PRODUCTS || [];
  var match = products.filter(function (p) { return p.id.toUpperCase() === code; })[0];

  if (!match) {
    errorEl.textContent = 'No item found with code "' + code + '".';
    posState.currentLookupItem = null;
    document.getElementById('pos-add-to-cart-btn').disabled = true;
    return;
  }

  posState.currentLookupItem = match;
  document.getElementById('pos-item-name').value = (match.series ? match.series + ' \u2014 ' : '') + (match.type || match.material || '');
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

  if (match.sold) {
    errorEl.textContent = 'Warning: this item is already marked sold. Double-check before adding.';
  }
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
  } else {
    posState.cart.push({
      id: item.id,
      name: (item.series ? item.series + ' \u2014 ' : '') + (item.type || item.material || ''),
      price: item.price,
      qty: posState.currentQty,
      image: item.image || ''
    });
  }
  renderCart();

  // Reset for the next scan and refocus — a physical barcode scanner
  // just needs the field focused and empty to keep working continuously.
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
}

function cartTotal() {
  return posState.cart.reduce(function (sum, c) { return sum + c.price * c.qty; }, 0);
}

function renderCart() {
  var listEl = document.getElementById('pos-cart-list');
  if (!posState.cart.length) {
    listEl.innerHTML = '<p class="pos-empty-note">No items added yet.</p>';
  } else {
    listEl.innerHTML = posState.cart.map(function (c) {
      var imgTag = c.image ? '<img src="' + c.image + '">' : '<div class="cart-item-noimg" style="width:40px;height:40px;border-radius:6px;background:var(--ivory-deep);"></div>';
      return '<div class="cart-item">' + imgTag +
        '<div class="ci-info"><div class="ci-name">' + c.id + ' \u2014 ' + c.name + '</div>' +
        '<div class="ci-sub">Qty ' + c.qty + ' &times; AED ' + formatAED(c.price) + '</div></div>' +
        '<div class="num-total">' + formatAED(c.price * c.qty) + '</div>' +
        '<button class="del-btn" data-remove="' + c.id + '">&times;</button></div>';
    }).join('');
  }
  document.getElementById('pos-cart-total').textContent = 'AED ' + formatAED(cartTotal());

  listEl.querySelectorAll('[data-remove]').forEach(function (btn) {
    btn.addEventListener('click', function () { removeFromCart(btn.getAttribute('data-remove')); });
  });
}

// ---------- Customer (Step 2) ----------

var custSearchDebounce = null;

function searchCustomers(query) {
  var listEl = document.getElementById('pos-cust-list');
  clearTimeout(custSearchDebounce);
  custSearchDebounce = setTimeout(function () {
    fetch('/.netlify/functions/pos-search-customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posToken: getPosToken(), query: query })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var customers = data.customers || [];
        if (!customers.length) {
          listEl.innerHTML = '<p class="pos-empty-note">' + (query ? 'No matching customers.' : 'Type to search existing customers.') + '</p>';
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
            selectCustomer(picked);
          });
        });
      })
      .catch(function (e) { console.error('customer search error:', e); });
  }, 300);
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
  document.querySelectorAll('.cust-list-item').forEach(function (el) {
    el.classList.toggle('selected', el.getAttribute('data-cust-id') === customer.id);
  });
}

function clearCustomerForm() {
  posState.selectedCustomer = null;
  document.getElementById('pos-cust-name').value = '';
  document.getElementById('pos-cust-phone').value = '';
  document.getElementById('pos-cust-email').value = '';
  document.getElementById('pos-cust-address').value = '';
  document.getElementById('pos-cust-error').textContent = '';
  document.querySelectorAll('#pos-cust-emirate .seg-btn').forEach(function (btn, i) {
    btn.classList.toggle('active', i === 0);
  });
  document.querySelectorAll('.cust-list-item').forEach(function (el) { el.classList.remove('selected'); });
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

  // Already have a selected existing customer with the same details —
  // no need to create a new record.
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
      phoneCountryCode: document.getElementById('pos-cust-code').value,
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
      showStep(3);
    })
    .catch(function (e) {
      btn.disabled = false;
      btn.textContent = 'Proceed to Billing \u2192';
      errorEl.textContent = 'Could not reach the server. Please try again.';
      console.error('create customer error:', e);
    });
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
  document.getElementById('pos-item-code').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); lookupItem(); }
  });
  document.getElementById('pos-item-lookup-btn').addEventListener('click', lookupItem);
  document.getElementById('pos-qty-minus').addEventListener('click', function () { changeQty(-1); });
  document.getElementById('pos-qty-plus').addEventListener('click', function () { changeQty(1); });
  document.getElementById('pos-add-to-cart-btn').addEventListener('click', addToCart);
  document.getElementById('pos-proceed-customer-btn').addEventListener('click', function () {
    if (!posState.cart.length) {
      alert('Add at least one item to the cart before proceeding.');
      return;
    }
    showStep(2);
  });

  // Customer
  document.getElementById('pos-cust-search').addEventListener('input', function (e) {
    searchCustomers(e.target.value.trim());
  });
  document.getElementById('pos-new-cust-btn').addEventListener('click', clearCustomerForm);
  document.querySelectorAll('#pos-cust-emirate .seg-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#pos-cust-emirate .seg-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
    });
  });
  document.getElementById('pos-proceed-billing-btn').addEventListener('click', proceedToBilling);

  renderCart();
  showStep(1);
});
