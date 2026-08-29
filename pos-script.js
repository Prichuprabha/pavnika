// pos-script.js — Pavnika POS. Runs standalone, entirely separate
// from the customer-facing site's script.js (no cart/wishlist/gate
// overlay system here — this is a distinct staff-only tool).

var POS_TOKEN_KEY = 'pavnika_pos_token';
var POS_NAME_KEY = 'pavnika_pos_display_name';
var POS_IS_ADMIN_KEY = 'pavnika_pos_is_admin';
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
  transactionSalesPerson: null, // set only if changed mid-transaction; falls back to the logged-in user's name
  couponCode: null,
  couponDiscountPercent: 0,
  giftCardRedeemed: 0,
  paymentMode: 'single', // 'single' or 'split'
  splitPayments: [],      // [{ method, amount }] — only used when paymentMode === 'split'
  paymentConfirmed: false
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
  localStorage.removeItem(POS_IS_ADMIN_KEY);
  localStorage.removeItem(POS_LOGIN_TIME_KEY);
  // Deliberately NOT removing POS_USERNAME_KEY or POS_SAVED_STATE_KEY —
  // both are needed to pre-fill the username and restore the
  // in-progress transaction on the next login, by design.
  window.location.reload();
}

function isPosAdmin() {
  return localStorage.getItem(POS_IS_ADMIN_KEY) === 'true';
}

function showPosApp(displayName) {
  document.getElementById('pos-login-screen').style.display = 'none';
  document.getElementById('pos-app').style.display = 'flex';
  document.querySelector('.pos-brand').textContent = 'Pavnika POS \u2014 ' + displayName;
  document.querySelector('.nav-link[data-page="settings"]').style.display = isPosAdmin() ? 'flex' : 'none';
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
      localStorage.setItem(POS_IS_ADMIN_KEY, String(!!result.data.isAdmin));
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
  if (posState.paymentConfirmed && n !== 4) {
    alert('Payment is confirmed for this sale. Press Complete Sale before doing anything else.');
    return;
  }
  if (!canAccessStep(n)) {
    if (n === 2) alert('Add at least one item to the cart first.');
    else alert('Complete the Customer step (name and mobile number) first.');
    return;
  }
  currentStepNum = n;
  document.querySelectorAll('.page-content').forEach(function (el) { el.style.display = 'none'; });
  document.getElementById('stepTracker').style.display = 'flex';
  document.querySelectorAll('.step-content').forEach(function (el) { el.style.display = 'none'; });
  document.getElementById('step-' + n).style.display = 'grid';
  document.querySelectorAll('.nav-link[data-step]').forEach(function (el) {
    el.classList.toggle('active', el.getAttribute('data-step') === String(n));
  });
  document.querySelectorAll('.nav-link[data-page]').forEach(function (el) { el.classList.remove('active'); });
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

function showPage(pageName) {
  if (posState.paymentConfirmed) {
    alert('Payment is confirmed for this sale. Press Complete Sale before doing anything else.');
    return;
  }
  document.querySelectorAll('.step-content').forEach(function (el) { el.style.display = 'none'; });
  document.getElementById('stepTracker').style.display = 'none';
  document.querySelectorAll('.page-content').forEach(function (el) { el.style.display = 'none'; });
  document.getElementById('page-' + pageName).style.display = 'block';
  document.querySelectorAll('.nav-link[data-step]').forEach(function (el) { el.classList.remove('active'); });
  document.querySelectorAll('.nav-link[data-page]').forEach(function (el) {
    el.classList.toggle('active', el.getAttribute('data-page') === pageName);
  });
  if (pageName === 'hold') loadHeldSales();
  if (pageName === 'return') loadReturnPage();
  if (pageName === 'sales-history') {
    loadSalesHistory();
    document.getElementById('pos-sh-search-clear').style.display = document.getElementById('pos-sh-search').value ? 'flex' : 'none';
  }
  if (pageName === 'customer-db') loadCustomerDbList('');
}

// ---------- Hold / Parked Sales page ----------

function loadHeldSales() {
  var rowsEl = document.getElementById('pos-held-sales-rows');
  fetch('/.netlify/functions/pos-list-held-sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ posToken: getPosToken() })
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var sales = data.heldSales || [];
      if (!sales.length) {
        rowsEl.innerHTML = '<tr><td colspan="6" style="opacity:0.6;">No parked sales right now.</td></tr>';
        return;
      }
      rowsEl.innerHTML = sales.map(function (s) {
        var cartId = 'CART-' + s.id.slice(0, 6).toUpperCase();
        var customerName = s.customer_json ? s.customer_json.name : 'Walk-in Customer';
        var itemCount = (s.cart_json || []).reduce(function (sum, c) { return sum + c.qty; }, 0);
        var subtotal = (s.cart_json || []).reduce(function (sum, c) { return sum + c.price * c.qty; }, 0);
        var discountAmt = s.discount_type === 'percent' ? subtotal * ((s.discount_value || 0) / 100) : (s.discount_value || 0);
        var dueAmount = Math.max(0, subtotal - discountAmt);
        var time = new Date(s.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        return '<tr><td>' + cartId + '</td><td>' + customerName + '</td><td>' + itemCount + '</td><td>AED ' + formatAED(dueAmount) + '</td><td>' + time + '</td>' +
          '<td><button type="button" class="table-action-btn" style="background:var(--ivory-deep); color:var(--green-deep);" data-preview-held="' + s.id + '">Preview</button>' +
          '<button type="button" class="table-action-btn btn-resume" data-resume="' + s.id + '">Resume</button>' +
          '<button type="button" class="table-action-btn btn-delete" data-delete-held="' + s.id + '">Delete</button></td></tr>';
      }).join('');

      rowsEl.querySelectorAll('[data-preview-held]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var picked = sales.filter(function (s) { return s.id === btn.getAttribute('data-preview-held'); })[0];
          if (picked) previewHeldSale(picked);
        });
      });
      rowsEl.querySelectorAll('[data-resume]').forEach(function (btn) {
        btn.addEventListener('click', function () { resumeHeldSale(btn.getAttribute('data-resume')); });
      });
      rowsEl.querySelectorAll('[data-delete-held]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (confirm('Delete this parked sale permanently? This cannot be undone.')) deleteHeldSale(btn.getAttribute('data-delete-held'));
        });
      });
    })
    .catch(function (e) {
      console.error('load held sales error:', e);
      rowsEl.innerHTML = '<tr><td colspan="6">Could not load parked sales.</td></tr>';
    });
}

function resumeHeldSale(id) {
  if (posState.cart.length && !confirm('You have items in the current cart already. Resuming this parked sale will replace them. Continue?')) {
    return;
  }
  fetch('/.netlify/functions/pos-resume-held-sale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ posToken: getPosToken(), id: id })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      if (!result.ok) { alert(result.data.error || 'Could not resume this sale.'); return; }
      var held = result.data.heldSale;

      posState.cart = held.cart_json || [];
      posState.selectedCustomer = held.customer_json || null;
      posState.discountType = held.discount_type || 'percent';
      posState.discountValue = held.discount_value || 0;
      posState.couponCode = null;
      posState.couponDiscountPercent = 0;

      renderCart();
      refreshStepLocks();

      // Re-validate the coupon rather than trusting the stored percent
      // blindly — it may have expired or been used elsewhere since
      // this sale was parked.
      var finishResume = function () {
        showStep(3);
        if (held.notes) document.getElementById('pos-bill-notes').value = held.notes;
      };

      if (held.coupon_code) {
        fetch('/.netlify/functions/validate-promo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: held.coupon_code })
        })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (data.valid) {
              posState.couponCode = data.code;
              posState.couponDiscountPercent = data.discountPercent;
            } else {
              alert('The coupon on this parked sale ("' + held.coupon_code + '") is no longer valid and was not re-applied.');
            }
            finishResume();
          })
          .catch(finishResume);
      } else {
        finishResume();
      }
    })
    .catch(function () { alert('Could not reach the server. Please try again.'); });
}

function previewHeldSale(sale) {
  var customerName = sale.customer_json ? sale.customer_json.name : 'Walk-in Customer';
  var customerPhone = sale.customer_json ? ((sale.customer_json.phone_country_code || '') + ' ' + sale.customer_json.phone) : '\u2014';
  document.getElementById('pos-held-preview-customer').textContent = customerName;
  document.getElementById('pos-held-preview-phone').textContent = customerPhone;

  var items = sale.cart_json || [];
  var itemsEl = document.getElementById('pos-held-preview-items');
  itemsEl.innerHTML = items.map(function (it) {
    var imgTag = it.image ? '<img src="' + it.image + '">' : '<div style="width:42px;height:54px;border-radius:6px;background:var(--ivory-deep);flex-shrink:0;"></div>';
    return '<div class="pos-cart-item">' + imgTag +
      '<div class="ci-info"><div class="ci-name">' + it.id + ' \u2014 ' + it.name + '</div><div class="ci-sub">Qty ' + it.qty + ' &times; AED ' + formatAED(it.price) + '</div></div>' +
      '<div class="ci-total">' + formatAED(it.price * it.qty) + '</div></div>';
  }).join('');

  var subtotal = items.reduce(function (sum, it) { return sum + it.price * it.qty; }, 0);
  var discountAmt = sale.discount_type === 'percent' ? subtotal * ((sale.discount_value || 0) / 100) : (sale.discount_value || 0);
  var dueAmount = Math.max(0, subtotal - discountAmt);

  var discountRow = document.getElementById('pos-held-preview-discount-row');
  if (discountAmt > 0 || sale.coupon_code) {
    discountRow.style.display = 'flex';
    var label = sale.discount_value > 0 ? 'Discount (' + (sale.discount_type === 'percent' ? sale.discount_value + '%' : 'AED') + ')' : 'Discount';
    if (sale.coupon_code) label += ' + Coupon (' + sale.coupon_code + ')';
    document.getElementById('pos-held-preview-discount-label').textContent = label;
    document.getElementById('pos-held-preview-discount-value').textContent = '\u2212 AED ' + formatAED(discountAmt);
  } else {
    discountRow.style.display = 'none';
  }

  document.getElementById('pos-held-preview-subtotal').textContent = 'AED ' + formatAED(subtotal);
  document.getElementById('pos-held-preview-due').textContent = 'AED ' + formatAED(dueAmount);
  document.getElementById('pos-held-preview-modal').classList.add('open');
}

function deleteHeldSale(id) {
  fetch('/.netlify/functions/pos-delete-held-sale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ posToken: getPosToken(), id: id })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      if (!result.ok) { alert(result.data.error || 'Could not delete this sale.'); return; }
      loadHeldSales();
    })
    .catch(function () { alert('Could not reach the server. Please try again.'); });
}

// ---------- Return / Exchange page ----------

var returnState = { selectedSale: null, selectedItemIds: [], actionType: null, refundMethod: null };

function loadReturnPage() {
  returnState = { selectedSale: null, selectedItemIds: [], actionType: null, refundMethod: null };
  document.getElementById('pos-return-search').value = '';
  document.getElementById('pos-return-no-sale').style.display = 'block';
  document.getElementById('pos-return-sale-detail').style.display = 'none';
  document.querySelectorAll('.pos-return-action').forEach(function (el) { el.classList.remove('active'); el.classList.add('pra-disabled'); el.classList.remove('pos-return-locked'); });
  document.querySelectorAll('#pos-return-refund-method .seg-btn').forEach(function (el) { el.classList.remove('active'); });
  document.getElementById('pos-return-refund-method-box').style.display = 'none';
  document.getElementById('pos-return-refund-method-box').classList.remove('pos-return-locked');
  document.getElementById('pos-return-items-list').classList.remove('pos-return-locked');
  document.getElementById('pos-return-refund-preview').style.display = 'none';
  document.getElementById('pos-return-process-btn').disabled = true;
  document.getElementById('pos-return-process-btn').style.display = 'block';
  document.getElementById('pos-return-receipt-box').style.display = 'none';
  document.getElementById('pos-return-error').textContent = '';

  if (pendingReturnBillNumber) {
    document.getElementById('pos-return-search').value = pendingReturnBillNumber;
    searchOriginalSales(pendingReturnBillNumber, pendingReturnBillNumber);
    pendingReturnBillNumber = null;
  } else {
    searchOriginalSales('');
  }
}

function searchOriginalSales(query, autoSelectBillNumber) {
  fetch('/.netlify/functions/pos-search-original-sale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ posToken: getPosToken(), query: query })
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var sales = data.sales || [];
      var listEl = document.getElementById('pos-return-sale-list');
      if (!sales.length) {
        listEl.innerHTML = '<p class="pos-empty-note">No matching sales found.</p>';
        return;
      }
      listEl.innerHTML = sales.map(function (s) {
        var time = new Date(s.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        return '<div class="cust-list-item" data-sale-id="' + s.id + '"><span class="name">' + s.bill_number + '</span>' +
          '<span class="phone">' + s.customer_name + ' \u2014 AED ' + formatAED(s.total) + ' \u2014 ' + time + '</span></div>';
      }).join('');
      listEl.querySelectorAll('[data-sale-id]').forEach(function (el) {
        el.addEventListener('click', function () {
          var picked = sales.filter(function (s) { return s.id === el.getAttribute('data-sale-id'); })[0];
          if (!picked) return;
          listEl.querySelectorAll('[data-sale-id]').forEach(function (row) { row.classList.remove('selected'); });
          el.classList.add('selected');
          selectSaleForReturn(picked);
        });
      });

      if (autoSelectBillNumber) {
        var match = sales.filter(function (s) { return s.bill_number === autoSelectBillNumber; })[0];
        if (match) {
          selectSaleForReturn(match);
          var row = listEl.querySelector('[data-sale-id="' + match.id + '"]');
          if (row) row.classList.add('selected');
        }
      }
    })
    .catch(function (e) { console.error('search original sale error:', e); });
}

function selectSaleForReturn(sale) {
  returnState.selectedSale = sale;
  returnState.selectedItemIds = [];
  returnState.actionType = null;
  returnState.refundMethod = null;
  document.querySelectorAll('.pos-return-action').forEach(function (el) { el.classList.remove('active'); el.classList.add('pra-disabled'); el.classList.remove('pos-return-locked'); });
  document.querySelectorAll('#pos-return-refund-method .seg-btn').forEach(function (el) { el.classList.remove('active'); });
  document.getElementById('pos-return-refund-method-box').style.display = 'none';
  document.getElementById('pos-return-refund-method-box').classList.remove('pos-return-locked');
  document.getElementById('pos-return-items-list').classList.remove('pos-return-locked');
  document.getElementById('pos-return-refund-preview').style.display = 'none';
  document.getElementById('pos-return-process-btn').disabled = true;
  document.getElementById('pos-return-error').textContent = '';
  document.getElementById('pos-return-no-sale').style.display = 'none';
  document.getElementById('pos-return-sale-detail').style.display = 'flex';
  document.getElementById('pos-return-bill-no').textContent = sale.bill_number;
  document.getElementById('pos-return-bill-date').textContent = new Date(sale.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  var alreadyReturned = sale.already_returned_item_ids || [];
  var itemsEl = document.getElementById('pos-return-items-list');
  itemsEl.innerHTML = (sale.items || []).map(function (it) {
    var isReturned = alreadyReturned.indexOf(it.id) !== -1;
    var imgTag = it.image ? '<img src="' + it.image + '">' : '<div style="width:40px;height:52px;border-radius:5px;background:var(--ivory-deep);flex-shrink:0;"></div>';
    var statusNote = isReturned ? '<div class="pri-sub" style="color:#B8142A;">Already returned/exchanged</div>' : '';
    var attrs = isReturned ? ' style="opacity:0.5; cursor:not-allowed;"' : ' data-return-item="' + it.id + '"';
    return '<div class="pos-return-item-row"' + attrs + '>' + imgTag +
      '<div class="pri-info"><div class="pri-name">' + it.id + ' \u2014 ' + it.name + '</div><div class="pri-sub">Qty ' + it.qty + ' &times; AED ' + formatAED(it.price) + '</div>' + statusNote + '</div></div>';
  }).join('');

  itemsEl.querySelectorAll('[data-return-item]').forEach(function (row) {
    row.addEventListener('click', function () {
      var id = row.getAttribute('data-return-item');
      var isSelected = row.classList.toggle('selected');
      if (isSelected) { if (returnState.selectedItemIds.indexOf(id) === -1) returnState.selectedItemIds.push(id); }
      else { returnState.selectedItemIds = returnState.selectedItemIds.filter(function (x) { return x !== id; }); }
      updateReturnRefundPreview();
    });
  });
}

function updateReturnRefundPreview() {
  var errorEl = document.getElementById('pos-return-error');
  errorEl.textContent = '';
  var previewBox = document.getElementById('pos-return-refund-preview');
  var processBtn = document.getElementById('pos-return-process-btn');
  var methodBox = document.getElementById('pos-return-refund-method-box');

  document.querySelectorAll('.pos-return-action').forEach(function (el) {
    el.classList.toggle('pra-disabled', returnState.selectedItemIds.length === 0);
  });

  methodBox.style.display = returnState.actionType === 'return' ? 'block' : 'none';
  if (returnState.actionType === 'exchange') returnState.refundMethod = 'gift_card';

  if (!returnState.selectedItemIds.length || !returnState.actionType) {
    previewBox.style.display = 'none';
    processBtn.disabled = true;
    return;
  }
  if (returnState.actionType === 'return' && !returnState.refundMethod) {
    previewBox.style.display = 'none';
    processBtn.disabled = true;
    return;
  }

  var sale = returnState.selectedSale;
  var selectedItems = (sale.items || []).filter(function (it) { return returnState.selectedItemIds.indexOf(it.id) !== -1; });
  var returnedListValue = selectedItems.reduce(function (sum, it) { return sum + it.price * it.qty; }, 0);
  var effectiveRatio = sale.subtotal > 0 ? sale.total / sale.subtotal : 1;
  var refund = Math.round(returnedListValue * effectiveRatio * 100) / 100;

  document.getElementById('pos-return-refund-amount').textContent = 'AED ' + formatAED(refund);
  previewBox.style.display = 'block';
  processBtn.disabled = false;
}

// ---------- Sales History ----------

// ---------- Customer Database ----------

var customerDbCache = [];
var customerDbSelectedId = null;

function loadCustomerDbList(query) {
  var listEl = document.getElementById('pos-cdb-list');
  fetch('/.netlify/functions/pos-search-customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ posToken: getPosToken(), query: query || '' })
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      customerDbCache = data.customers || [];
      renderCustomerDbList();
    })
    .catch(function (e) {
      console.error('load customer db list error:', e);
      listEl.innerHTML = '<p class="pos-empty-note">Could not load customers.</p>';
    });
}

function renderCustomerDbList() {
  var listEl = document.getElementById('pos-cdb-list');
  if (!customerDbCache.length) {
    listEl.innerHTML = '<p class="pos-empty-note">No customers found.</p>';
    return;
  }
  listEl.innerHTML = customerDbCache.map(function (c) {
    return '<div class="cust-list-item' + (c.id === customerDbSelectedId ? ' selected' : '') + '" data-cdb-id="' + c.id + '">' +
      '<span class="name">' + c.name + '</span>' +
      '<span class="phone">' + c.phone_country_code + ' ' + c.phone + '</span></div>';
  }).join('');
  listEl.querySelectorAll('[data-cdb-id]').forEach(function (el) {
    el.addEventListener('click', function () {
      var picked = customerDbCache.filter(function (c) { return c.id === el.getAttribute('data-cdb-id'); })[0];
      if (picked) selectCustomerDb(picked);
    });
  });
}

function selectCustomerDb(customer) {
  customerDbSelectedId = customer.id;
  renderCustomerDbList();

  document.getElementById('pos-cdb-no-selection').style.display = 'none';
  document.getElementById('pos-cdb-detail').style.display = 'flex';
  document.getElementById('pos-cdb-error').textContent = '';

  document.getElementById('pos-cdb-name').value = customer.name || '';
  document.getElementById('pos-cdb-code').value = customer.phone_country_code || '+971';
  document.getElementById('pos-cdb-phone').value = customer.phone || '';
  document.getElementById('pos-cdb-email').value = customer.email || '';
  document.getElementById('pos-cdb-address').value = customer.address || '';
  document.querySelectorAll('#pos-cdb-emirate .seg-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-v') === customer.emirate);
  });

  ['pos-cdb-summary-purchases', 'pos-cdb-summary-spent', 'pos-cdb-summary-visit'].forEach(function (id) {
    document.getElementById(id).textContent = 'Fetching...';
  });
  document.getElementById('pos-cdb-summary-points').value = '';
  document.getElementById('pos-cdb-summary-giftcard').value = '';
  document.getElementById('pos-cdb-summary-points').placeholder = 'Loading...';
  document.getElementById('pos-cdb-summary-giftcard').placeholder = 'Loading...';

  fetch('/.netlify/functions/pos-customer-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ posToken: getPosToken(), customerId: customer.id })
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      document.getElementById('pos-cdb-summary-purchases').textContent = data.totalPurchases;
      document.getElementById('pos-cdb-summary-spent').textContent = 'AED ' + formatAED(data.totalSpent);
      document.getElementById('pos-cdb-summary-visit').textContent = data.lastVisit ? new Date(data.lastVisit).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
      document.getElementById('pos-cdb-summary-points').value = data.loyaltyPoints || 0;
      document.getElementById('pos-cdb-summary-giftcard').value = data.giftCardBalance || 0;
    })
    .catch(function (e) { console.error('customer db summary error:', e); });
}

function saveCustomerDb() {
  if (!customerDbSelectedId) return;
  var name = document.getElementById('pos-cdb-name').value.trim();
  var phone = document.getElementById('pos-cdb-phone').value.trim();
  var loyaltyPoints = parseInt(document.getElementById('pos-cdb-summary-points').value, 10);
  var giftCardBalance = parseFloat(document.getElementById('pos-cdb-summary-giftcard').value);
  var errorEl = document.getElementById('pos-cdb-error');
  errorEl.textContent = '';

  if (!name || !phone) {
    errorEl.textContent = 'Customer name and mobile number are required.';
    return;
  }
  if (isNaN(loyaltyPoints) || loyaltyPoints < 0) {
    errorEl.textContent = 'Loyalty points must be a valid number, 0 or more.';
    return;
  }
  if (isNaN(giftCardBalance) || giftCardBalance < 0) {
    errorEl.textContent = 'Gift card balance must be a valid amount, 0 or more.';
    return;
  }

  var emirateBtn = document.querySelector('#pos-cdb-emirate .seg-btn.active');
  var btn = document.getElementById('pos-cdb-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  fetch('/.netlify/functions/pos-update-customer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      posToken: getPosToken(),
      customerId: customerDbSelectedId,
      name: name,
      phone: phone,
      phoneCountryCode: document.getElementById('pos-cdb-code').value.trim() || '+971',
      email: document.getElementById('pos-cdb-email').value.trim(),
      emirate: emirateBtn ? emirateBtn.getAttribute('data-v') : null,
      address: document.getElementById('pos-cdb-address').value.trim(),
      loyaltyPoints: loyaltyPoints,
      giftCardBalance: giftCardBalance
    })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
      if (!result.ok) { errorEl.textContent = result.data.error || 'Could not save changes.'; return; }
      // Reflect the saved values back into the cached list (name/phone shown there)
      customerDbCache.forEach(function (c, idx) {
        if (c.id === customerDbSelectedId) customerDbCache[idx] = result.data.customer;
      });
      renderCustomerDbList();

      // The main Customer step keeps its own separate cache — sync it
      // too, otherwise this edit would only show up there after a
      // full page refresh (recentCustomersCache is only ever fetched
      // once, at login).
      recentCustomersCache.forEach(function (c, idx) {
        if (c.id === customerDbSelectedId) recentCustomersCache[idx] = result.data.customer;
      });
      renderCustomerList(recentCustomersCache);
      if (posState.selectedCustomer && posState.selectedCustomer.id === customerDbSelectedId) {
        posState.selectedCustomer = result.data.customer;
      }
    })
    .catch(function (e) {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
      errorEl.textContent = 'Could not reach the server. Please try again.';
      console.error('save customer db error:', e);
    });
}

var salesHistoryCache = [];
var pendingReturnBillNumber = null;

function loadSalesHistory() {
  var query = document.getElementById('pos-sh-search').value.trim();
  var dateFilter = document.getElementById('pos-sh-date-filter').value;
  var rowsEl = document.getElementById('pos-sh-rows');
  rowsEl.innerHTML = '<tr><td colspan="6" style="opacity:0.6;">Loading...</td></tr>';

  fetch('/.netlify/functions/pos-list-sales-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ posToken: getPosToken(), query: query, dateFilter: dateFilter })
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      salesHistoryCache = data.sales || [];
      renderSalesHistory();
    })
    .catch(function (e) {
      console.error('load sales history error:', e);
      rowsEl.innerHTML = '<tr><td colspan="6">Could not load sales history.</td></tr>';
    });
}

function renderSalesHistory() {
  var rowsEl = document.getElementById('pos-sh-rows');
  if (!salesHistoryCache.length) {
    rowsEl.innerHTML = '<tr><td colspan="6" style="opacity:0.6;">No sales found.</td></tr>';
    return;
  }
  var statusColors = { 'Completed': '#2c5c37', 'Returned': '#B8142A', 'Exchanged': '#946B4A', 'Partially Returned': '#946B4A' };
  rowsEl.innerHTML = salesHistoryCache.map(function (s) {
    var time = new Date(s.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    var color = statusColors[s.status] || '#8a7266';
    return '<tr><td>' + s.bill_number + '</td><td>' + time + '</td><td>' + s.customer_name + '</td><td>AED ' + formatAED(s.total) + '</td>' +
      '<td style="color:' + color + '; font-weight:600;">' + s.status + '</td>' +
      '<td class="pos-sh-actions-cell">' +
      '<button type="button" class="table-action-btn" style="background:var(--ivory-deep); color:var(--green-deep);" data-sh-view="' + s.id + '">View</button>' +
      '<button type="button" class="table-action-btn" style="background:var(--ivory-deep); color:var(--green-deep);" data-sh-print="' + s.id + '">Print</button>' +
      '<button type="button" class="table-action-btn" style="background:var(--ivory-deep); color:var(--green-deep);" data-sh-send="' + s.id + '">WhatsApp</button>' +
      (s.status === 'Exchanged'
        ? '<button type="button" class="table-action-btn" style="background:#F8ECE2; color:#A15C1E;" data-sh-giftcard="' + s.id + '">Gift Card</button>'
        : '<button type="button" class="table-action-btn btn-resume" data-sh-return="' + s.id + '">Return</button>') +
      '</td></tr>';
  }).join('');

  rowsEl.querySelectorAll('[data-sh-view]').forEach(function (btn) {
    btn.addEventListener('click', function () { viewSalesHistoryBill(btn.getAttribute('data-sh-view')); });
  });
  rowsEl.querySelectorAll('[data-sh-print]').forEach(function (btn) {
    btn.addEventListener('click', function () { printSalesHistoryBill(btn.getAttribute('data-sh-print')); });
  });
  rowsEl.querySelectorAll('[data-sh-send]').forEach(function (btn) {
    btn.addEventListener('click', function () { sendSalesHistoryWhatsApp(btn.getAttribute('data-sh-send')); });
  });
  rowsEl.querySelectorAll('[data-sh-return]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var sale = findHistorySale(btn.getAttribute('data-sh-return'));
      pendingReturnBillNumber = sale ? sale.bill_number : null;
      showPage('return');
    });
  });
  rowsEl.querySelectorAll('[data-sh-giftcard]').forEach(function (btn) {
    btn.addEventListener('click', function () { showGiftCardUsage(btn.getAttribute('data-sh-giftcard')); });
  });
}

function showGiftCardUsage(saleId) {
  var sale = findHistorySale(saleId);
  if (!sale || !sale.customer_id) { alert('No customer on file for this sale.'); return; }

  document.getElementById('pos-gcu-credit').textContent = 'AED ' + formatAED(sale.gift_card_credit || 0);
  document.getElementById('pos-gcu-customer').textContent = 'Fetching...';
  document.getElementById('pos-gcu-balance').textContent = 'Fetching...';
  document.getElementById('pos-gcu-sales-since').innerHTML = '';
  document.getElementById('pos-gcu-modal').classList.add('open');

  fetch('/.netlify/functions/pos-gift-card-usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ posToken: getPosToken(), customerId: sale.customer_id, sinceDate: sale.created_at, excludeSaleId: sale.id })
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      document.getElementById('pos-gcu-customer').textContent = data.customerName || sale.customer_name;
      document.getElementById('pos-gcu-phone').textContent = data.customerPhone || '';
      document.getElementById('pos-gcu-balance').textContent = 'AED ' + formatAED(data.currentBalance || 0);

      var listEl = document.getElementById('pos-gcu-sales-since');
      if (!data.salesSince || !data.salesSince.length) {
        listEl.innerHTML = '<p class="pos-empty-note">No purchases since this exchange.</p>';
        return;
      }
      listEl.innerHTML = data.salesSince.map(function (s) {
        var time = new Date(s.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        var itemNames = (s.items || []).map(function (it) { return it.id; }).join(', ');
        return '<div class="cust-list-item"><span class="name">' + s.bill_number + ' \u2014 AED ' + formatAED(s.total) + '</span>' +
          '<span class="phone">' + time + ' \u2014 ' + itemNames + '</span></div>';
      }).join('');
    })
    .catch(function (e) {
      console.error('gift card usage error:', e);
      document.getElementById('pos-gcu-customer').textContent = sale.customer_name;
      document.getElementById('pos-gcu-balance').textContent = 'Could not load';
    });
}

function findHistorySale(id) {
  return salesHistoryCache.filter(function (s) { return s.id === id; })[0];
}

function viewSalesHistoryBill(id) {
  var sale = findHistorySale(id);
  if (!sale) return;

  document.getElementById('pos-sh-view-bill-no').textContent = sale.bill_number;
  document.getElementById('pos-sh-view-customer').textContent = sale.customer_name;
  document.getElementById('pos-sh-view-date').textContent = new Date(sale.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  document.getElementById('pos-sh-view-status').textContent = sale.status;
  document.getElementById('pos-sh-view-method').textContent = sale.payment_method || '\u2014';

  var itemsEl = document.getElementById('pos-sh-view-items');
  itemsEl.innerHTML = (sale.items || []).map(function (it) {
    var imgTag = it.image ? '<img src="' + it.image + '">' : '<div style="width:42px;height:54px;border-radius:6px;background:var(--ivory-deep);flex-shrink:0;"></div>';
    return '<div class="pos-cart-item">' + imgTag +
      '<div class="ci-info"><div class="ci-name">' + it.id + ' \u2014 ' + it.name + '</div><div class="ci-sub">Qty ' + it.qty + ' &times; AED ' + formatAED(it.price) + '</div></div>' +
      '<div class="ci-total">' + formatAED(it.price * it.qty) + '</div></div>';
  }).join('');

  document.getElementById('pos-sh-view-subtotal').textContent = 'AED ' + formatAED(sale.subtotal);
  var discountRow = document.getElementById('pos-sh-view-discount-row');
  if (sale.discount_amount > 0) {
    discountRow.style.display = 'flex';
    document.getElementById('pos-sh-view-discount').textContent = '\u2212 AED ' + formatAED(sale.discount_amount);
  } else {
    discountRow.style.display = 'none';
  }
  document.getElementById('pos-sh-view-total').textContent = 'AED ' + formatAED(sale.total);
  document.getElementById('pos-sh-view-modal').classList.add('open');
}

function buildHistoricalReceiptHtml(sale) {
  var itemLines = (sale.items || []).map(function (it) {
    return '<div>' + it.id + ' ' + it.name + '</div>' +
      '<div class="pr-row"><span>' + it.qty + ' x ' + formatAED(it.price) + '</span><span>' + formatAED(it.price * it.qty) + '</span></div>';
  }).join('');

  return '<div class="pr-header">' +
      '<div class="pr-shop-name">PAVNIKA BY SARANYA</div>' +
      '<div class="pr-shop-sub">Al Barsha South 4, Dubai</div>' +
      '<div class="pr-shop-sub">+971 52 66 30307</div>' +
    '</div>' +
    '<div class="pr-dashed">' +
      '<div>Bill No: ' + sale.bill_number + '</div>' +
      '<div>Date: ' + new Date(sale.created_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</div>' +
      '<div>Customer: ' + sale.customer_name + '</div>' +
      '<div>Sales Person: ' + (sale.sales_person || '') + '</div>' +
    '</div>' +
    '<div class="pr-dashed">' + itemLines + '</div>' +
    '<div class="pr-dashed">' +
      '<div class="pr-row"><span>Subtotal</span><span>' + formatAED(sale.subtotal) + '</span></div>' +
      (sale.discount_amount > 0 ? '<div class="pr-row"><span>Discount</span><span>-' + formatAED(sale.discount_amount) + '</span></div>' : '') +
      '<div class="pr-row"><span>VAT</span><span>N/A</span></div>' +
    '</div>' +
    '<div class="pr-total-row pr-row"><span>TOTAL</span><span>AED ' + formatAED(sale.total) + '</span></div>' +
    '<div class="pr-dashed">Payment Method: ' + (sale.payment_method || '') + '</div>' +
    '<div class="pr-dashed pr-barcode-wrap"><svg id="pr-barcode"></svg></div>' +
    '<div class="pr-footer">Thank you for shopping with us!</div>' +
    '<div class="pr-footer-small">Goods once sold are subject to</div>' +
    '<div class="pr-footer-small">our exchange/return policy.</div>';
}

function printSalesHistoryBill(id) {
  var sale = findHistorySale(id);
  if (!sale) return;
  document.getElementById('pos-print-receipt').innerHTML = buildHistoricalReceiptHtml(sale);
  renderReceiptBarcode(sale.bill_number);
  window.print();
}

function sendSalesHistoryWhatsApp(id) {
  var sale = findHistorySale(id);
  if (!sale || !sale.customer || !sale.customer.phone) { alert('No phone number on file for this customer.'); return; }

  var lines = [];
  lines.push('Hi ' + sale.customer.name + ', thank you for shopping with Pavnika by Saranya!');
  lines.push('');
  lines.push('Bill ' + sale.bill_number + ' \u00b7 ' + new Date(sale.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }));
  (sale.items || []).forEach(function (it) {
    lines.push(it.id + ' \u2014 ' + it.name + ' x' + it.qty + ' \u2014 AED ' + formatAED(it.price * it.qty));
  });
  if (sale.discount_amount > 0) lines.push('Discount: \u2212AED ' + formatAED(sale.discount_amount));
  lines.push('Total: AED ' + formatAED(sale.total));

  var fullPhone = (sale.customer.phone_country_code || '').replace('+', '') + sale.customer.phone;
  var waLink = 'https://wa.me/' + fullPhone + '?text=' + encodeURIComponent(lines.join('\n'));
  window.open(waLink, '_blank');
}

function processReturn() {
  var sale = returnState.selectedSale;
  var selectedItems = (sale.items || []).filter(function (it) { return returnState.selectedItemIds.indexOf(it.id) !== -1; });
  var errorEl = document.getElementById('pos-return-error');
  errorEl.textContent = '';

  var btn = document.getElementById('pos-return-process-btn');
  btn.disabled = true;
  btn.textContent = 'Processing...';

  fetch('/.netlify/functions/pos-process-return', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      posToken: getPosToken(),
      originalSaleId: sale.id,
      items: selectedItems,
      actionType: returnState.actionType,
      refundMethod: returnState.refundMethod
    })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      btn.textContent = 'Process';
      if (!result.ok) { btn.disabled = false; errorEl.textContent = result.data.error || 'Could not process this return.'; return; }

      returnState.lastResult = { refundAmount: result.data.refundAmount, items: selectedItems };
      document.getElementById('pos-return-done-amount').textContent = formatAED(result.data.refundAmount);
      document.getElementById('pos-return-receipt-box').style.display = 'block';
      document.getElementById('pos-return-process-btn').style.display = 'none';

      // Lock everything about this order's return/exchange choices —
      // item selection, action type, refund method — until Done is
      // pressed, since the return has already been processed and
      // changing any of these now wouldn't do anything meaningful.
      // Send Receipt stays active regardless.
      document.getElementById('pos-return-items-list').classList.add('pos-return-locked');
      document.querySelectorAll('.pos-return-action').forEach(function (el) { el.classList.add('pos-return-locked'); });
      document.getElementById('pos-return-refund-method-box').classList.add('pos-return-locked');

      var hasEmail = sale.customer && sale.customer.email;
      var emailBtn = document.getElementById('pos-return-email-btn');
      emailBtn.disabled = !hasEmail;
      emailBtn.textContent = hasEmail ? 'Send Receipt (Email)' : 'Send Receipt (no email on file)';
    })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = 'Process';
      errorEl.textContent = 'Could not reach the server. Please try again.';
    });
}

function sendReturnReceiptEmail() {
  var sale = returnState.selectedSale;
  var last = returnState.lastResult;
  var btn = document.getElementById('pos-return-email-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  fetch('/.netlify/functions/pos-send-refund-receipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      posToken: getPosToken(),
      email: sale.customer.email,
      billNumber: sale.bill_number,
      items: last.items,
      refundAmount: last.refundAmount,
      refundMethod: returnState.refundMethod,
      actionType: returnState.actionType
    })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      btn.disabled = false;
      btn.textContent = result.ok ? 'Receipt Sent \u2713' : 'Send Receipt (Email)';
      if (!result.ok) alert(result.data.error || 'Could not send the email.');
    })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = 'Send Receipt (Email)';
      alert('Could not reach the server. Please try again.');
    });
}

function sendReturnReceiptWhatsApp() {
  var sale = returnState.selectedSale;
  var last = returnState.lastResult;
  if (!sale.customer || !sale.customer.phone) { alert('No phone number on file for this customer.'); return; }

  var methodLabel = { gift_card: 'Gift Card credit', cash: 'Cash', bank_transfer: 'Bank Transfer' }[returnState.refundMethod] || returnState.refundMethod;
  var msg = 'Hi ' + sale.customer.name + ', your ' + (returnState.actionType === 'exchange' ? 'exchange' : 'return') +
    ' for Bill ' + sale.bill_number + ' has been processed. Refund: AED ' + formatAED(last.refundAmount) + ' via ' + methodLabel + '. \u2014 Pavnika by Saranya';
  var fullPhone = (sale.customer.phone_country_code || '').replace('+', '') + sale.customer.phone;
  var waLink = 'https://wa.me/' + fullPhone + '?text=' + encodeURIComponent(msg);
  window.open(waLink, '_blank');
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
  var preferredOrder = ['Budget', 'Mid Range', 'Premium', 'Bridal'];
  var cats = [];
  products.forEach(function (p) { if (p.category && cats.indexOf(p.category) === -1) cats.push(p.category); });
  cats.sort(function (a, b) {
    var ai = preferredOrder.indexOf(a), bi = preferredOrder.indexOf(b);
    if (ai === -1) ai = preferredOrder.length;
    if (bi === -1) bi = preferredOrder.length;
    return ai - bi;
  });
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
    posState.cart.push({ id: item.id, name: itemDisplayName(item), price: item.price, qty: posState.currentQty, image: item.image || '', dupeWarning: false, sold: !!item.sold });
  }
  renderCart();
  refreshStepLocks();

  clearItemFields();
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
      var warnClass = (c.dupeWarning || c.sold) ? (c.sold ? ' pos-sold-warning' : ' pos-dupe-warning') : '';
      var dupeNote = c.dupeWarning ? '<div class="ci-sub" style="color:#B8142A;">Added twice separately \u2014 check this is intended</div>' : '';
      return '<div class="pos-cart-item' + warnClass + '">' + imgTag +
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
  listEl.scrollTop = listEl.scrollHeight;
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
  var selectedId = posState.selectedCustomer ? posState.selectedCustomer.id : null;
  listEl.innerHTML = customers.map(function (c) {
    return '<div class="cust-list-item' + (c.id === selectedId ? ' selected' : '') + '" data-cust-id="' + c.id + '">' +
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
  // Show a loading state immediately, so a slow request never leaves
  // the previous customer's numbers on screen where they could be
  // mistaken for the newly-selected customer's actual balance.
  ['pos-cust-summary-purchases', 'pos-cust-summary-spent', 'pos-cust-summary-visit', 'pos-cust-summary-points', 'pos-cust-summary-giftcard'].forEach(function (id) {
    document.getElementById(id).textContent = 'Fetching...';
  });
  document.getElementById('pos-cust-summary-giftcard').classList.remove('has-balance');

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
      document.getElementById('pos-cust-summary-points').textContent = data.loyaltyPoints || 0;
      var giftBalance = data.giftCardBalance || 0;
      // Keep the cached customer object in sync too, so anything else
      // that reads posState.selectedCustomer.gift_card_balance (like
      // the gift card redemption modals) also sees the current value.
      if (posState.selectedCustomer) {
        posState.selectedCustomer.gift_card_balance = giftBalance;
        posState.selectedCustomer.loyalty_points = data.loyaltyPoints || 0;
      }
      var giftEl = document.getElementById('pos-cust-summary-giftcard');
      giftEl.textContent = 'AED ' + formatAED(giftBalance);
      giftEl.classList.toggle('has-balance', giftBalance > 0);
    })
    .catch(function (e) {
      console.error('customer summary error:', e);
      ['pos-cust-summary-purchases', 'pos-cust-summary-spent', 'pos-cust-summary-visit', 'pos-cust-summary-points', 'pos-cust-summary-giftcard'].forEach(function (id) {
        document.getElementById(id).textContent = 'Error';
      });
    });
}

function selectCustomer(customer) {
  posState.selectedCustomer = customer;
  document.querySelectorAll('.cust-list-item').forEach(function (el) {
    el.classList.toggle('selected', el.getAttribute('data-cust-id') === customer.id);
  });
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
  document.getElementById('pos-cust-code').value = '+971';
  document.getElementById('pos-cust-email').value = '';
  document.getElementById('pos-cust-address').value = '';
  document.getElementById('pos-cust-error').textContent = '';
  document.getElementById('pos-cust-summary-purchases').textContent = 'N/A';
  document.getElementById('pos-cust-summary-spent').textContent = 'N/A';
  document.getElementById('pos-cust-summary-visit').textContent = 'N/A';
  document.getElementById('pos-cust-summary-points').textContent = 'N/A';
  document.getElementById('pos-cust-summary-giftcard').textContent = 'N/A';
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
      recentCustomersCache.unshift(result.data.customer);
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

function calculateCouponDiscount(subtotal) {
  if (!posState.couponCode) return 0;
  return subtotal * (posState.couponDiscountPercent / 100);
}

function recalcBillingTotals() {
  var subtotal = cartTotal();
  var discountAmount = calculateDiscountAmount(subtotal);
  var loyaltyAmount = calculateLoyaltyDiscount();
  var couponAmount = calculateCouponDiscount(subtotal);
  var grandTotal = Math.max(0, subtotal - discountAmount - loyaltyAmount - couponAmount);

  document.getElementById('pos-bill-subtotal').textContent = 'AED ' + formatAED(subtotal);
  document.getElementById('pos-grand-total').textContent = 'AED ' + formatAED(grandTotal);

  var summaryRow = document.getElementById('pos-discount-summary-row');
  var totalDiscountShown = discountAmount + couponAmount;
  if (totalDiscountShown > 0) {
    summaryRow.style.display = 'flex';
    var hasManualDiscount = posState.discountValue > 0;
    var label;
    if (hasManualDiscount && posState.couponCode) {
      label = 'Discount + Coupon';
    } else if (posState.couponCode) {
      label = 'Coupon (' + posState.couponCode + ')';
    } else {
      label = posState.discountType === 'percent' ? 'Discount (' + posState.discountValue + '%)' : 'Discount';
    }
    document.getElementById('pos-discount-summary-label').textContent = label;
    document.getElementById('pos-discount-summary-value').textContent = '\u2212 AED ' + formatAED(totalDiscountShown);
  } else {
    summaryRow.style.display = 'none';
  }

  return { subtotal: subtotal, discountAmount: discountAmount, loyaltyAmount: loyaltyAmount, couponAmount: couponAmount, grandTotal: grandTotal };
}

function renderBillItems() {
  var el = document.getElementById('pos-bill-items');
  el.innerHTML = posState.cart.map(function (c) {
    var imgTag = c.image ? '<img src="' + c.image + '">' : '<div style="width:42px;height:54px;border-radius:6px;background:var(--ivory-deep);flex-shrink:0;"></div>';
    var soldClass = c.sold ? ' pos-sold-warning' : '';
    var soldNote = c.sold ? '<div class="ci-sub" style="color:#B8142A; font-weight:600;">Out of stock \u2014 check before proceeding</div>' : '';
    return '<div class="pos-cart-item' + soldClass + '">' + imgTag +
      '<div class="ci-info"><div class="ci-name">' + c.id + ' \u2014 ' + c.name + '</div>' +
      '<div class="ci-sub">Qty ' + c.qty + '</div>' + soldNote + '</div>' +
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

function openDiscountModal() {
  document.getElementById('pos-discount-modal-value').value = String(posState.discountValue || 0);
  document.getElementById('pos-discount-modal').classList.add('open');
  var input = document.getElementById('pos-discount-modal-value');
  input.focus();
  input.select();
}

function applyCoupon() {
  var code = document.getElementById('pos-coupon-code').value.trim();
  var errorEl = document.getElementById('pos-coupon-error');
  errorEl.textContent = '';
  if (!code) { errorEl.textContent = 'Enter a code first.'; return; }

  var btn = document.getElementById('pos-coupon-apply-btn');
  btn.disabled = true;
  btn.textContent = '...';

  fetch('/.netlify/functions/validate-promo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code })
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      btn.disabled = false;
      btn.textContent = 'Apply';
      if (!data.valid) { errorEl.textContent = data.error || 'Invalid code.'; return; }
      posState.couponCode = data.code;
      posState.couponDiscountPercent = data.discountPercent;
      document.getElementById('pos-coupon-applied-text').textContent = data.code + ' \u2014 ' + data.discountPercent + '% off';
      document.getElementById('pos-coupon-applied').style.display = 'flex';
      document.getElementById('pos-coupon-code').value = '';
      recalcBillingTotals();
    })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = 'Apply';
      errorEl.textContent = 'Could not reach the server. Please try again.';
    });
}

function removeCoupon() {
  posState.couponCode = null;
  posState.couponDiscountPercent = 0;
  document.getElementById('pos-coupon-applied').style.display = 'none';
  recalcBillingTotals();
}

function holdCurrentSale() {
  if (!posState.cart.length) { alert('Nothing to hold \u2014 the cart is empty.'); return; }
  var btn = document.getElementById('pos-bill-hold-btn');
  btn.disabled = true;
  btn.textContent = 'Holding...';

  fetch('/.netlify/functions/pos-hold-sale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      posToken: getPosToken(),
      cart: posState.cart,
      customer: posState.selectedCustomer,
      discountType: posState.discountType,
      discountValue: posState.discountValue,
      couponCode: posState.couponCode,
      notes: document.getElementById('pos-bill-notes').value.trim() || null
    })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      btn.disabled = false;
      btn.textContent = 'Hold / Park Sale';
      if (!result.ok) { alert(result.data.error || 'Could not park this sale.'); return; }
      alert('Sale parked. You can resume it from the Hold/Parked Sales page.');
      resetTransaction();
    })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = 'Hold / Park Sale';
      alert('Could not reach the server. Please try again.');
    });
}

function commitDiscountValue() {
  var raw = document.getElementById('pos-discount-modal-value').value;
  posState.discountValue = parseFloat(raw) || 0;
  document.getElementById('pos-discount-value').value = String(posState.discountValue);
  document.getElementById('pos-discount-modal').classList.remove('open');
  recalcBillingTotals();
}

function setModalDiscountValue(newValueStr) {
  if (newValueStr.length > 8) return;
  if ((newValueStr.match(/\./g) || []).length > 1) return;
  document.getElementById('pos-discount-modal-value').value = newValueStr || '0';
}

function handleKeypadPress(key) {
  var current = document.getElementById('pos-discount-modal-value').value;
  if (key === 'clear') { setModalDiscountValue('0'); return; }
  if (key === 'back') { setModalDiscountValue(current.length > 1 ? current.slice(0, -1) : '0'); return; }
  var next = (current === '0' && key !== '.') ? key : current + key;
  setModalDiscountValue(next);
}

// ---------- Payment (Step 4) ----------

function renderPaymentStep() {
  if (!posState.billNumber) fetchBillNumber();
  var totals = recalcBillingTotals();
  document.getElementById('pos-pay-subtotal').textContent = 'AED ' + formatAED(totals.subtotal);
  document.getElementById('pos-pay-total').textContent = 'AED ' + formatAED(totals.grandTotal);

  var discountRow = document.getElementById('pos-pay-discount-row');
  var totalDiscount = totals.discountAmount + totals.loyaltyAmount + totals.couponAmount;
  if (totalDiscount > 0) {
    discountRow.style.display = 'flex';
    document.getElementById('pos-pay-discount-value').textContent = '\u2212 AED ' + formatAED(totalDiscount);
  } else {
    discountRow.style.display = 'none';
  }

  posState.paymentMethod = 'Cash';
  posState.amountReceived = totals.grandTotal;
  posState.paymentMode = 'single';
  posState.splitPayments = [];
  posState.giftCardRedeemed = 0;
  splitSelectedMethod = 'Cash';
  document.getElementById('pos-single-giftcard-info').style.display = 'none';
  document.getElementById('pos-single-payment-error').textContent = '';
  document.querySelectorAll('#pos-single-payment-block .pay-method').forEach(function (p) { p.classList.toggle('active', p.getAttribute('data-method') === 'Cash'); });
  document.getElementById('pos-pay-reference').value = '';
  document.getElementById('pos-single-payment-block').style.display = 'block';
  document.getElementById('pos-split-payment-block').style.display = 'none';
  document.querySelectorAll('[data-pmode]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-pmode') === 'single'); });
  document.querySelectorAll('#pos-split-method-buttons .pay-method').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-splitmethod') === 'Cash'); });
  document.getElementById('pos-split-giftcard-balance').style.display = 'none';

  var hasGiftBalance = posState.selectedCustomer && (posState.selectedCustomer.gift_card_balance || 0) > 0;
  document.getElementById('pos-single-giftcard-tile').classList.toggle('disabled', !hasGiftBalance);
  document.getElementById('pos-split-giftcard-tile').classList.toggle('disabled', !hasGiftBalance);
  renderSplitRows();
  lockPaymentConfirmation();
  document.getElementById('pos-payment-error').textContent = '';
  posState.printedOrSent = false;

  var sendBtn = document.getElementById('pos-send-btn');
  var hasPhone = posState.selectedCustomer && posState.selectedCustomer.phone;
  sendBtn.querySelector('.btn-label').textContent = hasPhone ? 'Send Bill (WhatsApp)' : 'Send Bill (no phone on file)';
}

// ---------- Split payment ----------

function splitTotal() {
  return posState.splitPayments.reduce(function (sum, p) { return sum + p.amount; }, 0);
}

function renderSplitRows() {
  var el = document.getElementById('pos-split-rows');
  var totals = recalcBillingTotals();
  var remaining = totals.grandTotal - splitTotal();

  if (!posState.splitPayments.length) {
    el.innerHTML = '<p class="pos-empty-note">No payment methods added yet.</p>';
  } else {
    el.innerHTML = posState.splitPayments.map(function (p, i) {
      return '<div class="pos-split-row"><span class="psr-method">' + p.method + '</span>' +
        '<span class="psr-amount">AED ' + formatAED(p.amount) + '</span>' +
        '<button type="button" class="psr-remove" data-split-remove="' + i + '">&times;</button></div>';
    }).join('');
    el.querySelectorAll('[data-split-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-split-remove'), 10);
        var removed = posState.splitPayments[idx];
        if (removed && removed.method === 'Gift Card') {
          posState.giftCardRedeemed = Math.max(0, posState.giftCardRedeemed - removed.amount);
        }
        posState.splitPayments.splice(idx, 1);
        lockPaymentConfirmation();
        renderSplitRows();
        updateSplitGiftCardBalanceDisplay();
      });
    });
  }

  var remainingEl = document.getElementById('pos-split-remaining');
  remainingEl.textContent = 'AED ' + formatAED(remaining);
  remainingEl.style.color = remaining < 0 ? '#B8142A' : (remaining === 0 ? '#2c5c37' : 'inherit');
}

function openSplitAmountModal() {
  document.getElementById('pos-split-amount-modal-value').value = '0';
  document.getElementById('pos-split-amount-modal').classList.add('open');
  var input = document.getElementById('pos-split-amount-modal-value');
  input.focus();
  input.select();
}

function setSplitAmountModalValue(newValueStr) {
  if (newValueStr.length > 8) return;
  if ((newValueStr.match(/\./g) || []).length > 1) return;
  document.getElementById('pos-split-amount-modal-value').value = newValueStr || '0';
}

function handleSplitAmountKeypad(key) {
  var current = document.getElementById('pos-split-amount-modal-value').value;
  if (key === 'clear') { setSplitAmountModalValue('0'); return; }
  if (key === 'back') { setSplitAmountModalValue(current.length > 1 ? current.slice(0, -1) : '0'); return; }
  var next = (current === '0' && key !== '.') ? key : current + key;
  setSplitAmountModalValue(next);
}

function commitSplitAmountModal() {
  var raw = document.getElementById('pos-split-amount-modal-value').value;
  document.getElementById('pos-split-amount-input').value = raw;
  document.getElementById('pos-split-amount-modal').classList.remove('open');
}

// ---------- Gift card redemption (via "Other") ----------

var giftCardModalContext = 'split'; // gift card modal is only ever opened from split mode now
var splitSelectedMethod = 'Cash'; // tracks the active split-method button, replacing the removed dropdown

function updateSplitGiftCardBalanceDisplay() {
  var balanceEl = document.getElementById('pos-split-giftcard-balance');
  if (splitSelectedMethod === 'Gift Card' && posState.selectedCustomer) {
    var rawBalance = posState.selectedCustomer.gift_card_balance || 0;
    var remaining = rawBalance - (posState.giftCardRedeemed || 0);
    balanceEl.textContent = 'Available balance: AED ' + formatAED(remaining);
    balanceEl.style.display = 'block';
  } else {
    balanceEl.style.display = 'none';
  }
}

function openGiftCardModal(context) {
  if (!posState.selectedCustomer) {
    alert('Select a customer first \u2014 a gift card can only be redeemed against a known customer.');
    return;
  }
  giftCardModalContext = context;
  var balance = posState.selectedCustomer.gift_card_balance || 0;
  document.getElementById('pos-giftcard-balance').textContent = 'AED ' + formatAED(balance);
  document.getElementById('pos-giftcard-modal-value').value = '0';
  document.getElementById('pos-giftcard-error').textContent = '';
  document.getElementById('pos-giftcard-modal').classList.add('open');
  var input = document.getElementById('pos-giftcard-modal-value');
  input.focus();
  input.select();
}

function setGiftCardModalValue(newValueStr) {
  if (newValueStr.length > 8) return;
  if ((newValueStr.match(/\./g) || []).length > 1) return;
  document.getElementById('pos-giftcard-modal-value').value = newValueStr || '0';
}

function handleGiftCardKeypad(key) {
  var current = document.getElementById('pos-giftcard-modal-value').value;
  if (key === 'clear') { setGiftCardModalValue('0'); return; }
  if (key === 'back') { setGiftCardModalValue(current.length > 1 ? current.slice(0, -1) : '0'); return; }
  var next = (current === '0' && key !== '.') ? key : current + key;
  setGiftCardModalValue(next);
}

function commitGiftCardModal() {
  var amount = parseFloat(document.getElementById('pos-giftcard-modal-value').value) || 0;
  var rawBalance = posState.selectedCustomer.gift_card_balance || 0;
  var remainingBalance = rawBalance - (posState.giftCardRedeemed || 0);
  var errorEl = document.getElementById('pos-giftcard-error');

  if (amount <= 0) { errorEl.textContent = 'Enter an amount to redeem.'; return; }
  if (amount > remainingBalance) { errorEl.textContent = 'That exceeds the available balance of AED ' + formatAED(remainingBalance) + '.'; return; }

  posState.giftCardRedeemed += amount;
  posState.splitPayments.push({ method: 'Gift Card', amount: amount });
  renderSplitRows();
  lockPaymentConfirmation();
  updateSplitGiftCardBalanceDisplay();

  document.getElementById('pos-giftcard-modal').classList.remove('open');
}

function addSplitRow() {
  var method = splitSelectedMethod;
  var amount = parseFloat(document.getElementById('pos-split-amount-input').value);
  if (!amount || amount <= 0) { alert('Enter a valid amount first.'); return; }
  posState.splitPayments.push({ method: method, amount: amount });
  document.getElementById('pos-split-amount-input').value = '';
  lockPaymentConfirmation();
  renderSplitRows();
}

// ---------- Confirm payment ----------

function lockPaymentConfirmation() {
  posState.paymentConfirmed = false;
  document.getElementById('pos-confirm-payment-btn').disabled = false;
  document.getElementById('pos-print-btn').disabled = true;
  document.getElementById('pos-send-btn').disabled = true;
  document.getElementById('pos-complete-sale-btn').disabled = true;
  renderPaymentBreakup();
}

function renderPaymentBreakup() {
  var totals = recalcBillingTotals();
  var el = document.getElementById('pos-payment-breakup');
  var rows = [];

  if (posState.paymentMode === 'split') {
    posState.splitPayments.forEach(function (p) {
      rows.push('<div class="pos-breakup-row"><span>' + p.method + '</span><span>AED ' + formatAED(p.amount) + '</span></div>');
    });
    var remaining = totals.grandTotal - splitTotal();
    if (Math.abs(remaining) > 0.001) {
      var label = remaining > 0 ? 'Remaining' : 'Over by';
      rows.push('<div class="pos-breakup-row" style="color:' + (remaining > 0 ? '#8a7266' : '#B8142A') + '; font-weight:700;"><span>' + label + '</span><span>AED ' + formatAED(Math.abs(remaining)) + '</span></div>');
    }
  } else {
    rows.push('<div class="pos-breakup-row"><span>' + posState.paymentMethod + '</span><span>AED ' + formatAED(posState.amountReceived) + '</span></div>');
  }
  el.innerHTML = rows.join('');
}

// Placeholder for the real card machine integration, to be discussed
// and wired up later. For now this just makes the integration point
// explicit and visible — every Card amount, whether the sole payment
// method or one line within a split, passes through here.
function sendToCardMachine(amount) {
  console.log('[Card Machine] Would send AED ' + formatAED(amount) + ' to the card terminal.');
  // TODO: replace with the real card machine integration once decided.
}

function showPaymentErrorModal(message) {
  document.getElementById('pos-payment-error-modal-text').textContent = message;
  document.getElementById('pos-payment-error-modal').classList.add('open');
}

function confirmPayment() {
  var errorEl = document.getElementById('pos-payment-error');
  errorEl.textContent = '';
  var totals = recalcBillingTotals();

  if (posState.paymentMode === 'split') {
    var diff = Math.round((splitTotal() - totals.grandTotal) * 100) / 100;
    if (diff !== 0) {
      var msg = diff > 0 ? 'Split payments exceed the total by AED ' + formatAED(diff) + '.' : 'Split payments are short by AED ' + formatAED(-diff) + '.';
      errorEl.textContent = msg;
      showPaymentErrorModal(msg);
      return;
    }
    if (!posState.splitPayments.length) { errorEl.textContent = 'Add at least one payment method.'; showPaymentErrorModal('Add at least one payment method.'); return; }
  } else {
    if (posState.paymentMethod === 'Cash' && posState.amountReceived < totals.grandTotal) {
      var shortMsg = 'Amount received (AED ' + formatAED(posState.amountReceived) + ') is less than the total due (AED ' + formatAED(totals.grandTotal) + ').';
      errorEl.textContent = shortMsg;
      showPaymentErrorModal(shortMsg);
      return;
    }
  }

  // Card machine hand-off — happens once payment is confirmed, for
  // every Card amount involved, whether single or split.
  if (posState.paymentMode === 'split') {
    posState.splitPayments.forEach(function (p) {
      if (p.method === 'Card') sendToCardMachine(p.amount);
    });
  } else if (posState.paymentMethod === 'Card') {
    sendToCardMachine(posState.amountReceived);
  }

  posState.paymentConfirmed = true;
  document.getElementById('pos-confirm-payment-btn').disabled = true;
  document.getElementById('pos-print-btn').disabled = false;
  var hasPhone = posState.selectedCustomer && posState.selectedCustomer.phone;
  document.getElementById('pos-send-btn').disabled = !hasPhone;
  document.getElementById('pos-complete-sale-btn').disabled = false;
  renderPaymentBreakup();

  // Email is sent automatically on confirmation. WhatsApp is never
  // sent automatically — if there's no email on file, the popup
  // offers an explicit "Send WhatsApp" choice instead, since opening
  // WhatsApp on someone's behalf without asking isn't appropriate.
  var channelNote;
  var offerWhatsAppChoice = false;
  if (posState.selectedCustomer && posState.selectedCustomer.email) {
    sendBillEmail();
    channelNote = 'Receipt emailed to ' + posState.selectedCustomer.email;
  } else if (hasPhone) {
    channelNote = 'No email on file for this customer.';
    offerWhatsAppChoice = true;
  } else {
    channelNote = 'No email or phone on file \u2014 receipt not sent automatically';
  }

  showPaymentConfirmedModal(channelNote, offerWhatsAppChoice);
}

function showPaymentConfirmedModal(channelNote, offerWhatsAppChoice) {
  var totals = recalcBillingTotals();
  document.getElementById('pos-pc-customer').textContent = posState.selectedCustomer ? posState.selectedCustomer.name : 'Walk-in Customer';
  document.getElementById('pos-pc-phone').textContent = posState.selectedCustomer ? ((posState.selectedCustomer.phone_country_code || '') + ' ' + posState.selectedCustomer.phone) : '\u2014';
  document.getElementById('pos-pc-bill').textContent = posState.billNumber || '';
  document.getElementById('pos-pc-amount').textContent = 'AED ' + formatAED(totals.grandTotal);
  document.getElementById('pos-pc-channel-note').textContent = channelNote;
  document.getElementById('pos-pc-ok-actions').style.display = offerWhatsAppChoice ? 'none' : 'flex';
  document.getElementById('pos-pc-whatsapp-actions').style.display = offerWhatsAppChoice ? 'flex' : 'none';
  document.getElementById('pos-payment-confirmed-modal').classList.add('open');
}

function buildPrintReceiptHtml() {
  var totals = recalcBillingTotals();
  var custName = posState.selectedCustomer ? posState.selectedCustomer.name : 'Walk-in Customer';
  var salesPerson = posState.transactionSalesPerson || localStorage.getItem(POS_NAME_KEY) || '';
  var paymentMethodLabel = posState.paymentMode === 'split' ? 'Split Payment' : posState.paymentMethod;
  var totalDiscount = totals.discountAmount + totals.loyaltyAmount + totals.couponAmount;

  var itemLines = posState.cart.map(function (c) {
    return '<div>' + c.id + ' ' + c.name + '</div>' +
      '<div class="pr-row"><span>' + c.qty + ' x ' + formatAED(c.price) + '</span><span>' + formatAED(c.price * c.qty) + '</span></div>';
  }).join('');

  return '<div class="pr-header">' +
      '<div class="pr-shop-name">PAVNIKA BY SARANYA</div>' +
      '<div class="pr-shop-sub">Al Barsha South 4, Dubai</div>' +
      '<div class="pr-shop-sub">+971 52 66 30307</div>' +
    '</div>' +
    '<div class="pr-dashed">' +
      '<div>Bill No: ' + (posState.billNumber || '') + '</div>' +
      '<div>Date: ' + new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</div>' +
      '<div>Customer: ' + custName + '</div>' +
      '<div>Sales Person: ' + salesPerson + '</div>' +
    '</div>' +
    '<div class="pr-dashed">' + itemLines + '</div>' +
    '<div class="pr-dashed">' +
      '<div class="pr-row"><span>Subtotal</span><span>' + formatAED(totals.subtotal) + '</span></div>' +
      (totalDiscount > 0 ? '<div class="pr-row"><span>Discount</span><span>-' + formatAED(totalDiscount) + '</span></div>' : '') +
      '<div class="pr-row"><span>VAT</span><span>N/A</span></div>' +
    '</div>' +
    '<div class="pr-total-row pr-row"><span>TOTAL</span><span>AED ' + formatAED(totals.grandTotal) + '</span></div>' +
    '<div class="pr-dashed">Payment Method: ' + paymentMethodLabel + '</div>' +
    '<div class="pr-dashed pr-barcode-wrap"><svg id="pr-barcode"></svg></div>' +
    '<div class="pr-footer">Thank you for shopping with us!</div>' +
    '<div class="pr-footer-small">Goods once sold are subject to</div>' +
    '<div class="pr-footer-small">our exchange/return policy.</div>';
}

function renderReceiptBarcode(billNumber) {
  try {
    if (typeof JsBarcode === 'undefined') throw new Error('JsBarcode not loaded');
    JsBarcode('#pr-barcode', billNumber || '', {
      format: 'CODE128',
      width: 1.6,
      height: 40,
      displayValue: true,
      fontSize: 12,
      margin: 0
    });
  } catch (e) {
    console.error('barcode generation failed, falling back to plain text:', e);
    var el = document.getElementById('pr-barcode');
    if (el) el.outerHTML = '<div style="font-size:11px; letter-spacing:1px;">' + (billNumber || '') + '</div>';
  }
}

function printBill() {
  document.getElementById('pos-print-receipt').innerHTML = buildPrintReceiptHtml();
  renderReceiptBarcode(posState.billNumber);
  posState.printedOrSent = true;
  window.print();
}

function buildWhatsAppReceiptMessage() {
  var totals = recalcBillingTotals();
  var totalDiscount = totals.discountAmount + totals.loyaltyAmount + totals.couponAmount;
  var billDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

  var lines = [];
  lines.push('Hi ' + posState.selectedCustomer.name + ', thank you for shopping with Pavnika by Saranya!');
  lines.push('');
  lines.push('Bill ' + (posState.billNumber || '') + ' \u00b7 ' + billDate);
  posState.cart.forEach(function (c) {
    lines.push(c.id + ' \u2014 ' + c.name + ' x' + c.qty + ' \u2014 AED ' + formatAED(c.price * c.qty));
  });
  if (totalDiscount > 0) {
    lines.push('Discount: \u2212AED ' + formatAED(totalDiscount));
  }
  lines.push('Total: AED ' + formatAED(totals.grandTotal));

  return lines.join('\n');
}

function openWhatsAppReceipt() {
  if (!posState.selectedCustomer || !posState.selectedCustomer.phone) return false;
  var msg = buildWhatsAppReceiptMessage();
  var fullPhone = (posState.selectedCustomer.phone_country_code || '').replace('+', '') + posState.selectedCustomer.phone;
  var waLink = 'https://wa.me/' + fullPhone + '?text=' + encodeURIComponent(msg);
  window.open(waLink, '_blank');
  posState.printedOrSent = true;
  return true;
}

function sendBillWhatsApp() {
  var errorEl = document.getElementById('pos-payment-error');
  errorEl.textContent = '';
  var sent = openWhatsAppReceipt();
  if (!sent) errorEl.textContent = 'No phone number on file for this customer.';
}

function sendBillEmail() {
  if (!posState.selectedCustomer || !posState.selectedCustomer.email) return false;

  var totals = recalcBillingTotals();
  fetch('/.netlify/functions/pos-send-bill-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      posToken: getPosToken(),
      email: posState.selectedCustomer.email,
      billNumber: posState.billNumber,
      customerName: posState.selectedCustomer.name,
      salesPerson: posState.transactionSalesPerson || localStorage.getItem(POS_NAME_KEY) || '',
      billDate: new Date().toISOString(),
      paymentMethod: posState.paymentMode === 'split' ? 'Split Payment' : posState.paymentMethod,
      items: posState.cart,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount + totals.loyaltyAmount + totals.couponAmount,
      total: totals.grandTotal
    })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      if (!result.ok) {
        var errorEl = document.getElementById('pos-payment-error');
        errorEl.textContent = result.data.error || 'Could not send email.';
      }
    })
    .catch(function (e) { console.error('send bill email error:', e); });

  posState.printedOrSent = true;
  return true;
}

function manualSendBillEmail() {
  var errorEl = document.getElementById('pos-payment-error');
  errorEl.textContent = '';
  var btn = document.getElementById('pos-send-btn');
  btn.querySelector('.btn-label').textContent = 'Sending...';
  var sent = sendBillEmail();
  if (!sent) {
    errorEl.textContent = 'No email address on file for this customer.';
    btn.querySelector('.btn-label').textContent = 'Send Bill (Email)';
  }
}

function completeSale() {
  if (!posState.paymentConfirmed) { alert('Please confirm payment first.'); return; }
  var totals = recalcBillingTotals();
  var errorEl = document.getElementById('pos-payment-error');
  errorEl.textContent = '';

  var btn = document.getElementById('pos-complete-sale-btn');
  btn.disabled = true;
  btn.querySelector('.btn-label').textContent = 'Saving...';

  var paymentMethodSummary = posState.paymentMode === 'split'
    ? 'Split: ' + posState.splitPayments.map(function (p) { return p.method; }).join(', ')
    : posState.paymentMethod;

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
      paymentMethod: paymentMethodSummary,
      paymentBreakdown: posState.paymentMode === 'split' ? posState.splitPayments : [{ method: posState.paymentMethod, amount: posState.amountReceived }],
      amountReceived: posState.paymentMode === 'split' ? totals.grandTotal : posState.amountReceived,
      referenceId: document.getElementById('pos-pay-reference').value.trim() || null,
      salesPersonOverride: posState.transactionSalesPerson || null,
      couponCode: posState.couponCode || null,
      giftCardRedeemed: posState.giftCardRedeemed || 0,
      notes: document.getElementById('pos-bill-notes').value.trim() || null
    })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      btn.disabled = false;
      btn.querySelector('.btn-label').textContent = 'Complete Sale';
      if (!result.ok) { errorEl.textContent = result.data.error || 'Could not complete the sale.'; return; }
      alert('Sale completed! Bill number: ' + result.data.billNumber);
      resetTransaction();
    })
    .catch(function (e) {
      btn.disabled = false;
      btn.querySelector('.btn-label').textContent = 'Complete Sale';
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
  posState.couponCode = null;
  posState.couponDiscountPercent = 0;
  posState.giftCardRedeemed = 0;
  posState.paymentConfirmed = false;
  document.getElementById('pos-discount-value').value = '0';
  document.querySelectorAll('.discount-toggle button[data-dtype]').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-dtype') === 'percent');
  });
  document.getElementById('pos-coupon-applied').style.display = 'none';
  document.getElementById('pos-coupon-code').value = '';
  document.getElementById('pos-coupon-error').textContent = '';
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

  document.getElementById('pos-return-search').addEventListener('input', function (e) {
    searchOriginalSales(e.target.value.trim());
  });
  document.getElementById('pos-return-scan-btn').addEventListener('click', function () {
    var input = document.getElementById('pos-return-search');
    input.value = '';
    searchOriginalSales('');
    input.focus();
  });
  document.querySelectorAll('.pos-return-action').forEach(function (el) {
    el.addEventListener('click', function () {
      if (!returnState.selectedItemIds.length) {
        alert('Select at least one item to return or exchange first.');
        return;
      }
      document.querySelectorAll('.pos-return-action').forEach(function (a) { a.classList.remove('active'); });
      el.classList.add('active');
      returnState.actionType = el.getAttribute('data-action');
      returnState.refundMethod = null;
      document.querySelectorAll('#pos-return-refund-method .seg-btn').forEach(function (b) { b.classList.remove('active'); });
      updateReturnRefundPreview();
    });
  });
  document.getElementById('pos-return-process-btn').addEventListener('click', processReturn);
  document.querySelectorAll('#pos-return-refund-method .seg-btn').forEach(function (el) {
    el.addEventListener('click', function () {
      document.querySelectorAll('#pos-return-refund-method .seg-btn').forEach(function (b) { b.classList.remove('active'); });
      el.classList.add('active');
      returnState.refundMethod = el.getAttribute('data-refund-method');
      updateReturnRefundPreview();
    });
  });
  document.getElementById('pos-return-email-btn').addEventListener('click', sendReturnReceiptEmail);
  document.getElementById('pos-return-whatsapp-btn').addEventListener('click', sendReturnReceiptWhatsApp);
  document.getElementById('pos-return-done-btn').addEventListener('click', loadReturnPage);

  updatePosDatetime();
  setInterval(updatePosDatetime, 30000);

  document.querySelectorAll('.nav-link[data-step]').forEach(function (el) {
    el.addEventListener('click', function () { showStep(parseInt(el.getAttribute('data-step'), 10)); });
  });
  document.querySelectorAll('.nav-link[data-page]').forEach(function (el) {
    el.addEventListener('click', function () { showPage(el.getAttribute('data-page')); });
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
  document.querySelectorAll('.discount-toggle button[data-dtype]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.discount-toggle button[data-dtype]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      posState.discountType = btn.getAttribute('data-dtype');
      posState.discountValue = 0; // reset on switching, so "50" isn't misread as the wrong unit
      document.getElementById('pos-discount-value').value = '0';
      recalcBillingTotals();
    });
  });
  document.getElementById('pos-discount-value').addEventListener('click', openDiscountModal);
  document.getElementById('pos-discount-modal-value').addEventListener('input', function (e) {
    var cleaned = e.target.value.replace(/[^0-9.]/g, '');
    var parts = cleaned.split('.');
    if (parts.length > 2) cleaned = parts[0] + '.' + parts.slice(1).join('');
    setModalDiscountValue(cleaned || '0');
  });
  document.getElementById('pos-discount-modal-cancel').addEventListener('click', function () {
    document.getElementById('pos-discount-modal').classList.remove('open');
  });
  document.getElementById('pos-discount-modal-done').addEventListener('click', commitDiscountValue);
  document.querySelectorAll('[data-kp]').forEach(function (btn) {
    btn.addEventListener('click', function () { handleKeypadPress(btn.getAttribute('data-kp')); });
  });
  document.getElementById('pos-loyalty-redeem-btn').addEventListener('click', toggleLoyaltyRedeem);
  document.getElementById('pos-bill-add-item-btn').addEventListener('click', function () { showStep(1); });
  document.getElementById('pos-bill-hold-btn').addEventListener('click', holdCurrentSale);
  document.getElementById('pos-coupon-apply-btn').addEventListener('click', applyCoupon);
  document.getElementById('pos-coupon-remove-btn').addEventListener('click', removeCoupon);

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
  document.querySelectorAll('#pos-single-payment-block .pay-method').forEach(function (el) {
    el.addEventListener('click', function () {
      if (el.classList.contains('disabled')) return; // Card — not wired up yet
      var method = el.getAttribute('data-method');
      var errorEl = document.getElementById('pos-single-payment-error');
      var giftInfoEl = document.getElementById('pos-single-giftcard-info');
      errorEl.textContent = '';
      giftInfoEl.style.display = 'none';
      var totals = recalcBillingTotals();

      if (method === 'Gift Card') {
        if (!posState.selectedCustomer) { errorEl.textContent = 'Select a customer first to use their gift card.'; return; }
        var balance = posState.selectedCustomer.gift_card_balance || 0;
        if (balance < totals.grandTotal) {
          errorEl.textContent = 'Gift card balance (AED ' + formatAED(balance) + ') doesn\u2019t cover the full amount (AED ' + formatAED(totals.grandTotal) + '). Use Split Payment to combine it with another method.';
          return;
        }
        posState.giftCardRedeemed = totals.grandTotal;
        giftInfoEl.textContent = 'Gift Card Balance: AED ' + formatAED(balance) + '  \u2022  Remaining after this purchase: AED ' + formatAED(balance - totals.grandTotal);
        giftInfoEl.style.display = 'block';
      } else {
        posState.giftCardRedeemed = 0;
      }

      document.querySelectorAll('#pos-single-payment-block .pay-method').forEach(function (p) { p.classList.remove('active'); });
      el.classList.add('active');
      posState.paymentMethod = method;
      posState.amountReceived = totals.grandTotal;
      lockPaymentConfirmation();
    });
  });
  document.querySelectorAll('[data-pmode]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-pmode]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      posState.paymentMode = btn.getAttribute('data-pmode');
      document.getElementById('pos-single-payment-block').style.display = posState.paymentMode === 'single' ? 'block' : 'none';
      document.getElementById('pos-split-payment-block').style.display = posState.paymentMode === 'split' ? 'flex' : 'none';
      lockPaymentConfirmation();
    });
  });
  document.getElementById('pos-split-add-btn').addEventListener('click', addSplitRow);
  document.querySelectorAll('#pos-split-method-buttons .pay-method').forEach(function (el) {
    el.addEventListener('click', function () {
      if (el.classList.contains('disabled')) return;
      document.querySelectorAll('#pos-split-method-buttons .pay-method').forEach(function (p) { p.classList.remove('active'); });
      el.classList.add('active');
      splitSelectedMethod = el.getAttribute('data-splitmethod');
      updateSplitGiftCardBalanceDisplay();
    });
  });
  document.getElementById('pos-split-amount-input').addEventListener('click', function () {
    if (splitSelectedMethod === 'Gift Card') { openGiftCardModal('split'); return; }
    openSplitAmountModal();
  });
  document.querySelectorAll('[data-splitkp]').forEach(function (btn) {
    btn.addEventListener('click', function () { handleSplitAmountKeypad(btn.getAttribute('data-splitkp')); });
  });
  document.getElementById('pos-split-amount-modal-value').addEventListener('input', function (e) {
    var cleaned = e.target.value.replace(/[^0-9.]/g, '');
    var parts = cleaned.split('.');
    if (parts.length > 2) cleaned = parts[0] + '.' + parts.slice(1).join('');
    setSplitAmountModalValue(cleaned || '0');
  });
  document.getElementById('pos-split-amount-modal-cancel').addEventListener('click', function () {
    document.getElementById('pos-split-amount-modal').classList.remove('open');
  });
  document.getElementById('pos-split-amount-modal-done').addEventListener('click', commitSplitAmountModal);
  document.querySelectorAll('[data-gckp]').forEach(function (btn) {
    btn.addEventListener('click', function () { handleGiftCardKeypad(btn.getAttribute('data-gckp')); });
  });
  document.getElementById('pos-giftcard-modal-value').addEventListener('input', function (e) {
    var cleaned = e.target.value.replace(/[^0-9.]/g, '');
    var parts = cleaned.split('.');
    if (parts.length > 2) cleaned = parts[0] + '.' + parts.slice(1).join('');
    setGiftCardModalValue(cleaned || '0');
  });
  document.getElementById('pos-giftcard-modal-cancel').addEventListener('click', function () {
    document.getElementById('pos-giftcard-modal').classList.remove('open');
  });
  document.getElementById('pos-giftcard-modal-done').addEventListener('click', commitGiftCardModal);
  document.getElementById('pos-payment-error-modal-ok').addEventListener('click', function () {
    document.getElementById('pos-payment-error-modal').classList.remove('open');
  });
  document.getElementById('pos-payment-confirmed-modal-ok').addEventListener('click', function () {
    document.getElementById('pos-payment-confirmed-modal').classList.remove('open');
  });
  document.getElementById('pos-pc-whatsapp-close').addEventListener('click', function () {
    document.getElementById('pos-payment-confirmed-modal').classList.remove('open');
  });
  document.getElementById('pos-pc-whatsapp-send').addEventListener('click', function () {
    openWhatsAppReceipt();
    document.getElementById('pos-payment-confirmed-modal').classList.remove('open');
  });
  document.getElementById('pos-held-preview-close').addEventListener('click', function () {
    document.getElementById('pos-held-preview-modal').classList.remove('open');
  });
  document.querySelectorAll('.pos-settings-card').forEach(function (el) {
    el.addEventListener('click', function () { showPage(el.getAttribute('data-settings-link')); });
  });
  var shSearchDebounce;
  document.getElementById('pos-sh-search').addEventListener('input', function (e) {
    document.getElementById('pos-sh-search-clear').style.display = e.target.value ? 'flex' : 'none';
    clearTimeout(shSearchDebounce);
    shSearchDebounce = setTimeout(loadSalesHistory, 300);
  });
  document.getElementById('pos-sh-search-clear').addEventListener('click', function () {
    var input = document.getElementById('pos-sh-search');
    input.value = '';
    document.getElementById('pos-sh-search-clear').style.display = 'none';
    loadSalesHistory();
    input.focus();
  });
  document.getElementById('pos-sh-scan-btn').addEventListener('click', function () {
    var input = document.getElementById('pos-sh-search');
    input.value = '';
    document.getElementById('pos-sh-search-clear').style.display = 'none';
    loadSalesHistory();
    input.focus();
  });
  document.getElementById('pos-sh-date-filter').addEventListener('change', function () { loadSalesHistory(); });
  document.getElementById('pos-sh-view-close').addEventListener('click', function () {
    document.getElementById('pos-sh-view-modal').classList.remove('open');
  });
  document.getElementById('pos-gcu-close').addEventListener('click', function () {
    document.getElementById('pos-gcu-modal').classList.remove('open');
  });
  var cdbSearchDebounce;
  document.getElementById('pos-cdb-search').addEventListener('input', function (e) {
    clearTimeout(cdbSearchDebounce);
    var q = e.target.value;
    cdbSearchDebounce = setTimeout(function () { loadCustomerDbList(q); }, 300);
  });
  document.querySelectorAll('#pos-cdb-emirate .seg-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#pos-cdb-emirate .seg-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
    });
  });
  document.getElementById('pos-cdb-save-btn').addEventListener('click', saveCustomerDb);
  document.getElementById('pos-confirm-payment-btn').addEventListener('click', confirmPayment);
  document.getElementById('pos-print-btn').addEventListener('click', printBill);
  document.getElementById('pos-send-btn').addEventListener('click', sendBillWhatsApp);
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
