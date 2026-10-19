var ADMIN_TOKEN_KEY = 'pavnika_admin_token';

// ---------------------------------------------------------------
/* ---------- Shared: body scroll lock while any popup/drawer is open ----------
   Every full modal/slide-in in this app shares one of these three
   overlay classes. Rather than hand-editing every single place that
   opens/closes one of them (dozens of call sites, easy to miss one),
   a MutationObserver just watches all of them for "is-open" and keeps
   the page body non-scrollable for as long as at least one is open.
   Small inline popovers (search-result dropdowns, the date-range
   popover) deliberately do NOT use these classes, so they're
   unaffected -- only real full-page popups/drawers lock the page. */
(function initScrollLock() {
  var LOCK_SELECTOR = '.admin-order-drawer-overlay, .admin-simple-modal-overlay, .admin-modal-overlay';
  function refreshScrollLock() {
    var anyOpen = Array.prototype.some.call(document.querySelectorAll(LOCK_SELECTOR), function (el) {
      return el.classList.contains('is-open');
    });
    document.body.style.overflow = anyOpen ? 'hidden' : '';
  }
  function observeAll() {
    var observer = new MutationObserver(refreshScrollLock);
    document.querySelectorAll(LOCK_SELECTOR).forEach(function (el) {
      observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    refreshScrollLock();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeAll);
  } else {
    observeAll();
  }
})();

// ---------------------------------------------------------------
/* ---------- Shared: confirmation popup ----------
   A small styled replacement for the browser's native confirm() --
   used wherever a change should be double-checked before it's sent
   (order status, payment method, processing a return). Reuses the
   existing .admin-simple-modal-overlay look so it matches the rest of
   the admin panel instead of looking like a browser alert. */
function showConfirmPopup(message, onConfirm, onCancel) {
  var overlay = document.getElementById('admin-confirm-overlay');
  var textEl = document.getElementById('admin-confirm-text');
  var yesBtn = document.getElementById('admin-confirm-yes-btn');
  var noBtn = document.getElementById('admin-confirm-no-btn');
  if (!overlay) { if (onConfirm) onConfirm(); return; } // safety net if markup is ever missing
  textEl.textContent = message;
  overlay.classList.add('is-open');

  function cleanup() {
    overlay.classList.remove('is-open');
    yesBtn.removeEventListener('click', onYes);
    noBtn.removeEventListener('click', onNo);
    overlay.removeEventListener('click', onOverlayClick);
  }
  function onYes() { cleanup(); if (onConfirm) onConfirm(); }
  function onNo() { cleanup(); if (onCancel) onCancel(); }
  function onOverlayClick(e) { if (e.target === overlay) onNo(); }
  yesBtn.addEventListener('click', onYes);
  noBtn.addEventListener('click', onNo);
  overlay.addEventListener('click', onOverlayClick);
}

// ---------------------------------------------------------------
/* ---------- Shared: "Delivery Method" popup ----------
   Used both when an order is marked Delivered, and whenever the
   Delivery Method button itself is tapped (to set or change it
   independent of status). Lets the admin pick Partner / Own / Other:
     - Partner shows an AED amount field pre-filled with today's
       Partner rate from Delivery Rates -- almost always correct as-is,
       but editable for the rare long-distance delivery a partner
       charges more for.
     - Own has no amount field -- it always uses the Own rate.
     - Other has no stored rate at all -- the field starts blank and
       must be typed in fresh every time.
   Calls onConfirm(method, customCost). customCost is the AED value to
   snapshot for 'partner'/'other' (read from their amount fields);
   it's ignored for 'own', which the server prices from the live Own
   rate itself.
   options (all optional):
     partnerRate  — today's Partner rate, used to pre-fill its field
     prefillMethod/prefillCost — preselect an already-set method (used
       when re-opening via the Delivery Method button to change it) */
function showDeliveryMethodPopup(message, onConfirm, onCancel, options) {
  options = options || {};
  var overlay = document.getElementById('admin-delivery-method-overlay');
  var textEl = document.getElementById('admin-dm-text');
  var partnerField = document.getElementById('admin-dm-partner-field');
  var partnerInput = document.getElementById('admin-dm-partner-amount');
  var otherField = document.getElementById('admin-dm-other-field');
  var otherInput = document.getElementById('admin-dm-other-amount');
  var errorEl = document.getElementById('admin-dm-error');
  var confirmBtn = document.getElementById('admin-dm-confirm-btn');
  var cancelBtn = document.getElementById('admin-dm-cancel-btn');
  var radios = overlay ? Array.prototype.slice.call(overlay.querySelectorAll('input[name="admin-dm-method"]')) : [];
  if (!overlay) { if (onConfirm) onConfirm('own', 0); return; } // safety net if markup is ever missing

  var partnerRate = Number(options.partnerRate) || 0;

  textEl.textContent = message;
  radios.forEach(function (r) { r.checked = (r.value === options.prefillMethod); });
  partnerField.style.display = 'none';
  otherField.style.display = 'none';
  partnerInput.value = formatAED(partnerRate);
  otherInput.value = (options.prefillMethod === 'other' && options.prefillCost != null) ? formatAED(options.prefillCost) : '';
  errorEl.style.display = 'none';
  overlay.classList.add('is-open');
  onRadioChange(); // show whichever field matches a preselected radio, if any

  function onRadioChange() {
    var picked = radios.find(function (r) { return r.checked; });
    partnerField.style.display = (picked && picked.value === 'partner') ? 'block' : 'none';
    otherField.style.display = (picked && picked.value === 'other') ? 'block' : 'none';
    errorEl.style.display = 'none';
  }
  radios.forEach(function (r) { r.addEventListener('change', onRadioChange); });

  function cleanup() {
    overlay.classList.remove('is-open');
    radios.forEach(function (r) { r.removeEventListener('change', onRadioChange); });
    confirmBtn.removeEventListener('click', onYes);
    cancelBtn.removeEventListener('click', onNo);
    overlay.removeEventListener('click', onOverlayClick);
  }
  function onYes() {
    var picked = radios.find(function (r) { return r.checked; });
    if (!picked) {
      errorEl.textContent = 'Pick a delivery method.';
      errorEl.style.display = 'block';
      return;
    }
    var customCost = 0;
    if (picked.value === 'partner') {
      customCost = parseFloat(partnerInput.value);
      if (isNaN(customCost) || customCost < 0) {
        errorEl.textContent = 'Enter a valid amount (0 or more) for Delivery Partner.';
        errorEl.style.display = 'block';
        return;
      }
    } else if (picked.value === 'other') {
      customCost = parseFloat(otherInput.value);
      if (isNaN(customCost) || customCost < 0) {
        errorEl.textContent = 'Enter a valid amount (0 or more) for Other.';
        errorEl.style.display = 'block';
        return;
      }
    }
    cleanup();
    if (onConfirm) onConfirm(picked.value, customCost);
  }
  function onNo() { cleanup(); if (onCancel) onCancel(); }
  function onOverlayClick(e) { if (e.target === overlay) onNo(); }
  confirmBtn.addEventListener('click', onYes);
  cancelBtn.addEventListener('click', onNo);
  overlay.addEventListener('click', onOverlayClick);
}

// ---------------------------------------------------------------
/* ---------- Shared: session-expired popup ----------
   Every admin-* function returns 401 + "Not authorized..." the same
   way when the signed token has expired or been invalidated. Before
   this, each view handled that failure differently (most just showed
   it as a small inline error, easy to miss) -- this patches window.fetch
   once so ANY call to a netlify function in this app that comes back
   401 with that message shows one unmissable "session ended" popup
   with a button back to the login screen, regardless of which view
   triggered it. */
(function initSessionExpiryWatcher() {
  var shown = false;
  function showSessionExpired() {
    if (shown) return;
    shown = true;
    var overlay = document.getElementById('admin-session-expired-overlay');
    if (!overlay) { window.location.reload(); return; }
    overlay.classList.add('is-open');
  }
  var originalFetch = window.fetch;
  window.fetch = function () {
    var args = arguments;
    return originalFetch.apply(window, args).then(function (res) {
      var url = (args[0] && args[0].url) || args[0] || '';
      if (res.status === 401 && String(url).indexOf('/.netlify/functions/') !== -1 && String(url).indexOf('admin-login') === -1) {
        res.clone().json().then(function (data) {
          if (data && /not authorized/i.test(data.error || '')) showSessionExpired();
        }).catch(function () {});
      }
      return res;
    });
  };
  document.addEventListener('DOMContentLoaded', function () {
    var goBtn = document.getElementById('admin-session-expired-login-btn');
    if (goBtn) goBtn.addEventListener('click', function () {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      window.location.reload();
    });
  });
})();

// Same formatting as the live site's own formatAED (script.js) --
// thousands-separated with 2 decimals, e.g. 1234 -> "1,234.00". Used
// everywhere a price is DISPLAYED (never for an editable form input's
// raw value, which stays plain numeric).
function formatAED(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// The price a customer actually pays for this saree right now — a
// valid sale price if one is set, otherwise the regular price. Used
// anywhere a saree's price is shown or auto-filled in admin, so a
// discounted saree doesn't get quietly priced at its old amount in the
// manual order picker or anywhere else.
function effectivePrice(p) {
  var hasValidSale = p && p.salePrice && Number(p.salePrice) > 0 && Number(p.salePrice) < Number(p.price);
  return hasValidSale ? Number(p.salePrice) : Number(p && p.price || 0);
}

// Same convention as script.js's isEffectivelySold: a quantity-tracked
// item (jewellery/accessory) at 0 stock reads as sold out even though
// its manual "sold" checkbox is never ticked for it -- that checkbox
// is only how a one-of-a-kind saree/piece is marked sold. Used for the
// Dashboard's sold-out stat, which previously only counted p.sold and
// so always showed 0 for jewellery/accessory, no matter how depleted
// their stock actually was.
function isEffectivelySold(p) {
  return !!(p && (p.sold || (p.quantity !== null && p.quantity !== undefined && Number(p.quantity) <= 0)));
}

// An order's revenue contribution, net of any cash/bank-transfer
// return refunds recorded against it (see order_returns, attached as
// o.returns by admin-get-orders.js). Gift-card refunds are
// deliberately NOT subtracted — that money stays with the business as
// store credit owed, not a loss of revenue, matching how a whole
// order refunded to gift card (status 'refunded_giftcard') has always
// been treated. Shared between initStatsDashboard and initOrdersView,
// so it lives up here rather than inside either one of them.
function netOrderRevenue(o) {
  var total = Number(o.total) || 0;
  var cashBankRefunded = (o.returns || []).reduce(function (sum, r) {
    return r.refund_method === 'gift_card' ? sum : sum + (Number(r.refund_amount) || 0);
  }, 0);
  return Math.max(0, total - cashBankRefunded);
}

// Used on the printed tag itself, where there's very little room --
// just the series for a saree, or the type/category for Jewellery and
// Accessories (which have no series at all, previously leaving this
// line blank).
function tagSubtitle(item) {
  if (item.department === 'jewellery') return item.type + (item.colour ? ' \u2014 ' + item.colour : '');
  if (item.department === 'accessory') return item.type || 'Accessory';
  var seriesTitleCase = function (s) { return (s || '').toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); }); };
  return seriesTitleCase(item.series);
}

// Used in the admin's own selection list, where there's room for the
// fuller "Material · Series" detail sarees already show (e.g. "Semi
// Kanchipuram · Bridal Bliss") -- Jewellery/Accessories get their own
// equivalent (type + colour, or category) instead of the blank/bare "·"
// that showed before, since they have no material or series at all.
function tagListSubtitle(item) {
  if (item.department === 'jewellery') return item.type + (item.colour ? ' \u2014 ' + item.colour : '');
  if (item.department === 'accessory') return item.type || 'Accessory';
  var seriesTitleCase = function (s) { return (s || '').toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); }); };
  return (item.material || item.design || '') + (item.series ? ' \u00B7 ' + seriesTitleCase(item.series) : '');
}

// Classifies a line item's department straight from its ID prefix
// rather than looking it up in window.PRODUCTS, so this still works
// correctly for an order placed months ago even if that exact item
// has since been deleted from the live catalogue.
//
// Each jewellery/accessory TYPE now gets its own ID prefix (ER/NK/LH/
// JS/BM/BR/RF) instead of the old shared JW (jewellery) / AC
// (accessory) pair -- see JEWELLERY_ID_PREFIXES / ACCESSORY_ID_PREFIXES
// below, which the admin's ID-suggestion logic also reads from, so the
// two stay in sync. JW/AC themselves are kept recognized here
// permanently for any order placed before this change -- those IDs
// are real, already-issued history and must keep classifying
// correctly forever, even though no new item will use them going
// forward.
var JEWELLERY_ID_PREFIXES = {
  'Earrings': 'ER',
  'Necklaces': 'NK',
  'Long Harams': 'LH',
  'Jewellery Sets': 'JS',
  'Bangles & Bracelets': 'BR'
};
var ACCESSORY_ID_PREFIXES = {
  'Blouse Material': 'BM',
  'Reusable Flowers': 'RF'
  // Every other Accessory type (Hair Adornments, Saree Essentials,
  // Potli & Bags, Gift Collections) deliberately has no entry here --
  // those stay on the shared 'AC' prefix below until one of them
  // actually needs its own, same as Pavnika asked.
};
function itemDepartmentFromId(id) {
  var s = String(id || '');
  var jewelleryPrefixes = ['ER', 'NK', 'LH', 'JS', 'BR', 'JW'];
  var accessoryPrefixes = ['BM', 'RF', 'AC'];
  for (var i = 0; i < jewelleryPrefixes.length; i++) {
    if (s.indexOf(jewelleryPrefixes[i]) === 0) return 'jewellery';
  }
  for (var j = 0; j < accessoryPrefixes.length; j++) {
    if (s.indexOf(accessoryPrefixes[j]) === 0) return 'accessory';
  }
  return 'saree';
}

// Splits a set of orders' combined net revenue (the same number the
// headline Revenue card shows) across departments. An order can mix
// sarees and jewellery in one cart, so this allocates proportionally by
// each item's share of that order's own raw subtotal, scaled so the
// three buckets always sum back to exactly the same net total already
// shown elsewhere — a discount or partial refund on a mixed order
// reduces each department's slice by the same proportion, rather than
// being arbitrarily assigned to just one of them.
function departmentRevenueSplit(orders) {
  var buckets = { saree: 0, jewellery: 0, accessory: 0 };
  orders.forEach(function (o) {
    var items;
    try { items = JSON.parse(o.items || '[]'); } catch (e) { items = []; }
    if (!items.length) return;
    var rawSubtotal = items.reduce(function (sum, it) { return sum + (Number(it.price) || 0) * (Number(it.qty) || 1); }, 0);
    if (rawSubtotal <= 0) return;
    var net = netOrderRevenue(o);
    var scale = net / rawSubtotal;
    items.forEach(function (it) {
      var dept = itemDepartmentFromId(it.id);
      buckets[dept] += (Number(it.price) || 0) * (Number(it.qty) || 1) * scale;
    });
  });
  return buckets;
}

// Builds the pre-filled WhatsApp follow-up for an order stuck in
// 'pending' (checkout started, payment never completed) — not shown
// for 'cod_pending', which is an intentional cash-on-delivery order,
// not an abandoned payment. Caps the item list at 3 with a "+N more"
// summary so the message stays short for larger carts.
function buildPendingFollowUpMessage(order, items) {
  var firstName = (order.customer_name || '').trim().split(' ')[0] || 'there';
  var shown = items.slice(0, 3);
  var extra = items.length - shown.length;

  var lines = shown.map(function (it) {
    var qty = it.qty && it.qty > 1 ? ' \u00d7 ' + it.qty : '';
    var price = formatAED(it.price || 0);
    return '\u2014 ' + (it.name || it.id || 'Item') + qty + ' (AED ' + price + ')';
  });
  if (extra > 0) lines.push('\u2014 +' + extra + ' more');

  return 'Hi ' + firstName + ', greetings from Pavnika.\n\n' +
    'Just checking in \u2014 looks like something interrupted your order earlier. Everything okay on your end?\n\n' +
    lines.join('\n') + '\n\n' +
    'These are still saved for you. Let us know if you\u2019d like a hand with anything, or if you had a question we can help with.';
}

// Plain-text version of the same address JSON addressBlock() renders as
// HTML — used inside WhatsApp message text, which can't carry markup.
function formatAddressPlain(addrJson) {
  var addr;
  try { addr = JSON.parse(addrJson || '{}'); } catch (e) { addr = {}; }
  return [addr.building, addr.street, addr.city, addr.state, addr.pincode, addr.country].filter(Boolean).join(', ');
}

function buildDispatchConfirmationMessage(order) {
  var firstName = (order.customer_name || '').trim().split(' ')[0] || 'there';
  var address = formatAddressPlain(order.shipping_address || order.billing_address);

  // Wrapped in single asterisks — WhatsApp's own bold syntax, not a
  // typo — so the address stands out once the message is actually sent.
  return 'Hi ' + firstName + ', this is the Pavnika dispatch team \u2014 thank you so much for your order!\n\n' +
    'Before we dispatch, we\u2019d like to confirm your delivery address:\n*' + (address || 'Not provided') + '*\n\n' +
    'If possible, it would also help a lot if you could share your Google Maps pin/location for an easier delivery.\n\n' +
    'Thank you again for shopping with Pavnika by Saranya!';
}

function buildWhatsAppUrl(phone, message) {
  var digits = String(phone || '').replace(/[^\d]/g, '');
  return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(message);
}


// Used only to build the "View on GitHub" link on the Stats page.
// Update these if your GitHub username or repo name ever changes.
var GITHUB_OWNER = 'Prichuprabha';
var GITHUB_REPO = 'pavnika';
var IMAGE_BASE_URL = 'https://pavnika.ae/assets/products/';

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
  var existingToken = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (existingToken && !isTokenExpired(existingToken)) {
    var displayName = decodeAdminTokenDisplayName(existingToken);
    showAdminPanel(existingToken, displayName);
  } else {
    if (existingToken) localStorage.removeItem(ADMIN_TOKEN_KEY); // stale — don't leave it sitting around
    initAdminLogin();
  }
});

// A stale token now persists across tab closes (up to 12 hours), so this
// check matters more than it used to — without it, an expired token would
// still open the panel UI, only to fail unpredictably the moment any
// individual section actually tried to use it.
function isTokenExpired(token) {
  try {
    var payloadB64 = token.split('.')[0];
    var payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    return !payload.exp || Date.now() > payload.exp;
  } catch (e) {
    return true; // malformed token — treat as expired, safest default
  }
}

function decodeAdminTokenDisplayName(token) {
  try {
    var payloadB64 = token.split('.')[0];
    var payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    return payload.displayName || payload.username || 'Admin';
  } catch (e) {
    return 'Admin';
  }
}

/* ---------- Login ---------- */
function initAdminLogin() {
  var sendBtn = document.getElementById('admin-send-btn');

  function attemptLogin() {
    var username = document.getElementById('admin-gate-username').value.trim();
    var password = document.getElementById('admin-gate-password').value;
    var errorEl = document.getElementById('admin-error-1');
    errorEl.textContent = '';

    if (!username || !password) {
      errorEl.textContent = 'Please enter both a username and password.';
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Signing in...';

    fetch('/.netlify/functions/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok || !result.data.token) {
          errorEl.textContent = result.data.error || 'Invalid username or password.';
          return;
        }
        localStorage.setItem(ADMIN_TOKEN_KEY, result.data.token);
        showAdminPanel(result.data.token, result.data.displayName || result.data.username);
      })
      .catch(function () { errorEl.textContent = 'Network error. Please try again.'; })
      .finally(function () {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Sign In';
      });
  }

  sendBtn.addEventListener('click', attemptLogin);
  ['admin-gate-username', 'admin-gate-password'].forEach(function (id) {
    document.getElementById(id).addEventListener('keydown', function (e) {
      if (e.key === 'Enter') attemptLogin();
    });
  });
}

function showAdminPanel(token, displayName) {
  document.body.classList.remove('login-page');
  document.getElementById('admin-login-bg').style.display = 'none';
  document.getElementById('admin-login-wrap').style.display = 'none';
  document.getElementById('admin-shell').style.display = 'flex';
  document.getElementById('admin-email-display').textContent = displayName || 'Admin';
  var avatarCircle = document.getElementById('admin-avatar-circle');
  if (avatarCircle) {
    var initials = String(displayName || 'Admin').replace(/[^a-zA-Z]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join('');
    avatarCircle.textContent = initials || 'A';
  }
  initSareeEditor(token);
  initReviewsEditor(token);
  initBannersEditor(token);
  initSidebarAdsEditor(token);
  initVideosEditor(token);
  initPromoCodesEditor(token);
  initPosUsersEditor(token);
  initAdminUsersEditor(token);
  initStatsDashboard(token);
  initOrdersView(token);
  initManualOrderView(token);
  initCustomersView(token);
  initSareeTagsView(token);
  initShareLinkTool();
  initBusinessSettings(token);
  initDeliveryRatesSettings(token);
  initSidebarNav();

  document.getElementById('admin-logout-btn').addEventListener('click', function () {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    window.location.reload();
  });
}

/* ---------- Sidebar view switching ---------- */
// Shared across Dashboard, Orders, Reviews, and Promo Codes stat cards —
// one icon+colour system instead of each building its own markup, so
// every tab's stat cards look and behave consistently.
var ADMIN_STAT_ICONS = {
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>',
  shirt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a2 2 0 1 0-2 2c0 1-1.2 1.7-2 2.3L2 12l3 2 7-4.5 7 4.5 3-2-6-4.7c-.8-.6-2-1.3-2-2.3"/><path d="M2 20h20"/></svg>',
  hanger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2H10a2 2 0 0 0-2 2v16"/></svg>',
  hangerX: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2H10a2 2 0 0 0-2 2v16"/><line x1="4" y1="4" x2="20" y2="20"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9"/></svg>',
  starFilled: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24H4a1 1 0 0 0-1 1v5.59a2 2 0 0 0 .59 1.41l9.58 9.59a2 2 0 0 0 2.82 0l5.6-5.6a2 2 0 0 0 0-2.82z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  tagCheck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24H4a1 1 0 0 0-1 1v5.59a2 2 0 0 0 .59 1.41l9.58 9.59a2 2 0 0 0 2.82 0l5.6-5.6a2 2 0 0 0 0-2.82z"/><circle cx="7.5" cy="7.5" r="1.5"/><path d="m9 13 2 2 4-4"/></svg>'
};
var ADMIN_STAT_COLORS = {
  gold: '#B68A69',
  orange: '#E69E42',
  green: '#3B6D11',
  red: '#B8142A'
};
function buildStatCardHtml(label, value, iconKey, colorKey, extraHtml) {
  var color = ADMIN_STAT_COLORS[colorKey] || ADMIN_STAT_COLORS.gold;
  var icon = ADMIN_STAT_ICONS[iconKey] || ADMIN_STAT_ICONS.box;
  // 14% opacity background using the same colour as the icon — a
  // light, semi-transparent circle in the icon's own colour, rather
  // than a separate fixed palette per card.
  var bg = color + '24'; // hex alpha suffix (~14%)
  return (
    '<div class="admin-metric-card admin-metric-card-icon">' +
      '<div class="admin-metric-icon-circle" style="background:' + bg + '; color:' + color + ';">' + icon + '</div>' +
      '<div class="admin-metric-text"><p class="label">' + label + '</p><p class="value">' + value + '</p>' + (extraHtml || '') + '</div>' +
    '</div>'
  );
}

// Same card shell as buildStatCardHtml, but the headline number is two
// values side by side (Sarees | Jewellery & Accessories) instead of
// one -- used for In Stock / Sold Out once jewellery/accessories
// actually exist in the catalogue. The "sold this period" comparison
// underneath stays a single combined total either way, per request,
// since that's a time-based trend rather than a current inventory
// count.
function buildSplitStatCardHtml(label, sareeVal, otherVal, iconKey, colorKey, extraHtml) {
  var color = ADMIN_STAT_COLORS[colorKey] || ADMIN_STAT_COLORS.gold;
  var icon = ADMIN_STAT_ICONS[iconKey] || ADMIN_STAT_ICONS.box;
  var bg = color + '24';
  return (
    '<div class="admin-metric-card admin-metric-card-icon">' +
      '<div class="admin-metric-icon-circle" style="background:' + bg + '; color:' + color + ';">' + icon + '</div>' +
      '<div class="admin-metric-text">' +
        '<p class="label">' + label + '</p>' +
        '<p class="value admin-split-value">' + sareeVal + '<span class="admin-split-sep">|</span>' + otherVal + '</p>' +
        '<p class="admin-split-sublabels"><span>Sarees</span><span>Jew/Acc</span></p>' +
        (extraHtml || '') +
      '</div>' +
    '</div>'
  );
}

// Shared donut-chart builder (conic-gradient ring + legend) -- used by
// both the Orders page's "Order Status Overview" and the Dashboard's
// "Visitor Regions" panel, so there's one donut implementation instead
// of two slightly-different ones.
function buildDonutHtml(segments, centerLabel, scrollableLegend) {
  var total = segments.reduce(function (sum, s) { return sum + s.count; }, 0);
  if (!total) return '<p style="font-size:0.82rem; opacity:0.6;">No data yet.</p>';
  var cumulative = 0;
  var gradientStops = segments.filter(function (s) { return s.count > 0; }).map(function (s) {
    var start = (cumulative / total) * 100;
    cumulative += s.count;
    var end = (cumulative / total) * 100;
    return s.color + ' ' + start + '% ' + end + '%';
  }).join(', ');
  var legend = segments.map(function (s) {
    return '<div style="display:flex; align-items:center; gap:7px; font-size:0.78rem; padding:3px 0;">' +
      '<span style="width:9px; height:9px; border-radius:50%; background:' + s.color + '; flex-shrink:0;"></span>' +
      '<span style="flex:1;">' + s.label + '</span><span style="font-weight:600; color:var(--green-deep);">' + s.count + '</span>' +
    '</div>';
  }).join('');
  // Opt-in: a legend that can run long (e.g. Visitor Regions, one row
  // per country seen) gets capped to the same height as the other
  // dashboard panels (.admin-scroll-list, shared with Most Viewed
  // Items etc.) and scrolls internally, instead of growing the whole
  // card taller than its row-mates. Short, fixed-length legends (e.g.
  // the 4-status Order Status Overview donut) don't opt in, since
  // there's nothing to gain from capping a list that's never long.
  var legendHtml = scrollableLegend
    ? '<div class="admin-donut-legend admin-donut-legend-scrollable"><div class="admin-scroll-list">' + legend + '</div></div>'
    : '<div class="admin-donut-legend">' + legend + '</div>';
  return (
    '<div class="admin-donut" style="background:conic-gradient(' + gradientStops + ');">' +
      '<div class="admin-donut-center"><span class="n">' + total + '</span>' + (centerLabel ? '<span class="lbl">' + centerLabel + '</span>' : '') + '</div>' +
    '</div>' +
    legendHtml
  );
}

// Wires the scroll-fade/is-at-bottom behavior (shared with
// renderScrollablePanel) onto a .admin-scroll-list that was built
// directly into an innerHTML string (buildDonutHtml's scrollable
// legend) rather than rendered row-by-row through that function.
function wireDonutLegendScroll(container) {
  var scrollEl = container && container.querySelector('.admin-donut-legend-scrollable .admin-scroll-list');
  if (!scrollEl) return;
  scrollEl.scrollTop = 0;
  function updateFade() {
    var atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 4;
    scrollEl.classList.toggle('is-at-bottom', atBottom);
  }
  scrollEl.addEventListener('scroll', updateFade);
  updateFade();
}

// Tiny inline SVG sparkline for a stat card -- draws the series as a
// single polyline, no axes/labels (the card's own number is the
// label). Returns '' when there's nothing meaningful to plot so a
// card just shows its number with no trailing empty chart.
function buildSparklineSvg(series, color) {
  if (!series || series.length < 2) return '';
  var max = Math.max.apply(null, series);
  var min = Math.min.apply(null, series);
  if (max === min) max = min + 1; // flat series -- still draw a flat-ish line rather than divide by zero
  var w = 100, h = 26;
  var stepX = w / (series.length - 1);
  var coords = series.map(function (v, i) {
    var x = i * stepX;
    var y = h - ((v - min) / (max - min)) * (h - 4) - 2;
    return x + ',' + y;
  });
  return '<svg class="admin-stat-sparkline" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
    '<polyline points="' + coords.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/>' +
  '</svg>';
}

// Generic "View All" list modal -- fills the one shared modal markup
// (see admin.html) with whichever panel's full item list was asked
// for, reusing that panel's own rowBuilder so the modal's rows look
// identical to the scrollable preview, just roomier.
function openListModal(title, items, rowBuilder, emptyMessage) {
  document.getElementById('admin-list-modal-title').textContent = title;
  document.getElementById('admin-list-modal-body').innerHTML = items.length
    ? items.map(rowBuilder).join('')
    : '<p style="font-size:0.82rem; opacity:0.6;">' + (emptyMessage || 'Nothing here yet.') + '</p>';
  document.getElementById('admin-list-modal-overlay').classList.add('is-open');
}
(function initListModalClose() {
  document.addEventListener('DOMContentLoaded', function () {
    var overlay = document.getElementById('admin-list-modal-overlay');
    var closeBtn = document.getElementById('admin-list-modal-close');
    if (!overlay || !closeBtn) return;
    closeBtn.addEventListener('click', function () { overlay.classList.remove('is-open'); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.classList.remove('is-open'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') overlay.classList.remove('is-open'); });
  });
})();

// Scrollable panel (replaces the old click-to-expand "Show N more"
// pattern, which kept growing the page's height): the preview shows
// every item inside a fixed-height, internally-scrolling list, and a
// persistent "View All" link (already present in each panel's own
// header markup, id="<containerId>-viewall") opens the same items in
// the larger shared modal.
function renderScrollablePanel(container, items, rowBuilder, emptyMessage, modalTitle) {
  if (!container) return;
  if (!items.length) {
    container.innerHTML = '<p style="font-size:0.82rem; opacity:0.6;">' + emptyMessage + '</p>';
  } else {
    // On mobile, a touch scroll that starts over this list gets
    // captured by it instead of continuing to scroll the page -- the
    // list looked like it had "grabbed" the page's scroll the moment
    // you reached it. Below 880px the list opens pinned to its
    // collapsed height (no internal scroll) and a "Show more" link
    // switches it into a scrollable state on demand; "Show less"
    // switches it back. Desktop is unaffected (always scrollable, as
    // before).
    container.innerHTML = '<div class="admin-scroll-list">' + items.map(rowBuilder).join('') + '</div>' +
      '<div class="admin-scroll-more-link" tabindex="0">Show more <span class="admin-scroll-more-arrow">&darr;</span></div>';
    var scrollEl = container.querySelector('.admin-scroll-list');
    var moreLink = container.querySelector('.admin-scroll-more-link');
    scrollEl.scrollTop = 0; // always open at the top, never wherever a previous render happened to leave it
    // The bottom fade (CSS, above) signals "there's more below, scroll"
    // -- drop it once scrolled all the way down (or if there's nothing
    // to scroll at all) so the last row doesn't look like it's
    // permanently fading away.
    function updateFade() {
      var atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 4;
      scrollEl.classList.toggle('is-at-bottom', atBottom);
    }
    scrollEl.addEventListener('scroll', updateFade);
    updateFade();

    function collapseList() {
      if (!scrollEl.classList.contains('is-expanded')) return;
      scrollEl.classList.remove('is-expanded');
      moreLink.innerHTML = 'Show more <span class="admin-scroll-more-arrow">&darr;</span>';
      scrollEl.scrollTop = 0;
    }

    moreLink.addEventListener('click', function () {
      var expanding = !scrollEl.classList.contains('is-expanded');
      if (expanding) {
        scrollEl.classList.add('is-expanded');
        moreLink.innerHTML = 'Show less <span class="admin-scroll-more-arrow">&uarr;</span>';
      } else {
        collapseList();
      }
    });

    // "...and once i scroll past it, it goes back to the fixed state" --
    // once the panel has scrolled up out of view (the page has moved
    // on past it), drop it back to the fixed/collapsed state so it's
    // not left expanded the next time it scrolls back into view.
    if (window.IntersectionObserver) {
      var pastObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting && entry.boundingClientRect.bottom < 0) {
            collapseList();
          }
        });
      }, { threshold: 0 });
      pastObserver.observe(container);
    }
  }
  var viewAllLink = document.getElementById(container.id + '-viewall');
  if (viewAllLink) {
    viewAllLink.style.display = items.length ? '' : 'none';
    viewAllLink.onclick = function () { openListModal(modalTitle, items, rowBuilder, emptyMessage); };
  }
}

// Same fixed-height / "Show more" / collapse-on-scroll-past behavior as
// renderScrollablePanel above, for a list whose rows are already
// rendered (e.g. the Orders page's mobile card list), rather than
// built from a rowBuilder here. Call this right after setting the
// container's innerHTML to the row markup, before attaching any
// per-row click handlers via container.querySelectorAll(...) -- the
// rows themselves are reparented, not recreated, so handlers attached
// afterward still work normally.
function wireMobileScrollList(container) {
  if (!container) return;
  var rows = container.innerHTML;
  if (!rows) return; // empty-state message -- nothing to wrap
  container.innerHTML = '<div class="admin-scroll-list">' + rows + '</div>' +
    '<div class="admin-scroll-more-link" tabindex="0">Show more <span class="admin-scroll-more-arrow">&darr;</span></div>';
  var scrollEl = container.querySelector('.admin-scroll-list');
  var moreLink = container.querySelector('.admin-scroll-more-link');
  scrollEl.scrollTop = 0; // always open at the top, never wherever a previous render happened to leave it

  function updateFade() {
    var atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 4;
    scrollEl.classList.toggle('is-at-bottom', atBottom);
  }
  scrollEl.addEventListener('scroll', updateFade);
  updateFade();

  function collapseList() {
    if (!scrollEl.classList.contains('is-expanded')) return;
    scrollEl.classList.remove('is-expanded');
    moreLink.innerHTML = 'Show more <span class="admin-scroll-more-arrow">&darr;</span>';
    scrollEl.scrollTop = 0;
  }

  moreLink.addEventListener('click', function () {
    var expanding = !scrollEl.classList.contains('is-expanded');
    if (expanding) {
      scrollEl.classList.add('is-expanded');
      moreLink.innerHTML = 'Show less <span class="admin-scroll-more-arrow">&uarr;</span>';
    } else {
      collapseList();
    }
  });

  if (window.IntersectionObserver) {
    var pastObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting && entry.boundingClientRect.bottom < 0) {
          collapseList();
        }
      });
    }, { threshold: 0 });
    pastObserver.observe(container);
  }
}

/* ---------- Send Filtered List (admin -> WhatsApp) ---------- */
// Lets an admin build a link to the live Collections (Sarees) or
// Jewellery & Accessories page with a specific combination of filters
// pre-applied -- read back out of the URL by script.js's own
// initCollectionsPage/initJewelleryAccessoriesPage (see the param-
// reading blocks added there) -- then send that link straight to a
// customer over WhatsApp with a custom message, or just copy it.
// Always restricts both this preview and the generated link
// (hideSold=1) to currently available items, so a customer never lands
// on a filtered page showing something already sold.
//
// Same fixed shade palette + swatch markup as the live site's own
// Shade filter (collections.html's #shade-filter), so a shade reads as
// an actual color here too, not just a name in a dropdown.
var ADMIN_SL_SHADES = [
  { value: 'Maroon / Red', hex: '#6B1420' },
  { value: 'Pink', hex: '#E88CA8' },
  { value: 'Orange / Brown', hex: '#E07A2C' },
  { value: 'Yellow / Gold', hex: '#D9A628' },
  { value: 'Green', hex: '#3C6B35' },
  { value: 'Blue', hex: '#2E5FA3' },
  { value: 'Purple / Violet', hex: '#6B3FA0' },
  { value: 'Black', hex: '#171313' },
  { value: 'White / Off-white', swatchClass: 'swatch-white' },
  { value: 'Grey', hex: '#9C9690' },
  { value: 'Beige / Mauve', hex: '#E3D2B4' },
  { value: 'Others', swatchClass: 'swatch-others' }
];

function initShareLinkTool() {
  var view = document.getElementById('admin-view-share-link');
  if (!view) return;

  var deptSareeBtn = document.getElementById('admin-sl-dept-saree');
  var deptJewelleryBtn = document.getElementById('admin-sl-dept-jewellery');
  var sareeFiltersEl = document.getElementById('admin-sl-saree-filters');
  var jewelleryFiltersEl = document.getElementById('admin-sl-jewellery-filters');

  var materialSelect = document.getElementById('admin-sl-material');
  var seriesSelect = document.getElementById('admin-sl-series');
  var shadeSwatchesEl = document.getElementById('admin-sl-shade-swatches');
  var occasionSelect = document.getElementById('admin-sl-occasion');
  var typeSelect = document.getElementById('admin-sl-type');
  var sortSareeSelect = document.getElementById('admin-sl-sort-saree');
  var sortJaSelect = document.getElementById('admin-sl-sort-ja');
  var queryInput = document.getElementById('admin-sl-query');
  var priceMinInput = document.getElementById('admin-sl-price-min');
  var priceMaxInput = document.getElementById('admin-sl-price-max');
  var priceMinLabel = document.getElementById('admin-sl-price-min-label');
  var priceMaxLabel = document.getElementById('admin-sl-price-max-label');
  var priceTrackFill = document.getElementById('admin-sl-price-track-fill');
  var resetBtn = document.getElementById('admin-sl-reset-btn');

  var countEl = document.getElementById('admin-sl-count');
  var previewListEl = document.getElementById('admin-sl-preview-list');
  var linkInput = document.getElementById('admin-sl-link');
  var messageInput = document.getElementById('admin-sl-message');
  var whatsappBtn = document.getElementById('admin-sl-whatsapp-btn');
  var copyBtn = document.getElementById('admin-sl-copy-btn');
  var msgEl = document.getElementById('admin-sl-msg');

  // 'saree' | 'jewellery' -- the jewellery bucket also covers
  // accessories, same single grouping the live site itself uses.
  var dept = 'saree';
  var selectedShade = 'all';
  var dataMin = 0, dataMax = 0;

  function sortSelect() { return dept === 'saree' ? sortSareeSelect : sortJaSelect; }

  function allAvailable() {
    return (window.PRODUCTS || []).filter(function (p) { return !isEffectivelySold(p); });
  }
  function poolForDept() {
    return allAvailable().filter(function (p) {
      return dept === 'saree' ? (p.department || 'saree') === 'saree' : (p.department === 'jewellery' || p.department === 'accessory');
    });
  }
  function sareeName(p) { return p.material || p.design || p.id; }
  function jaName(p) { return (p.type || (p.department === 'accessory' ? 'Accessory' : 'Jewellery')) + (p.colour ? ' — ' + p.colour : ''); }

  function uniqueSorted(list) {
    var seen = {};
    var out = [];
    list.forEach(function (v) {
      if (v === undefined || v === null || v === '') return;
      if (!seen[v]) { seen[v] = true; out.push(v); }
    });
    out.sort();
    return out;
  }

  // Whether product p passes the filter named by `key`, using its OWN
  // current UI value -- used below to compute "how many items would I
  // get if I picked each OTHER value of this group", i.e. every active
  // filter except the one being counted.
  function passesOwnFilter(p, key) {
    if (key === 'material') return materialSelect.value === 'all' || p.material === materialSelect.value;
    if (key === 'series') return seriesSelect.value === 'all' || p.series === seriesSelect.value;
    if (key === 'shade') return selectedShade === 'all' || p.shade === selectedShade;
    if (key === 'occasion') return occasionSelect.value === 'all' || (!!p.occasions && p.occasions.indexOf(occasionSelect.value) !== -1);
    if (key === 'type') return typeSelect.value === 'all' || p.type === typeSelect.value;
    return true;
  }
  function passesPrice(p) {
    var price = effectivePrice(p);
    var pMin = priceMinInput.value !== '' ? Number(priceMinInput.value) : null;
    var pMax = priceMaxInput.value !== '' ? Number(priceMaxInput.value) : null;
    if (pMin !== null && price < pMin) return false;
    if (pMax !== null && price > pMax) return false;
    return true;
  }
  function passesQuery(p) {
    var q = (queryInput.value || '').trim().toLowerCase();
    if (!q) return true;
    var fields = dept === 'saree'
      ? ['id', 'material', 'design', 'type', 'sareeType', 'pattern', 'series', 'category']
      : ['id', 'baseId', 'type', 'colour', 'category', 'note'];
    return fields.some(function (f) { return p[f] && String(p[f]).toLowerCase().indexOf(q) !== -1; });
  }

  // Counts, per possible value of `groupKey`, of how many available
  // items would match if that value were picked -- holding every OTHER
  // active filter (including price and search) fixed. counts.__all is
  // the count for "All" (i.e. every other filter, none of this group's
  // own constraint) -- same cross-filter logic the live site uses to
  // grey out impossible combinations, but surfaced as a number instead.
  function facetCounts(groupKey) {
    var relevantKeys = dept === 'saree' ? ['material', 'series', 'shade', 'occasion'] : ['type'];
    var counts = {};
    var allCount = 0;
    poolForDept().forEach(function (p) {
      var ok = passesPrice(p) && passesQuery(p);
      if (ok) {
        relevantKeys.forEach(function (k) {
          if (k === groupKey) return;
          if (!passesOwnFilter(p, k)) ok = false;
        });
      }
      if (!ok) return;
      allCount++;
      if (groupKey === 'occasion') {
        (p.occasions || []).forEach(function (o) { counts[o] = (counts[o] || 0) + 1; });
      } else {
        var val = groupKey === 'material' ? p.material : groupKey === 'series' ? p.series : groupKey === 'shade' ? p.shade : groupKey === 'type' ? p.type : null;
        if (val) counts[val] = (counts[val] || 0) + 1;
      }
    });
    counts.__all = allCount;
    return counts;
  }

  function populateSelect(select, values, counts) {
    var current = select.value;
    select.innerHTML = '<option value="all">All (' + (counts.__all || 0) + ')</option>' + values.map(function (v) {
      return '<option value="' + String(v).replace(/"/g, '&quot;') + '">' + v + ' (' + (counts[v] || 0) + ')</option>';
    }).join('');
    select.value = values.indexOf(current) !== -1 ? current : 'all';
  }

  function renderShadeSwatches(counts) {
    var allCount = counts.__all || 0;
    var html = '<button type="button" class="swatch-btn' + (selectedShade === 'all' ? ' active' : '') + '" data-value="all" title="All Shades">' +
      '<span class="swatch-circle swatch-all"></span><span class="swatch-label">All<span class="swatch-count">(' + allCount + ')</span></span></button>';
    html += ADMIN_SL_SHADES.map(function (s) {
      var n = counts[s.value] || 0;
      var circleStyle = s.hex ? ' style="background:' + s.hex + ';"' : '';
      var circleClass = 'swatch-circle' + (s.swatchClass ? ' ' + s.swatchClass : '');
      return '<button type="button" class="swatch-btn' + (selectedShade === s.value ? ' active' : '') + '" data-value="' + s.value.replace(/"/g, '&quot;') + '" title="' + s.value + '">' +
        '<span class="' + circleClass + '"' + circleStyle + '></span><span class="swatch-label">' + s.value + '<span class="swatch-count">(' + n + ')</span></span></button>';
    }).join('');
    shadeSwatchesEl.innerHTML = html;
    shadeSwatchesEl.querySelectorAll('.swatch-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedShade = btn.getAttribute('data-value');
        render();
      });
    });
  }

  function refreshFilterOptions() {
    if (dept === 'saree') {
      populateSelect(materialSelect, uniqueSorted(poolForDept().map(function (p) { return p.material; })), facetCounts('material'));
      populateSelect(seriesSelect, uniqueSorted(poolForDept().map(function (p) { return p.series; })), facetCounts('series'));
      var allOccasions = [];
      poolForDept().forEach(function (p) { (p.occasions || []).forEach(function (o) { allOccasions.push(o); }); });
      populateSelect(occasionSelect, uniqueSorted(allOccasions), facetCounts('occasion'));
      renderShadeSwatches(facetCounts('shade'));
    } else {
      populateSelect(typeSelect, uniqueSorted(poolForDept().map(function (p) { return p.type; })), facetCounts('type'));
    }
  }

  // Re-applied only on department switch / reset, not on every
  // keystroke -- the two catalogues have very different price ranges,
  // and an admin dragging the slider shouldn't get snapped back to the
  // full range on every render. Same rounding convention as the live
  // site's own price slider for each department.
  function resetPriceBounds() {
    var prices = poolForDept().map(function (p) { return effectivePrice(p); });
    var step = dept === 'saree' ? 50 : 5;
    if (!prices.length) { dataMin = 0; dataMax = 0; }
    else {
      dataMin = Math.floor(Math.min.apply(null, prices) / step) * step;
      dataMax = Math.ceil(Math.max.apply(null, prices) / step) * step;
    }
    [priceMinInput, priceMaxInput].forEach(function (input) { input.min = dataMin; input.max = dataMax; });
    priceMinInput.value = dataMin;
    priceMaxInput.value = dataMax;
    updatePriceUI();
  }

  function updatePriceUI() {
    var lo = Math.min(Number(priceMinInput.value), Number(priceMaxInput.value));
    var hi = Math.max(Number(priceMinInput.value), Number(priceMaxInput.value));
    priceMinLabel.textContent = lo.toLocaleString();
    priceMaxLabel.textContent = hi.toLocaleString();
    var range = (dataMax - dataMin) || 1;
    var pctLo = ((lo - dataMin) / range) * 100;
    var pctHi = ((hi - dataMin) / range) * 100;
    priceTrackFill.style.left = pctLo + '%';
    priceTrackFill.style.width = (pctHi - pctLo) + '%';
  }

  function getFilteredPreview() {
    return poolForDept().filter(function (p) {
      if (dept === 'saree') {
        if (!passesOwnFilter(p, 'material') || !passesOwnFilter(p, 'series') || !passesOwnFilter(p, 'shade') || !passesOwnFilter(p, 'occasion')) return false;
      } else {
        if (!passesOwnFilter(p, 'type')) return false;
      }
      return passesQuery(p) && passesPrice(p);
    });
  }

  function buildLink() {
    var page = dept === 'saree' ? 'collections.html' : 'jewellery-accessories.html';
    var params = new URLSearchParams();
    if (dept === 'saree') {
      if (materialSelect.value !== 'all') params.set('category', materialSelect.value);
      if (seriesSelect.value !== 'all') params.set('series', seriesSelect.value);
      if (selectedShade !== 'all') params.set('shade', selectedShade);
      if (occasionSelect.value !== 'all') params.set('occasion', occasionSelect.value);
    } else {
      if (typeSelect.value !== 'all') params.set('type', typeSelect.value);
    }
    if ((queryInput.value || '').trim()) params.set('q', queryInput.value.trim());
    // script.js only honors a price filter from the URL when BOTH
    // bounds are present together, so these two are always set as a
    // pair -- never just one -- whenever either differs from the full
    // data-driven range.
    var priceMinChanged = priceMinInput.value !== '' && Number(priceMinInput.value) !== dataMin;
    var priceMaxChanged = priceMaxInput.value !== '' && Number(priceMaxInput.value) !== dataMax;
    if (priceMinChanged || priceMaxChanged) {
      params.set('priceMin', priceMinInput.value);
      params.set('priceMax', priceMaxInput.value);
    }
    if (sortSelect().value !== 'default') params.set('sort', sortSelect().value);
    // Always on: a link sent to a customer should only ever show items
    // they can actually buy, regardless of how the admin building it
    // last left the catalogue's "Hide sold out" state in their head.
    params.set('hideSold', '1');
    var qs = params.toString();
    return 'https://pavnika.ae/' + page + (qs ? '?' + qs : '');
  }

  function render() {
    refreshFilterOptions();
    var matched = getFilteredPreview();
    countEl.textContent = matched.length;
    if (!matched.length) {
      previewListEl.innerHTML = '<p style="font-size:0.82rem; opacity:0.7; padding:10px;">No available items match these filters.</p>';
    } else {
      previewListEl.innerHTML = matched.slice(0, 200).map(function (p) {
        var name = dept === 'saree' ? sareeName(p) : jaName(p);
        var thumb = p.image || (p.images && p.images[0]) || '';
        return '<div style="display:flex; align-items:center; gap:10px; padding:6px 4px; border-bottom:1px solid var(--stone);">' +
          (thumb ? '<img src="' + thumb + '" style="width:34px; height:34px; object-fit:cover; border-radius:4px; flex-shrink:0;">' : '<span style="width:34px; height:34px; flex-shrink:0;"></span>') +
          '<span style="font-size:0.8rem; flex:1; min-width:0; overflow-wrap:break-word;">' + name + ' <span style="opacity:0.6;">— ' + p.id + '</span></span>' +
          '<span style="font-size:0.78rem; font-weight:600;">AED ' + Math.round(effectivePrice(p)).toLocaleString() + '</span>' +
        '</div>';
      }).join('');
    }
    previewListEl.scrollTop = 0;
    linkInput.value = buildLink();
  }

  function switchDept(next) {
    dept = next;
    selectedShade = 'all';
    deptSareeBtn.className = 'btn ' + (dept === 'saree' ? 'btn-primary' : 'btn-ghost');
    deptJewelleryBtn.className = 'btn ' + (dept === 'jewellery' ? 'btn-primary' : 'btn-ghost');
    sareeFiltersEl.style.display = dept === 'saree' ? 'block' : 'none';
    jewelleryFiltersEl.style.display = dept === 'jewellery' ? 'block' : 'none';
    materialSelect.value = 'all'; seriesSelect.value = 'all'; occasionSelect.value = 'all'; typeSelect.value = 'all';
    queryInput.value = '';
    sortSareeSelect.value = 'default'; sortJaSelect.value = 'default';
    resetPriceBounds();
    render();
  }

  deptSareeBtn.addEventListener('click', function () { switchDept('saree'); });
  deptJewelleryBtn.addEventListener('click', function () { switchDept('jewellery'); });

  [materialSelect, seriesSelect, occasionSelect, typeSelect, sortSareeSelect, sortJaSelect].forEach(function (el) {
    el.addEventListener('change', render);
  });
  queryInput.addEventListener('input', render);
  function onPriceChange() {
    updatePriceUI();
    render();
  }
  priceMinInput.addEventListener('input', onPriceChange);
  priceMaxInput.addEventListener('input', onPriceChange);

  resetBtn.addEventListener('click', function () {
    materialSelect.value = 'all'; seriesSelect.value = 'all'; occasionSelect.value = 'all'; typeSelect.value = 'all';
    selectedShade = 'all';
    queryInput.value = '';
    sortSareeSelect.value = 'default'; sortJaSelect.value = 'default';
    resetPriceBounds();
    render();
  });

  copyBtn.addEventListener('click', function () {
    var textarea = document.createElement('textarea');
    textarea.value = linkInput.value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand('copy'); } catch (e) { /* nothing more we can do */ }
    document.body.removeChild(textarea);
    msgEl.textContent = 'Link copied.';
    msgEl.className = 'admin-status-msg success';
    setTimeout(function () { msgEl.className = 'admin-status-msg'; }, 2500);
  });

  whatsappBtn.addEventListener('click', function () {
    var text = (messageInput.value || '').trim();
    var fullMessage = (text ? text + '\n\n' : '') + linkInput.value;
    window.open('https://wa.me/?text=' + encodeURIComponent(fullMessage), '_blank', 'noopener');
  });

  switchDept('saree');
}

function initSidebarNav() {
  var navItems = document.querySelectorAll('.admin-nav-item');
  var sidebar = document.getElementById('admin-sidebar');
  var overlay = document.getElementById('admin-mobile-overlay');
  var toggle = document.getElementById('admin-mobile-toggle');

  function closeMobileNav() {
    if (sidebar) sidebar.classList.remove('is-open');
    if (overlay) overlay.classList.remove('is-open');
  }
  if (toggle) {
    toggle.addEventListener('click', function () {
      if (sidebar) sidebar.classList.toggle('is-open');
      if (overlay) overlay.classList.toggle('is-open');
    });
  }
  if (overlay) overlay.addEventListener('click', closeMobileNav);

  var mobileTitle = document.getElementById('admin-mobile-page-title');
  var bottomNavItems = document.querySelectorAll('.admin-mobile-bottom-nav .amb-item');

  navItems.forEach(function (item) {
    item.addEventListener('click', function () {
      var view = item.getAttribute('data-view');
      navItems.forEach(function (n) { n.classList.remove('active'); });
      item.classList.add('active');
      document.querySelectorAll('.admin-view').forEach(function (v) { v.style.display = 'none'; });
      var target = document.getElementById('admin-view-' + view);
      if (target) target.style.display = 'block';
      // Switching views only toggles display:none/block -- it doesn't
      // touch scroll position, so a page left scrolled down (e.g. deep
      // in the Orders list) made the newly-shown view (Manual Order,
      // Add Product, ...) look like it opened pre-scrolled to the
      // bottom. Every view switch should land at the top.
      window.scrollTo(0, 0);
      if (target) target.scrollTop = 0;
      if (view === 'stats' && window.__refreshStats) window.__refreshStats();
      if (mobileTitle) mobileTitle.textContent = item.textContent.trim();
      bottomNavItems.forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-view-jump') === view);
      });
      closeMobileNav(); // picking a page also dismisses the mobile menu, same as tapping outside it
    });
  });
}

/* ---------- Saree editor ---------- */
function initSareeEditor(token) {
  var rowsEl = document.getElementById('admin-product-rows');
  var formCard = document.getElementById('admin-form-card');
  var sareeDrawerOverlay = document.getElementById('admin-saree-drawer-overlay');
  var form = document.getElementById('admin-product-form');
  var seriesSelect = document.getElementById('admin-f-series');
  var idField = document.getElementById('admin-f-id');
  var idWrap = document.getElementById('admin-f-id-wrap');
  var idHint = document.getElementById('admin-id-hint');
  var idWarning = document.getElementById('admin-id-warning');
  var departmentSelect = document.getElementById('admin-f-department');
  // Each jewellery/accessory TYPE gets its own ID prefix now, not one
  // shared per department -- see JEWELLERY_ID_PREFIXES /
  // ACCESSORY_ID_PREFIXES near itemDepartmentFromId above, which this
  // reads from directly so the two never drift apart. A type with no
  // entry (the still-unused Accessory types) falls back to the plain
  // department-level prefix, same as every jewellery/accessory type
  // used to work before this split.
  var DEPT_FALLBACK_PREFIXES = { jewellery: 'JW', accessory: 'AC' };
  function idPrefixForType(dept, type) {
    var byType = dept === 'jewellery' ? JEWELLERY_ID_PREFIXES : (dept === 'accessory' ? ACCESSORY_ID_PREFIXES : null);
    return (byType && byType[type]) || DEPT_FALLBACK_PREFIXES[dept];
  }
  var currentImages = []; // the saree's photo URLs, as far as the live product record is concerned
  var previewOverrides = {}; // url -> local dataUrl, for photos uploaded this session whose live URL isn't deployed yet
  var uploadedForId = null; // which ID currentImages' uploads were filed under, to catch a mid-session ID change
  var addImageBtn = document.getElementById('admin-add-image-btn');
  var fileInput = document.getElementById('admin-image-file-input');
  var currentPhotosGrid = document.getElementById('admin-current-photos-grid');
  var pendingPhotosGrid = document.getElementById('admin-pending-photos-grid');
  var removeSelectedBtn = document.getElementById('admin-remove-selected-btn');
  var uploadSelectedBtn = document.getElementById('admin-upload-selected-btn');
  var selectedForRemoval = {}; // filename -> true, only for entries currently checked
  var pendingUploads = []; // [{ file, dataUrl, selected }] — picked but not yet uploaded
  var statusMsg = document.getElementById('admin-status-msg');
  var formTitle = document.getElementById('admin-form-title');
  var searchInput = document.getElementById('admin-search-input');
  var paginationEl = document.getElementById('admin-pagination');
  var editingId = null;
  var isAddMode = false;
  var PAGE_SIZE = 80;
  var currentPage = 1;
  var searchQuery = '';
  var hideSold = true;
  var deptFilter = 'all'; // 'all' | 'saree' | 'jewellery' (jewellery bucket covers accessories too, matching the customer-facing page's single department grouping)

  // The form now slides in as a drawer (overlay + panel), matching the
  // Orders drawer, instead of sitting permanently in a side column —
  // this lets the saree grid use the page's full width. These two
  // helpers replace the old formCard.style.display toggling.
  function showSareeDrawer() {
    formCard.style.display = 'flex';
    sareeDrawerOverlay.classList.add('is-open');
  }
  function hideSareeDrawer() {
    sareeDrawerOverlay.classList.remove('is-open');
  }
  document.getElementById('admin-saree-drawer-close').addEventListener('click', hideSareeDrawer);
  sareeDrawerOverlay.addEventListener('click', function (e) {
    // On desktop this form renders as a centered popup (see the
    // min-width:900px rule in admin.html) specifically so an
    // accidental click outside it can't discard a half-filled form --
    // Close (✕) or Cancel are the only ways out there. Mobile keeps
    // the original slide-in-drawer behavior, outside-click included,
    // since a popup doesn't fit a small screen the same way.
    var isDesktop = window.matchMedia('(min-width: 900px)').matches;
    if (e.target === sareeDrawerOverlay && !isDesktop) hideSareeDrawer();
  });

  function seriesTitle(code) {
    return code.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // A sale price only counts as a real offer if it's a positive number
  // genuinely below the regular price — otherwise it's silently
  // dropped, so a stray value can't accidentally show a "discount"
  // that's zero, negative, or actually higher than the normal price.
  // The regular-price field is different per department (sarees use
  // admin-f-price, jewellery admin-f-jprice, accessories admin-f-aprice)
  // but there's only one shared Sale Price input across all three forms
  // -- this used to always read admin-f-price regardless of department,
  // so for jewellery/accessories "regular" came out as 0 (that field is
  // blank outside the saree form) and any sale price typed in failed
  // the "below regular price" check and was silently dropped.
  function currentRegularPriceFieldId() {
    var dept = departmentSelect.value;
    if (dept === 'jewellery') return 'admin-f-jprice';
    if (dept === 'accessory') return 'admin-f-aprice';
    return 'admin-f-price';
  }

  // Mirrors the server-side logic in _order-shared.js's applySoldFlag --
  // soldAt is only (re)stamped the moment an item actually BECOMES sold.
  // Saving unrelated edits to an item that was already sold must not
  // reset its sold-out visibility window back to the full duration each
  // time, or it would never age out; unchecking "Sold out" clears it.
  function computeSoldAtForSave(isSoldNow) {
    if (!isSoldNow) return null;
    var existing = editingId ? (window.PRODUCTS || []).find(function (p) { return p.id === editingId; }) : null;
    if (existing && existing.sold && existing.soldAt) return existing.soldAt;
    return new Date().toISOString();
  }

  function parseSalePriceInput() {
    var regular = parseInt(document.getElementById(currentRegularPriceFieldId()).value, 10) || 0;
    var raw = document.getElementById('admin-f-sale-price').value;
    if (raw === '') return null;
    var sale = parseInt(raw, 10);
    if (!sale || sale <= 0 || sale >= regular) return null;
    return sale;
  }

  function updateSalePreview() {
    var previewEl = document.getElementById('admin-sale-preview');
    var regular = parseInt(document.getElementById(currentRegularPriceFieldId()).value, 10) || 0;
    var sale = parseSalePriceInput();
    if (!sale) {
      previewEl.style.display = 'none';
      return;
    }
    var pct = Math.round((1 - sale / regular) * 100);
    previewEl.style.display = 'block';
    previewEl.innerHTML = 'Customers will see <strong>AED ' + regular + '</strong> struck through, ' +
      '<strong>AED ' + sale + '</strong> highlighted — ' + pct + '% off';
  }
  document.getElementById('admin-f-price').addEventListener('input', updateSalePreview);
  document.getElementById('admin-f-jprice').addEventListener('input', updateSalePreview);
  document.getElementById('admin-f-aprice').addEventListener('input', updateSalePreview);
  document.getElementById('admin-f-sale-price').addEventListener('input', updateSalePreview);
  departmentSelect.addEventListener('change', updateSalePreview);

  // "Sale Price" section is collapsed by default (most items have no
  // offer) -- the toggle just shows/hides the entry field; the value
  // itself is untouched either way, so flipping it off after typing a
  // price doesn't clear it, it's just tucked away again.
  var salePriceToggle = document.getElementById('admin-sale-price-toggle');
  var salePriceWrap = document.getElementById('admin-sale-price-wrap');
  salePriceToggle.addEventListener('change', function () {
    salePriceWrap.style.display = salePriceToggle.checked ? 'block' : 'none';
  });

  // Generic stock-quantity toggle -- available to any department, since
  // sarees/jewellery/accessories can all potentially sell this way, not
  // just Artificial Flowers.
  document.getElementById('admin-f-has-qty').addEventListener('change', function () {
    var on = this.checked;
    document.getElementById('admin-qty-fields').style.display = on ? 'grid' : 'none';
    document.getElementById('admin-qty-hint').style.display = on ? 'block' : 'none';
  });

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
    if (deptFilter === 'saree') products = products.filter(function (p) { return (p.department || 'saree') === 'saree'; });
    if (deptFilter === 'jewellery') products = products.filter(function (p) { return p.department === 'jewellery' || p.department === 'accessory'; });
    if (!q) return products;
    var fields = ['id', 'design', 'type', 'sareeType', 'pattern', 'series', 'category', 'colour', 'note'];
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

  var bulkSelectedIds = [];

  function priceHtml(p) {
    if (p.salePrice) {
      var pct = Math.round((1 - p.salePrice / p.price) * 100);
      return '<div class="admin-price-row">' +
        '<span class="admin-price-was">AED ' + formatAED(p.price) + '</span>' +
        '<span class="admin-price-now">AED ' + formatAED(p.salePrice) + '</span>' +
        '<span class="admin-price-pct">' + pct + '% off</span>' +
      '</div>';
    }
    return '<div style="color:var(--gold); font-weight:700; margin-bottom:4px;">AED ' + formatAED(p.price || 0) + '</div>';
  }

  // Sarees identify themselves by design + series; Jewellery and
  // Accessories don't have a series at all, so each department gets
  // its own subtitle line here rather than assuming every row is a
  // saree (which used to crash outright on any non-saree row).
  function subtitleHtml(p) {
    if (p.department === 'jewellery') {
      return p.type + (p.colour ? ' — ' + p.colour : '');
    }
    if (p.department === 'accessory') {
      return p.type || 'Accessory';
    }
    return p.design + ' — ' + seriesTitle(p.series);
  }

  function renderTable() {
    var filtered = getFilteredProducts();
    var start = (currentPage - 1) * PAGE_SIZE;
    var pageItems = filtered.slice(start, start + PAGE_SIZE);

    rowsEl.innerHTML = pageItems.map(function (p) {
      var checked = bulkSelectedIds.indexOf(p.id) !== -1;
      // Sold-out sarees can't be bulk-discounted — there's no one left
      // to sell them to at the new price, so the checkbox is omitted
      // entirely rather than shown disabled.
      var checkbox = p.sold ? '' : '<input type="checkbox" class="admin-bulk-check" data-id="' + p.id + '"' + (checked ? ' checked' : '') + '>';
      return (
        '<div class="admin-saree-card' + (p.sold ? ' is-sold' : '') + (checked ? ' bulk-selected' : '') + '">' +
          checkbox +
          '<img src="' + (p.image || '') + '" alt="' + p.id + '">' +
          '<div class="admin-saree-card-info">' +
            '<div class="admin-saree-card-id">' + p.id + '</div>' +
            '<div class="admin-saree-card-series">' + subtitleHtml(p) + '</div>' +
            priceHtml(p) +
            '<div class="admin-saree-card-bottom">' +
              (p.sold ? '<span class="admin-sold-badge">Sold out</span>' : '') +
              '<div class="admin-saree-card-actions">' +
                '<span class="admin-edit-link" data-id="' + p.id + '">Edit</span>' +
                '<span class="admin-delete-link" data-id="' + p.id + '">Delete</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    rowsEl.querySelectorAll('.admin-bulk-check').forEach(function (box) {
      box.addEventListener('change', function () {
        var id = box.getAttribute('data-id');
        var idx = bulkSelectedIds.indexOf(id);
        if (box.checked && idx === -1) bulkSelectedIds.push(id);
        else if (!box.checked && idx !== -1) bulkSelectedIds.splice(idx, 1);
        box.closest('.admin-saree-card').classList.toggle('bulk-selected', box.checked);
        updateBulkBar();
      });
    });

    renderPagination(filtered.length);
  }

  var searchClearBtn = document.getElementById('admin-search-clear-btn');
  function updateSearchClearBtn() {
    if (searchClearBtn) searchClearBtn.style.display = searchInput.value ? 'flex' : 'none';
  }
  searchInput.addEventListener('input', function () {
    searchQuery = searchInput.value;
    currentPage = 1;
    updateSearchClearBtn();
    renderTable();
  });
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function () {
      searchInput.value = '';
      searchQuery = '';
      currentPage = 1;
      updateSearchClearBtn();
      renderTable();
      searchInput.focus();
    });
  }

  var hideSoldToggle = document.getElementById('admin-hide-sold-toggle');
  if (hideSoldToggle) {
    hideSoldToggle.addEventListener('change', function () {
      hideSold = hideSoldToggle.checked;
      currentPage = 1;
      renderTable();
    });
  }

  var deptFilterRow = document.getElementById('admin-dept-filter-row');
  if (deptFilterRow) {
    deptFilterRow.querySelectorAll('.admin-dept-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deptFilterRow.querySelectorAll('.admin-dept-filter-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        deptFilter = btn.getAttribute('data-dept');
        currentPage = 1;
        renderTable();
      });
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

  var stagedRemovals = []; // filenames marked for removal — not deleted from GitHub until Save to GitHub is pressed
  var stagedUploads = []; // [{filename, dataUrl}] confirmed for upload — not committed until Save to GitHub is pressed

  function thumbSrc(url) { return previewOverrides[url] || url; }

  function getTargetId() {
    var typed = idField.value.trim().toUpperCase();
    return typed || null;
  }

  var githubFilesForId = [];
  var currentPhotosLoadTimer = null;

  // The definitive photo list for the grid: whatever GitHub actually
  // has for this ID (fetched fresh — never trusted from memory; this is
  // a read, not a commit, so it's fine to call freely), with any entry
  // not currently in the product's own images[] flagged as an orphan so
  // stray files are visible and cleanable too, not just hidden.
  function refreshCurrentPhotosGrid() {
    clearTimeout(currentPhotosLoadTimer);
    var targetId = getTargetId();
    if (!targetId) { githubFilesForId = []; renderCurrentPhotosGrid(); return; }
    currentPhotosGrid.innerHTML = '<p class="admin-id-hint">Checking GitHub\u2026</p>';
    currentPhotosLoadTimer = setTimeout(function () {
      fetch('/.netlify/functions/admin-list-product-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminToken: token, productId: targetId })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok) { currentPhotosGrid.innerHTML = '<p class="admin-id-hint">Could not check GitHub just now.</p>'; return; }
          githubFilesForId = result.data.files || [];
          selectedForRemoval = {};
          renderCurrentPhotosGrid();
        })
        .catch(function () { currentPhotosGrid.innerHTML = '<p class="admin-id-hint">Could not check GitHub just now.</p>'; });
    }, 400); // debounced — avoids firing once per keystroke while typing an ID
  }

  function renderCurrentPhotosGrid() {
    var currentFilenames = currentImages.map(function (u) { return String(u).split('/').pop(); });
    var merged = githubFilesForId
      .filter(function (f) { return stagedRemovals.indexOf(f.filename) === -1; }) // hide what's already staged to go
      .map(function (f) {
        return { filename: f.filename, url: f.url, isOrphan: currentFilenames.indexOf(f.filename) === -1, isPending: false };
      });
    // Cover the (normally momentary) case where currentImages has a
    // photo the GitHub listing hasn't caught up to yet — including any
    // just-staged upload, which the listing can't know about at all
    // until it's actually saved.
    currentImages.forEach(function (u) {
      var fname = String(u).split('/').pop();
      if (!merged.some(function (m) { return m.filename === fname; })) {
        merged.push({ filename: fname, url: u, isOrphan: false, isPending: stagedUploads.some(function (s) { return s.filename === fname; }) });
      }
    });

    currentPhotosGrid.innerHTML = merged.map(function (m) {
      return '<div class="admin-photo-card' + (m.isOrphan ? ' is-orphan' : '') + '" data-filename="' + m.filename + '">' +
        (m.isOrphan ? '<span class="admin-photo-tag">not on this saree</span>' : '') +
        (m.isPending ? '<span class="admin-photo-tag" style="color:#2e7d32;">not saved yet</span>' : '') +
        '<img src="' + thumbSrc(m.url) + '" loading="lazy" alt="">' +
        '<div class="admin-photo-name">' + m.filename + '</div>' +
        '<label style="font-size:0.68rem; display:flex; align-items:center; gap:4px; justify-content:center;"><input type="checkbox" class="admin-photo-check"' + (selectedForRemoval[m.filename] ? ' checked' : '') + '> Select</label>' +
      '</div>';
    }).join('');

    Array.from(currentPhotosGrid.querySelectorAll('.admin-photo-card')).forEach(function (card) {
      var filename = card.getAttribute('data-filename');
      card.querySelector('.admin-photo-check').addEventListener('change', function (e) {
        if (e.target.checked) selectedForRemoval[filename] = true; else delete selectedForRemoval[filename];
        updateRemoveSelectedButton();
      });
    });
    updateRemoveSelectedButton();
  }

  function updateRemoveSelectedButton() {
    var count = Object.keys(selectedForRemoval).length;
    removeSelectedBtn.disabled = count === 0;
    removeSelectedBtn.textContent = 'Remove selected (' + count + ')';
  }

  // Marks the selected photos to be removed — this does NOT touch
  // GitHub. Nothing is actually deleted until "Save to GitHub" (the
  // form's main submit) is pressed, at which point this list travels
  // alongside every other field change into one single commit. This is
  // what lets removals, uploads, and text-field edits all collapse into
  // one deploy no matter how they're combined in one editing session —
  // and as a side effect, forgetting to press Save now just means
  // nothing happened yet, never a half-applied change.
  function removeSelectedPhotos() {
    var filenames = Object.keys(selectedForRemoval);
    if (!filenames.length) return;
    filenames.forEach(function (filename) {
      if (stagedRemovals.indexOf(filename) === -1) stagedRemovals.push(filename);
      currentImages = currentImages.filter(function (u) { return String(u).split('/').pop() !== filename; });
      // If this filename was itself only staged (never actually
      // uploaded yet), there's nothing to delete from GitHub at Save
      // time — drop it from both staged lists rather than asking the
      // save to delete a file that was never created.
      var stagedIdx = stagedUploads.findIndex(function (s) { return s.filename === filename; });
      if (stagedIdx !== -1) {
        stagedUploads.splice(stagedIdx, 1);
        stagedRemovals = stagedRemovals.filter(function (f) { return f !== filename; });
      }
      delete previewOverrides[filename];
    });
    selectedForRemoval = {};
    document.getElementById('admin-remove-status').textContent =
      filenames.length + ' photo' + (filenames.length === 1 ? '' : 's') + ' marked for removal — will be deleted when you press Save to GitHub below.';
    renderCurrentPhotosGrid();
  }

  function highestExistingImageIndex(targetId) {
    var fromGithub = githubFilesForId.reduce(function (max, f) { return Math.max(max, f.index || 0); }, 0);
    var fromStaged = stagedUploads.reduce(function (max, s) {
      var m = s.filename.match(new RegExp('^' + targetId + '-(\\d+)\\.'));
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    return Math.max(fromGithub, fromStaged);
  }

  function updateUploadButtonState() {
    var targetId = getTargetId();
    var hint = document.getElementById('admin-images-hint');
    if (targetId) {
      addImageBtn.disabled = false;
      hint.style.display = 'none';
    } else {
      addImageBtn.disabled = true;
      hint.style.display = 'block';
    }
    // If the ID changes after some photos were already uploaded this
    // session, those photos were filed under the OLD id — keeping them
    // (or any not-yet-uploaded picks) around would risk a mismatched
    // filename/ID pair. Safer to clear and have the admin redo it under
    // the new ID than to guess at renaming already-committed files.
    if (uploadedForId && targetId !== uploadedForId && (currentImages.length || pendingUploads.length)) {
      currentImages = [];
      pendingUploads = [];
      renderPendingPhotosGrid();
      showStatus('error', 'The ID changed, so previously uploaded/picked photos were cleared — please redo them under the new ID.');
      uploadedForId = null;
    }
    refreshCurrentPhotosGrid();
  }

  function resizeImageFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read ' + file.name)); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error(file.name + ' is not a readable image.')); };
        img.onload = function () {
          var MAX_DIM = 1600;
          var w = img.naturalWidth, h = img.naturalHeight;
          var longest = Math.max(w, h);
          if (longest > MAX_DIM) {
            var scale = MAX_DIM / longest;
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderPendingPhotosGrid() {
    pendingPhotosGrid.innerHTML = pendingUploads.map(function (p, i) {
      return '<div class="admin-photo-card" data-i="' + i + '">' +
        '<img src="' + p.dataUrl + '" alt="">' +
        '<div class="admin-photo-name">' + p.file.name + '</div>' +
        '<label style="font-size:0.68rem; display:flex; align-items:center; gap:4px; justify-content:center;"><input type="checkbox" class="admin-photo-check"' + (p.selected ? ' checked' : '') + '> Select</label>' +
      '</div>';
    }).join('');
    Array.from(pendingPhotosGrid.querySelectorAll('.admin-photo-card')).forEach(function (card) {
      var i = Number(card.getAttribute('data-i'));
      card.querySelector('.admin-photo-check').addEventListener('change', function (e) {
        pendingUploads[i].selected = e.target.checked;
        updateUploadSelectedButton();
      });
    });
    updateUploadSelectedButton();
  }

  function updateUploadSelectedButton() {
    var count = pendingUploads.filter(function (p) { return p.selected; }).length;
    uploadSelectedBtn.style.display = pendingUploads.length ? 'inline-block' : 'none';
    uploadSelectedBtn.textContent = 'Upload selected (' + count + ')';
    uploadSelectedBtn.disabled = count === 0;
  }

  async function stagePickedFiles(fileList) {
    for (var i = 0; i < fileList.length; i++) {
      try {
        var dataUrl = await resizeImageFile(fileList[i]);
        pendingUploads.push({ file: fileList[i], dataUrl: dataUrl, selected: true });
      } catch (err) {
        showStatus('error', 'Could not read ' + fileList[i].name + ': ' + err.message);
      }
    }
    renderPendingPhotosGrid();
    fileInput.value = ''; // allow re-picking the same file(s) later if needed
  }

  // Confirms which staged photos should end up on this saree — this
  // does NOT touch GitHub yet either. It just assigns each one its
  // final filename (so the "Photos in GitHub" grid and any duplicate
  // numbering checks make sense right away) and moves it into
  // currentImages using the local copy for preview. The actual upload
  // happens together with everything else when "Save to GitHub" is
  // pressed — see removeSelectedPhotos above for why.
  function uploadSelectedPendingPhotos() {
    var targetId = getTargetId();
    if (!targetId) return; // button should be disabled/hidden in this case anyway

    var toUpload = pendingUploads.filter(function (p) { return p.selected; });
    var stillPending = pendingUploads.filter(function (p) { return !p.selected; });
    if (!toUpload.length) return;

    var nextIndex = highestExistingImageIndex(targetId) + 1;
    toUpload.forEach(function (item) {
      var filename = targetId + '-' + (nextIndex++) + '.jpg';
      var url = IMAGE_BASE_URL + filename;
      previewOverrides[url] = item.dataUrl;
      currentImages.push(url);
      stagedUploads.push({ filename: filename, dataUrl: item.dataUrl });
    });

    uploadedForId = targetId;
    pendingUploads = stillPending;
    renderPendingPhotosGrid();
    document.getElementById('admin-upload-status').textContent =
      toUpload.length + ' photo' + (toUpload.length === 1 ? '' : 's') + ' staged — will be uploaded when you press Save to GitHub below.';
    // A local re-render, not refreshCurrentPhotosGrid() — nothing
    // actually changed on GitHub yet, so there's no reason to re-fetch
    // the listing (and briefly flicker to a "Checking GitHub…" state)
    // for what's still a purely local staging action.
    renderCurrentPhotosGrid();
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

  seriesSelect.addEventListener('change', function () { updateIdSuggestion(); updateUploadButtonState(); });
  idField.addEventListener('input', function () { checkIdDuplicate(); updateUploadButtonState(); });

  // ---------- Department (Saree / Jewellery / Accessory) ----------
  // A saree keeps its existing series-based ID scheme untouched.
  // Jewellery and Accessories share the same underlying products-data.js
  // array (a "department" field is the only new thing on their rows;
  // an absent department always means "saree", so no existing saree
  // needs to change) and get their own JW/AC prefixes.
  //
  // Bangles & Bracelets are the one case where a single design comes in
  // several sizes, each of which is still sold as its own one-of-a-kind
  // physical piece: JW006-24, JW006-26, JW006-28 share the base JW006
  // but are three separate catalogue rows, each independently markable
  // as sold. The storefront groups rows sharing a base into one card
  // with a size picker; this form's "Bangle design" dropdown is the
  // admin-side mirror of that — pick an existing design to add another
  // size to it, or start a new one.
  function jewelleryFields() { return document.getElementById('admin-jewellery-only-fields'); }
  function accessoryFields() { return document.getElementById('admin-accessory-only-fields'); }
  function sareeFields() { return document.getElementById('admin-saree-only-fields'); }

  function updateDepartmentFieldVisibility() {
    var dept = departmentSelect.value;
    sareeFields().style.display = dept === 'saree' ? 'block' : 'none';
    jewelleryFields().style.display = dept === 'jewellery' ? 'block' : 'none';
    accessoryFields().style.display = dept === 'accessory' ? 'block' : 'none';
    document.getElementById('admin-f-series-field').style.display = dept === 'saree' ? 'block' : 'none';
    document.getElementById('admin-f-occasions-wrap').style.display = dept === 'saree' ? 'block' : 'none';
  }

  function bangleBaseIds() {
    // Every distinct base a Bangles & Bracelets row already belongs to,
    // derived from the part of its ID before the "-NN" size suffix —
    // reading it straight off existing IDs rather than a separate
    // stored field, since that's the one thing guaranteed to already
    // be there for every bangle row regardless of when it was added.
    var bases = {};
    (window.PRODUCTS || []).forEach(function (p) {
      if (p.department === 'jewellery' && p.type === 'Bangles & Bracelets' && p.id && p.id.indexOf('-') !== -1) {
        bases[p.id.slice(0, p.id.indexOf('-'))] = true;
      }
    });
    return Object.keys(bases).sort();
  }

  // The first product row found for a given bangle base -- used purely
  // to show a representative photo for that design in the picker below,
  // so admin staff can recognise a design by sight rather than having
  // to remember what each ID looks like.
  function bangleBaseImage(base) {
    var match = (window.PRODUCTS || []).find(function (p) {
      return p.department === 'jewellery' && p.type === 'Bangles & Bracelets' && p.id && p.id.indexOf(base + '-') === 0;
    });
    return match ? match.image : '';
  }

  var bangleBaseNewLabel = '+ New design';

  function refreshBangleBaseOptions() {
    var sel = document.getElementById('admin-f-bangle-base');
    var current = sel.value;
    var bases = bangleBaseIds();
    sel.innerHTML = '<option value="">' + bangleBaseNewLabel + '</option>' +
      bases.map(function (b) { return '<option value="' + b + '">' + b + '</option>'; }).join('');
    if (bases.indexOf(current) !== -1) sel.value = current;

    renderBanglePickerBox();
    renderBanglePickerPanel();
  }

  // Closed-state box: shows the currently-selected design's photo + ID
  // (or the dashed "+ New design" placeholder), driven purely by the
  // real <select>'s current value -- so anything that programmatically
  // changes sel.value (restoring a saved product into edit mode, say)
  // keeps the box in sync just by calling this again.
  function renderBanglePickerBox() {
    var sel = document.getElementById('admin-f-bangle-base');
    var img = document.getElementById('admin-bangle-picker-box-img');
    var ph = document.getElementById('admin-bangle-picker-box-ph');
    var label = document.getElementById('admin-bangle-picker-box-label');
    var base = sel.value;
    if (!base) {
      img.style.display = 'none';
      ph.style.display = 'flex';
      label.textContent = bangleBaseNewLabel;
    } else {
      var src = bangleBaseImage(base);
      if (src) { img.src = src; img.style.display = 'block'; ph.style.display = 'none'; }
      else { img.style.display = 'none'; ph.style.display = 'flex'; }
      label.textContent = base;
    }
  }

  // Dropdown panel content: one row per existing design (photo + ID)
  // plus the "+ New design" row, rebuilt whenever the design list
  // changes. Stays closed until the box is clicked (see the open/close
  // wiring in initSareeEditor), and clicking a row sets the real
  // <select>'s value and fires its existing 'change' listener, so the
  // ID preview and everything else downstream behaves exactly as if
  // the admin had picked the option from a plain dropdown.
  function renderBanglePickerPanel() {
    var sel = document.getElementById('admin-f-bangle-base');
    var panel = document.getElementById('admin-bangle-picker-panel');
    var picker = document.getElementById('admin-bangle-picker');
    if (!panel) return;
    var bases = bangleBaseIds();
    var current = sel.value;
    var rowsHtml = '<button type="button" class="admin-bangle-picker-option' + (current === '' ? ' is-current' : '') + '" data-base="">' +
      '<span class="admin-bangle-ph-new">+</span>' +
      '<span><span class="admin-bangle-picker-option-label">' + bangleBaseNewLabel + '</span></span>' +
      '</button>' +
      bases.map(function (b) {
        var img = bangleBaseImage(b);
        return '<button type="button" class="admin-bangle-picker-option' + (current === b ? ' is-current' : '') + '" data-base="' + b + '">' +
          (img ? '<img src="' + img + '" alt="' + b + '">' : '<span class="admin-bangle-ph-new">?</span>') +
          '<span><span class="admin-bangle-picker-option-label">' + b + '</span></span>' +
          '</button>';
      }).join('');
    panel.innerHTML = rowsHtml;
    panel.querySelectorAll('.admin-bangle-picker-option').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        sel.value = btn.getAttribute('data-base');
        sel.dispatchEvent(new Event('change'));
        renderBanglePickerBox();
        renderBanglePickerPanel();
        if (picker) picker.classList.remove('is-open');
      });
    });
  }

  // Size used to be a free-text box, so a typo ("2.4" vs "2.5" vs "24")
  // could easily create a near-duplicate size that doesn't match any
  // existing bangle's. A dropdown of every size already in use keeps
  // new entries consistent with the family, while "+ Add new size..."
  // still allows a genuinely new size (same pattern as Material above).
  var ADD_NEW_SIZE_VALUE = '__add_new_size__';

  function existingBangleSizes() {
    var sizes = {};
    (window.PRODUCTS || []).forEach(function (p) {
      if (p.department === 'jewellery' && p.type === 'Bangles & Bracelets' && p.size) sizes[p.size] = true;
    });
    return Object.keys(sizes).sort(function (a, b) { return parseFloat(a) - parseFloat(b) || a.localeCompare(b); });
  }

  function refreshBangleSizeOptions() {
    var sel = document.getElementById('admin-f-bangle-size');
    var newInput = document.getElementById('admin-f-bangle-size-new');
    var sizes = existingBangleSizes();
    sel.innerHTML = '<option value="">Select a size&hellip;</option>' +
      sizes.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join('') +
      '<option value="' + ADD_NEW_SIZE_VALUE + '">+ Add new size...</option>';
    sel.value = '';
    newInput.style.display = 'none';
    newInput.value = '';
  }

  // The size the admin actually picked/typed, whichever control holds
  // it right now — the one place this reads from, so the ID preview
  // and the saved product never disagree about which value is current.
  function currentBangleSizeValue() {
    var sel = document.getElementById('admin-f-bangle-size');
    if (sel.value === ADD_NEW_SIZE_VALUE) return document.getElementById('admin-f-bangle-size-new').value.trim();
    return sel.value.trim();
  }

  function nextBaseId(prefix, isBaseOnly) {
    // isBaseOnly: only count the part before any "-NN" suffix, so a
    // family of bangle sizes (JW006-24, JW006-26...) counts once
    // toward finding the next free base number, not three times.
    var highest = 0;
    (window.PRODUCTS || []).forEach(function (p) {
      if (!p.id || p.id.indexOf(prefix) !== 0) return;
      var rest = p.id.slice(prefix.length);
      var numPart = isBaseOnly ? rest.split('-')[0] : rest;
      var num = parseInt(numPart, 10);
      if (!isNaN(num) && num > highest) highest = num;
    });
    return prefix + String(highest + 1).padStart(3, '0');
  }

  function sizeSuffix(raw) {
    // "2.4" -> "24", "2.40" -> "24", "8" -> "08" — always exactly two
    // digits, since that's the ID format decided on (BR001-24).
    var digits = String(raw || '').replace(/\D/g, '');
    return digits.slice(-2).padStart(2, '0');
  }

  function updateBangleIdPreview() {
    var base = document.getElementById('admin-f-bangle-base').value || nextBaseId(idPrefixForType('jewellery', 'Bangles & Bracelets'), true);
    var sizeRaw = currentBangleSizeValue();
    var preview = document.getElementById('admin-bangle-id-preview');
    if (!sizeRaw) {
      preview.textContent = 'Enter a size to see the final ID (design: ' + base + ').';
      idField.value = '';
      checkIdDuplicate();
      return;
    }
    var finalId = base + '-' + sizeSuffix(sizeRaw);
    preview.textContent = 'This piece will be saved as ' + finalId + '.';
    idField.value = finalId;
    checkIdDuplicate();
  }

  function updateNonSareeIdSuggestion() {
    var dept = departmentSelect.value;
    if (!isAddMode || dept === 'saree') return;
    var isBangle = dept === 'jewellery' && document.getElementById('admin-f-jtype').value === 'Bangles & Bracelets';
    document.getElementById('admin-bangle-size-fields').style.display = isBangle ? 'grid' : 'none';
    document.getElementById('admin-bangle-id-preview').style.display = isBangle ? 'block' : 'none';
    if (isBangle) {
      refreshBangleBaseOptions();
      refreshBangleSizeOptions();
      updateBangleIdPreview();
      idHint.textContent = '';
    } else {
      var typeField = dept === 'jewellery' ? document.getElementById('admin-f-jtype') : document.getElementById('admin-f-atype');
      var prefix = idPrefixForType(dept, typeField.value);
      idField.value = nextBaseId(prefix, false);
      idHint.textContent = 'Suggested next ' + prefix + ' number. You can type your own ID instead if you prefer.';
      checkIdDuplicate();
    }
  }

  departmentSelect.addEventListener('change', function () {
    try {
      updateDepartmentFieldVisibility();
      if (isAddMode) {
        var deptLabel = departmentSelect.value === 'saree' ? 'Saree' : departmentSelect.value === 'jewellery' ? 'Jewellery' : 'Accessory';
        formTitle.textContent = 'Add New ' + deptLabel;
      }
      if (departmentSelect.value === 'saree') { updateIdSuggestion(); }
      else { updateNonSareeIdSuggestion(); }
    } catch (err) {
      alert('Error switching department: ' + err.message);
      console.error('Department switch error:', err);
    }
  });
  document.getElementById('admin-f-jtype').addEventListener('change', function () {
    try { updateNonSareeIdSuggestion(); }
    catch (err) { alert('Error switching jewellery type: ' + err.message); console.error(err); }
  });
  // Accessory types didn't need this before -- they all shared the one
  // AC prefix regardless of which type was picked. Now that Blouse
  // Material and Reusable Flowers have their own prefixes, switching
  // the Accessory type has to refresh the suggested ID too, same as
  // Jewellery already does.
  document.getElementById('admin-f-atype').addEventListener('change', function () {
    try { updateNonSareeIdSuggestion(); }
    catch (err) { alert('Error switching accessory type: ' + err.message); console.error(err); }
  });
  document.getElementById('admin-f-bangle-base').addEventListener('change', function () {
    try { updateBangleIdPreview(); }
    catch (err) { alert('Error picking bangle design: ' + err.message); console.error(err); }
  });
  // Bangle design picker: closed by default, opens on clicking the box,
  // closes again on picking a design (handled in renderBanglePickerPanel)
  // or on any click outside the picker.
  (function () {
    var picker = document.getElementById('admin-bangle-picker');
    var box = document.getElementById('admin-bangle-picker-box');
    if (!picker || !box) return;
    box.addEventListener('click', function (e) {
      e.stopPropagation();
      picker.classList.toggle('is-open');
    });
    document.addEventListener('click', function (e) {
      if (picker.classList.contains('is-open') && !picker.contains(e.target)) {
        picker.classList.remove('is-open');
      }
    });
  })();
  document.getElementById('admin-f-bangle-size').addEventListener('change', function () {
    try {
      var isNewSize = document.getElementById('admin-f-bangle-size').value === ADD_NEW_SIZE_VALUE;
      var newInput = document.getElementById('admin-f-bangle-size-new');
      newInput.style.display = isNewSize ? 'block' : 'none';
      if (isNewSize) { newInput.value = ''; newInput.focus(); }
      updateBangleIdPreview();
    } catch (err) { alert('Error picking bangle size: ' + err.message); console.error(err); }
  });
  document.getElementById('admin-f-bangle-size-new').addEventListener('input', function () {
    try { updateBangleIdPreview(); }
    catch (err) { alert('Error entering bangle size: ' + err.message); console.error(err); }
  });

  var materialSelect = document.getElementById('admin-f-material');
  var materialNewInput = document.getElementById('admin-f-material-new');
  var ADD_NEW_MATERIAL_VALUE = '__add_new__';

  function refreshMaterialOptions(selectedValue) {
    var materials = Array.from(new Set((window.PRODUCTS || []).map(function (p) { return p.material; }).filter(Boolean))).sort();
    // If editing a saree whose material somehow isn't in the catalogue-wide
    // list yet, still include it so the dropdown doesn't silently show the
    // wrong (first) option instead of what's actually saved.
    if (selectedValue && materials.indexOf(selectedValue) === -1) materials.unshift(selectedValue);
    materialSelect.innerHTML = materials.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('') +
      '<option value="' + ADD_NEW_MATERIAL_VALUE + '">+ Add new material...</option>';
    materialSelect.value = selectedValue || materials[0] || '';
    materialNewInput.style.display = 'none';
    materialNewInput.value = '';
  }
  materialSelect.addEventListener('change', function () {
    var isNew = materialSelect.value === ADD_NEW_MATERIAL_VALUE;
    materialNewInput.style.display = isNew ? 'block' : 'none';
    if (isNew) materialNewInput.focus();
  });

  function resetForm() {
    editingId = null;
    isAddMode = true;
    formTitle.textContent = 'Add New Item';
    form.reset();
    document.getElementById('admin-sale-preview').style.display = 'none';
    document.getElementById('admin-sale-price-toggle').checked = false;
    document.getElementById('admin-sale-price-wrap').style.display = 'none';
    idField.readOnly = false;
    idWrap.classList.remove('readonly');
    idWarning.style.display = 'none';
    idWrap.classList.remove('has-duplicate');
    currentImages = [];
    previewOverrides = {};
    pendingUploads = [];
    stagedRemovals = [];
    stagedUploads = [];
    selectedForRemoval = {};
    document.getElementById('admin-remove-status').textContent = '';
    document.getElementById('admin-upload-status').textContent = '';
    renderPendingPhotosGrid();
    uploadedForId = null;
    // form.reset() above already unchecks admin-f-has-qty and clears its
    // text fields, but it doesn't know about the show/hide toggling we
    // do ourselves, so that has to be reset explicitly too.
    document.getElementById('admin-qty-fields').style.display = 'none';
    document.getElementById('admin-qty-hint').style.display = 'none';
    departmentSelect.value = 'saree';
    departmentSelect.disabled = false;
    updateDepartmentFieldVisibility();
    seriesSelect.selectedIndex = 0;
    seriesSelect.disabled = false; // series stays editable when adding — it's part of how the ID gets generated
    refreshMaterialOptions();
    updateIdSuggestion();
    updateUploadButtonState();
  }

  function openFormForAdd() {
    resetForm();
    showSareeDrawer();
  }

  function openFormForEdit(id) {
    var product = (window.PRODUCTS || []).find(function (p) { return p.id === id; });
    if (!product) return;
    editingId = id;
    isAddMode = false;
    var dept = product.department || 'saree';
    formTitle.textContent = 'Edit ' + (dept === 'saree' ? 'Saree' : dept === 'jewellery' ? 'Jewellery' : 'Accessory') + ' — ' + id;
    departmentSelect.value = dept;
    departmentSelect.disabled = true; // locked while editing, same reasoning as Series below
    updateDepartmentFieldVisibility();
    idField.value = product.id;
    idField.readOnly = true;
    idWrap.classList.add('readonly');
    idWarning.style.display = 'none';
    idWrap.classList.remove('has-duplicate');
    idHint.textContent = 'Editing an existing item — ID stays fixed.';
    document.getElementById('admin-f-sale-price').value = product.salePrice || '';
    updateSalePreview();
    document.getElementById('admin-sale-price-toggle').checked = !!product.salePrice;
    document.getElementById('admin-sale-price-wrap').style.display = product.salePrice ? 'block' : 'none';
    document.getElementById('admin-f-sold').checked = !!product.sold;
    // Generic stock-quantity fields (any department) -- a legacy
    // one-of-a-kind item has no .quantity at all, so the checkbox and
    // its fields stay off/blank for those, exactly as before this
    // feature existed.
    var hasQty = product.quantity !== null && product.quantity !== undefined;
    document.getElementById('admin-f-has-qty').checked = hasQty;
    document.getElementById('admin-qty-fields').style.display = hasQty ? 'grid' : 'none';
    document.getElementById('admin-qty-hint').style.display = hasQty ? 'block' : 'none';
    document.getElementById('admin-f-quantity').value = hasQty ? product.quantity : '';
    document.getElementById('admin-f-qty-unit').value = hasQty ? (product.qtyUnit || '') : '';
    document.getElementById('admin-f-max-per-order').value = (hasQty && product.maxPerOrder) ? product.maxPerOrder : '';

    if (dept === 'saree') {
      seriesSelect.value = product.series;
      seriesSelect.disabled = true; // locked while editing — changing series after creation could orphan the existing ID scheme
      document.getElementById('admin-f-category').value = product.category || 'Budget';
      document.getElementById('admin-f-type').value = product.type || '';
      document.getElementById('admin-f-sareeType').value = product.sareeType || '';
      document.getElementById('admin-f-pattern').value = product.pattern || '';
      document.getElementById('admin-f-design').value = product.design || '';
      refreshMaterialOptions(product.material || '');
      document.getElementById('admin-f-shade').value = product.shade || 'Others';
      document.getElementById('admin-f-price').value = product.price || '';
      var savedOccasions = product.occasions || [];
      document.querySelectorAll('#admin-f-occasions input').forEach(function (cb) {
        cb.checked = savedOccasions.indexOf(cb.value) !== -1;
      });
    } else if (dept === 'jewellery') {
      document.getElementById('admin-f-jtype').value = product.type || 'Bangles & Bracelets';
      document.getElementById('admin-f-jcolour').value = product.colour || '';
      document.getElementById('admin-f-jnote').value = product.note || '';
      document.getElementById('admin-f-jprice').value = product.price || '';
      document.getElementById('admin-bangle-size-fields').style.display = 'none'; // the base/size pickers are an add-mode-only convenience
      document.getElementById('admin-bangle-id-preview').style.display = 'none';
    } else {
      document.getElementById('admin-f-atype').value = product.type || 'Reusable Flowers';
      document.getElementById('admin-f-anote').value = product.note || '';
      document.getElementById('admin-f-aprice').value = product.price || '';
    }

    currentImages = product.images ? product.images.slice() : [];
    previewOverrides = {};
    pendingUploads = [];
    stagedRemovals = [];
    stagedUploads = [];
    selectedForRemoval = {};
    document.getElementById('admin-remove-status').textContent = '';
    document.getElementById('admin-upload-status').textContent = '';
    renderPendingPhotosGrid();
    uploadedForId = product.id;
    updateUploadButtonState();
    showSareeDrawer();
  }

  document.getElementById('admin-add-new-btn').addEventListener('click', openFormForAdd);
  document.getElementById('admin-cancel-btn').addEventListener('click', hideSareeDrawer);
  addImageBtn.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    if (fileInput.files.length) stagePickedFiles(fileInput.files);
  });
  removeSelectedBtn.addEventListener('click', removeSelectedPhotos);
  uploadSelectedBtn.addEventListener('click', uploadSelectedPendingPhotos);

  /* ----- CSV download ----- */
  // Colour/Note/Quantity/Unit/Max Per Order were added to the product
  // schema in an earlier (quantity-feature) round, but were never added
  // to the CSV columns here -- meaning every CSV export/import round
  // trip silently dropped them for ANY product that had them, not just
  // the new jewellery department. Added at the end so existing column
  // positions are unaffected (parseCsv reads by header name, not index).
  var CSV_COLUMNS = ['Unique ID', 'Department', 'Series', 'Category', 'Type', 'Saree Type', 'Pattern', 'Design', 'Cost AED', 'Sale Price AED', 'Sold',
    'Image_1', 'Image_2', 'Image_3', 'Image_4', 'Image_5', 'Image_6', 'Image_7', 'Video', 'Material', 'Shade', 'Occasions',
    'Colour', 'Note', 'Quantity', 'Unit', 'Max Per Order'];

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
        p.id, p.department || 'saree', p.series, p.category, p.type, p.sareeType, p.pattern, p.design, p.price,
        p.salePrice || '',
        p.sold ? 'TRUE' : 'FALSE',
        images[0] || '', images[1] || '', images[2] || '', images[3] || '', images[4] || '', images[5] || '', images[6] || '',
        '', p.material || '', p.shade || 'Others',
        (p.occasions || []).join('|'),
        p.colour || '', p.note || '',
        (p.quantity !== null && p.quantity !== undefined) ? p.quantity : '',
        p.qtyUnit || '',
        p.maxPerOrder || ''
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

  // The five occasions a saree can be tagged with. A saree may have
  // several, stored in one pipe-separated CSV column so adding a sixth
  // occasion later needs no new column.
  var VALID_OCCASIONS = ['Bridal', 'Wedding Guest', 'Festive', 'Reception', 'Everyday'];

  // Deliberately forgiving: accepts | ; or , as separators and ignores
  // case and stray spaces, so "bridal ; festive" works as well as
  // "Bridal|Festive". Anything it genuinely can't match is returned in
  // `unknown` rather than dropped, so a typo surfaces in the upload
  // preview instead of silently removing a saree from a category.
  function parseOccasions(raw) {
    var valid = [];
    var unknown = [];
    String(raw || '')
      .split(/[|;,]/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length; })
      .forEach(function (token) {
        var match = VALID_OCCASIONS.filter(function (o) {
          return o.toLowerCase() === token.toLowerCase();
        })[0];
        if (match) {
          if (valid.indexOf(match) === -1) valid.push(match);
        } else {
          unknown.push(token);
        }
      });
    return { valid: valid, unknown: unknown };
  }

  function csvRowToProduct(row) {
    var images = [];
    for (var i = 1; i <= 7; i++) {
      var url = row['Image_' + i];
      if (url) images.push(url);
    }
    var soldRaw = (row['Sold'] || '').toLowerCase();
    var occ = parseOccasions(row['Occasions']);
    var price = parseInt(row['Cost AED'], 10) || 0;
    var salePriceRaw = parseInt(row['Sale Price AED'], 10);
    var salePrice = (salePriceRaw > 0 && salePriceRaw < price) ? salePriceRaw : null;
    // Quantity is only set when the column has a real value -- an empty
    // cell means "one-of-a-kind item, no quantity tracked at all",
    // matching how the live form's "Sold in limited quantity" checkbox
    // works (admin.js lines ~1909-1916: unchecked -> quantity: null).
    var quantityRaw = (row['Quantity'] || '').trim();
    var hasQuantity = quantityRaw !== '';
    var maxPerOrderRaw = (row['Max Per Order'] || '').trim();
    return {
      id: (row['Unique ID'] || '').trim().toUpperCase(),
      department: (row['Department'] || 'saree').trim().toLowerCase() === 'saree' ? undefined : (row['Department'] || '').trim().toLowerCase(),
      series: row['Series'] || '',
      category: row['Category'] || '',
      type: row['Type'] || '',
      sareeType: row['Saree Type'] || '',
      pattern: row['Pattern'] || '',
      design: row['Design'] || '',
      material: row['Material'] || '',
      shade: row['Shade'] || 'Others',
      colour: row['Colour'] || '',
      note: row['Note'] || '',
      price: price,
      salePrice: salePrice,
      sold: soldRaw === 'true' || soldRaw === '1' || soldRaw === 'yes',
      occasions: occ.valid,
      _unknownOccasions: occ.unknown,
      quantity: hasQuantity ? (parseInt(quantityRaw, 10) || 0) : null,
      qtyUnit: hasQuantity ? (row['Unit'] || 'pcs') : null,
      maxPerOrder: (hasQuantity && maxPerOrderRaw) ? (parseInt(maxPerOrderRaw, 10) || null) : null,
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
        var fields = ['series', 'category', 'type', 'sareeType', 'pattern', 'design', 'price', 'sold', 'salePrice',
          'material', 'shade', 'colour', 'note', 'quantity', 'qtyUnit', 'maxPerOrder'];
        for (var i = 0; i < fields.length; i++) {
          if ((a[fields[i]] || '') !== (b[fields[i]] || '')) return false;
        }
        // Occasions must be compared too, or tagging an existing saree
        // would look like "no change" and be skipped on upload.
        var occA = (a.occasions || []).slice().sort().join('|');
        var occB = (b.occasions || []).slice().sort().join('|');
        if (occA !== occB) return false;
        var imgA = a.images || [];
        var imgB = b.images || [];
        if (imgA.length !== imgB.length) return false;
        for (var j = 0; j < imgA.length; j++) {
          if (imgA[j] !== imgB[j]) return false;
        }
        return true;
      }

      var occasionProblems = [];

      rows.forEach(function (row) {
        var product = csvRowToProduct(row);
        if (!product.id) { invalidRows.push(row); return; }
        if (product._unknownOccasions && product._unknownOccasions.length) {
          occasionProblems.push(product.id + ': "' + product._unknownOccasions.join('", "') + '"');
        }
        delete product._unknownOccasions;
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

      if (occasionProblems.length) {
        // Surfaced loudly rather than silently ignored — an unrecognised
        // occasion means that saree simply won't appear in the category,
        // which is very hard to notice later.
        var shown = occasionProblems.slice(0, 8).join('<br>');
        var more = occasionProblems.length > 8
          ? '<br>…and ' + (occasionProblems.length - 8) + ' more'
          : '';
        showStatus('error',
          '<strong>' + occasionProblems.length + ' row(s) have unrecognised occasions.</strong> ' +
          'These tags will be ignored. Valid values are: ' + VALID_OCCASIONS.join(', ') + '.<br>' +
          shown + more);
      }

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

  // ---------- Bulk discount ----------
  var bulkBar = document.getElementById('admin-bulk-bar');
  var bulkMode = 'pct';

  function updateBulkBar() {
    if (!bulkSelectedIds.length) {
      bulkBar.style.display = 'none';
      return;
    }
    bulkBar.style.display = 'flex';
    document.getElementById('admin-bulk-count').textContent = bulkSelectedIds.length + ' selected';
  }

  document.getElementById('admin-bulk-mode').querySelectorAll('button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      bulkMode = btn.getAttribute('data-mode');
      document.getElementById('admin-bulk-mode').querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      var valueInput = document.getElementById('admin-bulk-value');
      valueInput.style.display = bulkMode === 'remove' ? 'none' : '';
      var applyBtn = document.getElementById('admin-bulk-apply-btn');
      applyBtn.textContent = bulkMode === 'remove' ? 'Remove offer' : 'Apply';
    });
  });

  document.getElementById('admin-bulk-clear-btn').addEventListener('click', function () {
    bulkSelectedIds = [];
    renderTable();
    updateBulkBar();
  });

  document.getElementById('admin-bulk-apply-btn').addEventListener('click', function () {
    var raw = Number(document.getElementById('admin-bulk-value').value);
    if (bulkMode !== 'remove' && (!raw || raw <= 0)) {
      showStatus('error', 'Enter a value greater than zero.');
      return;
    }

    var allProducts = (window.PRODUCTS || []).slice();
    var skipped = [];

    var updated = allProducts.map(function (p) {
      if (bulkSelectedIds.indexOf(p.id) === -1) return p;

      if (bulkMode === 'remove') {
        return Object.assign({}, p, { salePrice: null });
      }

      var newSale;
      if (bulkMode === 'pct') {
        if (raw >= 100) { skipped.push(p.id); return p; }
        newSale = Math.round(p.price * (1 - raw / 100));
      } else if (bulkMode === 'flat') {
        newSale = Math.round(p.price - raw);
      } else {
        newSale = Math.round(raw);
      }

      // Same validity rule as the individual editor: a discount that
      // would land at or above the regular price, or at/below zero,
      // isn't a real offer — skip that saree rather than save a broken
      // one, and tell the user which ones were skipped.
      if (newSale <= 0 || newSale >= p.price) { skipped.push(p.id); return p; }

      return Object.assign({}, p, { salePrice: newSale });
    });

    var applyBtn = document.getElementById('admin-bulk-apply-btn');
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying...';

    fetch('/.netlify/functions/admin-bulk-save-products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, products: updated })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showStatus('error', result.data.error || 'Bulk discount failed to save.'); return; }
        window.PRODUCTS = updated;
        var appliedCount = bulkSelectedIds.length - skipped.length;
        bulkSelectedIds = [];
        renderTable();
        updateBulkBar();
        var verb = bulkMode === 'remove' ? 'Removed the offer from ' : 'Applied a new sale price to ';
        var msg = verb + appliedCount + ' saree' + (appliedCount === 1 ? '' : 's') + '.';
        if (skipped.length) {
          msg += ' Skipped ' + skipped.length + ' (' + skipped.join(', ') + ') — the discount would have resulted in an invalid price.';
        }
        showStatus(skipped.length ? 'error' : 'success', msg);
      })
      .catch(function () { showStatus('error', 'Network error — bulk discount was not saved.'); })
      .finally(function () {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply';
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
            localStorage.removeItem(ADMIN_TOKEN_KEY);
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
    statusMsg.style.display = 'block';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    try {
    var saveBtn = document.getElementById('admin-save-btn');
    var images = currentImages.slice();
    var dept = departmentSelect.value;

    if (dept === 'saree' && materialSelect.value === ADD_NEW_MATERIAL_VALUE && !materialNewInput.value.trim()) {
      showStatus('error', 'Please type the new material, or pick an existing one instead.');
      return;
    }

    var isBangleAdd = dept === 'jewellery' && isAddMode && document.getElementById('admin-f-jtype').value === 'Bangles & Bracelets';
    if (isBangleAdd && document.getElementById('admin-f-bangle-size').value === ADD_NEW_SIZE_VALUE && !document.getElementById('admin-f-bangle-size-new').value.trim()) {
      showStatus('error', 'Please type the new size, or pick an existing one instead.');
      return;
    }

    var hasQtyChecked = document.getElementById('admin-f-has-qty').checked;
    if (hasQtyChecked && !document.getElementById('admin-f-quantity').value.trim()) {
      showStatus('error', 'Please enter a quantity, or uncheck "Sold in limited quantity".');
      return;
    }

    if (isAddMode) {
      checkIdDuplicate();
      if (idWrap.classList.contains('has-duplicate')) {
        showStatus('error', 'That ID is already in use — please choose a different one before saving.');
        return;
      }
      if (!idField.value.trim()) {
        var idHintMsg = dept === 'saree'
          ? 'Please provide an ID (or select a series to auto-generate one).'
          : (dept === 'jewellery' && document.getElementById('admin-f-jtype').value === 'Bangles & Bracelets'
            ? 'Please enter a size for this bangle so an ID can be generated.'
            : 'Please provide an ID.');
        showStatus('error', idHintMsg);
        return;
      }
    }

    var productData;
    if (dept === 'saree') {
      var materialValue = materialSelect.value === ADD_NEW_MATERIAL_VALUE
        ? materialNewInput.value.trim()
        : materialSelect.value;
      productData = {
        series: seriesSelect.value,
        category: document.getElementById('admin-f-category').value,
        type: document.getElementById('admin-f-type').value.trim(),
        material: materialValue,
        shade: document.getElementById('admin-f-shade').value,
        sareeType: document.getElementById('admin-f-sareeType').value.trim(),
        pattern: document.getElementById('admin-f-pattern').value.trim(),
        design: document.getElementById('admin-f-design').value.trim(),
        price: parseInt(document.getElementById('admin-f-price').value, 10) || 0,
        salePrice: parseSalePriceInput(),
        sold: document.getElementById('admin-f-sold').checked,
        soldAt: computeSoldAtForSave(document.getElementById('admin-f-sold').checked),
        occasions: Array.from(document.querySelectorAll('#admin-f-occasions input:checked')).map(function (cb) { return cb.value; }),
        images: images,
        image: images[0] || ''
      };
    } else if (dept === 'jewellery') {
      productData = {
        department: 'jewellery',
        type: document.getElementById('admin-f-jtype').value,
        colour: document.getElementById('admin-f-jcolour').value.trim(),
        note: document.getElementById('admin-f-jnote').value.trim(),
        price: parseInt(document.getElementById('admin-f-jprice').value, 10) || 0,
        salePrice: parseSalePriceInput(),
        sold: document.getElementById('admin-f-sold').checked,
        soldAt: computeSoldAtForSave(document.getElementById('admin-f-sold').checked),
        images: images,
        image: images[0] || ''
      };
      if (productData.type === 'Bangles & Bracelets' && isAddMode) {
        productData.baseId = idField.value.indexOf('-') !== -1 ? idField.value.slice(0, idField.value.indexOf('-')) : idField.value;
        productData.size = currentBangleSizeValue();
      }
    } else {
      productData = {
        department: 'accessory',
        type: document.getElementById('admin-f-atype').value,
        note: document.getElementById('admin-f-anote').value.trim(),
        price: parseInt(document.getElementById('admin-f-aprice').value, 10) || 0,
        salePrice: parseSalePriceInput(),
        sold: document.getElementById('admin-f-sold').checked,
        soldAt: computeSoldAtForSave(document.getElementById('admin-f-sold').checked),
        images: images,
        image: images[0] || ''
      };
    }

    // Generic stock-quantity fields, applied the same way regardless of
    // which department this item belongs to. Unchecking the box on an
    // item that previously had a quantity explicitly clears these
    // (rather than leaving stale numbers behind), reverting it back to
    // a plain one-of-a-kind item controlled only by "Sold out" above.
    if (hasQtyChecked) {
      productData.quantity = parseInt(document.getElementById('admin-f-quantity').value, 10) || 0;
      productData.qtyUnit = document.getElementById('admin-f-qty-unit').value.trim() || 'pcs';
      var maxPerOrderRaw = document.getElementById('admin-f-max-per-order').value.trim();
      productData.maxPerOrder = maxPerOrderRaw ? (parseInt(maxPerOrderRaw, 10) || null) : null;
      // A quantity-tracked item counts as sold-out once it hits 0, same
      // as the manual checkbox -- stamp/clear soldAt the same way so
      // the sold-out visibility window applies to it too.
      var existingForQty = editingId ? (window.PRODUCTS || []).find(function (p) { return p.id === editingId; }) : null;
      if (productData.quantity <= 0) {
        productData.soldAt = (existingForQty && Number(existingForQty.quantity) <= 0 && existingForQty.soldAt)
          ? existingForQty.soldAt
          : new Date().toISOString();
      } else {
        productData.soldAt = null;
      }
    } else {
      productData.quantity = null;
      productData.qtyUnit = null;
      productData.maxPerOrder = null;
    }

    var action;
    if (editingId) {
      action = 'edit';
      productData.id = editingId;
    } else {
      action = 'add';
      productData.id = idField.value.trim().toUpperCase();
      if (dept === 'saree') productData.seriesCode = SERIES_CODES[seriesSelect.value];
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    statusMsg.style.display = 'none';

    fetch('/.netlify/functions/admin-save-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminToken: token,
        action: action,
        product: productData,
        newImages: stagedUploads,
        removedImages: stagedRemovals
      })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) {
          if (result.data && result.data.error === 'Not authorized. Please sign in again.') {
            localStorage.removeItem(ADMIN_TOKEN_KEY);
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
        stagedUploads = [];
        stagedRemovals = [];
        renderTable();
        hideSareeDrawer();
      })
      .catch(function () { showStatus('error', 'Network error — changes were not saved.'); })
      .finally(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save to GitHub';
      });
    } catch (err) {
      alert('Save button error (nothing was sent to the server): ' + err.message);
      console.error('Save button error:', err);
      var btn = document.getElementById('admin-save-btn');
      if (btn) { btn.disabled = false; btn.textContent = 'Save to GitHub'; }
    }
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

  function renderStats() {
    var statsEl = document.getElementById('admin-review-stats');
    if (!statsEl) return;
    var total = reviews.length;
    var avg = total ? (reviews.reduce(function (sum, r) { return sum + (parseInt(r.stars, 10) || 0); }, 0) / total) : 0;
    var counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    reviews.forEach(function (r) { var s = parseInt(r.stars, 10); if (counts[s] !== undefined) counts[s]++; });

    statsEl.innerHTML =
      buildStatCardHtml('Average', avg.toFixed(1), 'starFilled', 'gold') +
      buildStatCardHtml('Total Reviews', total, 'star', 'gold') +
      buildStatCardHtml('5 Star', counts[5], 'starFilled', 'green') +
      buildStatCardHtml('4 Star', counts[4], 'starFilled', 'orange');
  }

  function renderTable() {
    renderStats();
    var query = document.getElementById('admin-review-search').value.trim().toLowerCase();
    var ratingVal = document.getElementById('admin-review-rating-filter').value;

    var filtered = reviews
      .map(function (r, i) { return { r: r, i: i }; })
      .filter(function (entry) {
        var r = entry.r;
        var okQuery = !query ||
          (r.name || '').toLowerCase().indexOf(query) !== -1 ||
          (r.quote || '').toLowerCase().indexOf(query) !== -1;
        var okRating = !ratingVal || String(r.stars) === ratingVal;
        return okQuery && okRating;
      });

    rowsEl.innerHTML = filtered.length ? filtered.map(function (entry) {
      var r = entry.r, i = entry.i;
      return (
        '<div class="admin-review-card">' +
          '<div class="admin-review-card-top">' +
            '<div>' +
              '<div class="admin-review-card-stars">' + starString(r.stars) + '</div>' +
              '<div class="admin-review-card-name">' + (r.name || '') + '</div>' +
            '</div>' +
            '<span class="admin-review-card-actions"><span class="admin-edit-link" data-idx="' + i + '">Edit</span> &middot; <span class="admin-delete-link" data-idx="' + i + '">Delete</span></span>' +
          '</div>' +
          (r.quote ? '<p class="admin-review-card-quote">' + r.quote + '</p>' : '') +
        '</div>'
      );
    }).join('') : '<p style="font-size:0.85rem; opacity:0.6;">No reviews match.</p>';
  }

  document.getElementById('admin-review-search').addEventListener('input', renderTable);
  document.getElementById('admin-review-rating-filter').addEventListener('change', renderTable);

  function loadReviews() {
    fetch('assets/reviews/reviews.json?_=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (data) {
        reviews = data || [];
        renderTable();
      })
      .catch(function () { rowsEl.innerHTML = '<p style="font-size:0.85rem; opacity:0.6;">Could not load reviews.</p>'; });
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
  var SLOT_COUNT = 5;
  var banners = [];

  // Values go into value="..." attributes, so a stray quote or angle
  // bracket in the copy would otherwise break the field markup.
  // Textarea content sits between tags, not in an attribute, so it
  // needs the angle brackets escaped but not the quotes.
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function emptySlot() {
    return { image: '', mobileImage: '', link: 'collections.html', hideText: false, eyebrow: '', heading: '', description: '', seconds: 5 };
  }

  function normalizeSlots(list) {
    var out = (Array.isArray(list) ? list.slice(0, SLOT_COUNT) : []).map(function (b) {
      return {
        image: (b && b.image) || '',
        mobileImage: (b && b.mobileImage) || '',
        link: (b && b.link) || 'collections.html',
        hideText: !!(b && b.hideText),
        // Per-slot banner copy. Blank means "use the default wording
        // already in home.html", so existing banners are unaffected
        // until someone actually types something here.
        eyebrow: (b && b.eyebrow) || '',
        heading: (b && b.heading) || '',
        // Third line of copy — already hidden on phones by the site's
        // own CSS, so it's labelled desktop-only in the form.
        description: (b && b.description) || '',
        // How long this slot stays on screen. Falls back to the old
        // fixed behaviour (3s for the first, 5s after) when unset.
        seconds: Number(b && b.seconds) > 0 ? Number(b.seconds) : ''
      };
    });
    while (out.length < SLOT_COUNT) out.push(emptySlot());
    return out;
  }

  function showStatus(type, html) {
    statusMsg.className = 'admin-status-msg ' + type;
    statusMsg.innerHTML = html;
    statusMsg.style.display = 'block';
  }

  function renderList() {
    listEl.innerHTML = '';
    banners.forEach(function (b, i) {
      var isEmpty = !b.image;
      var row = document.createElement('div');
      row.className = 'admin-banner-item' + (isEmpty ? ' admin-banner-item-empty' : '');
      row.innerHTML =
        '<strong style="display:block; margin-bottom:8px;">Slot ' + (i + 1) + '<span class="admin-banner-slot-badge' + (isEmpty ? ' is-empty' : '') + '">' + (isEmpty ? 'Empty' : 'Active') + '</span></strong>' +
        '<div class="admin-banner-thumbs">' +
          (b.image
            ? '<img class="thumb-desktop" src="assets/banners/' + b.image + '" alt="desktop">'
            : '<span class="thumb-desktop thumb-mobile-empty" title="No image assigned">&mdash;</span>') +
          (b.mobileImage
            ? '<img class="thumb-mobile" src="assets/banners/' + b.mobileImage + '" alt="mobile" title="Mobile image: ' + b.mobileImage + '">'
            : '<span class="thumb-mobile thumb-mobile-empty" title="No mobile image set">&mdash;</span>') +
        '</div>' +
        '<div class="admin-field"><label>Image file (desktop, wide)</label><input type="text" value="' + b.image + '" data-role="image" placeholder="Empty — this slot is skipped"></div>' +
        '<div class="admin-field"><label>Mobile image (portrait, optional)</label><input type="text" value="' + (b.mobileImage || '') + '" data-role="mobileImage" placeholder="Empty = reuse desktop image"></div>' +
        '<div class="admin-field"><label>Link</label><input type="text" value="' + (b.link || '') + '" data-role="link"></div>' +
        '<div class="admin-field"><label>Small text above heading</label><input type="text" value="' + escAttr(b.eyebrow) + '" data-role="eyebrow" placeholder="Kancheepuram \u2014 to Dubai"></div>' +
        '<div class="admin-field"><label>Heading</label><input type="text" value="' + escAttr(b.heading) + '" data-role="heading" placeholder="Silk woven by hand, carried across the sea for you."></div>' +
        '<div class="admin-field"><label>Description <span style="background:#FAEEDA; color:#854F0B; font-size:0.6rem; font-weight:700; padding:2px 7px; border-radius:4px; letter-spacing:0.04em;">DESKTOP ONLY</span></label>' +
          '<textarea rows="3" data-role="description" placeholder="Pavnika by Saranya is a Dubai-based boutique bringing genuine Kanjivaram silk sarees to the UAE\u2026">' + escHtml(b.description) + '</textarea>' +
          '<p style="font-size:0.68rem; opacity:0.55; margin:4px 0 0;">Hidden on phones \u2014 the banner is too short to fit it there.</p></div>' +
        '<div class="admin-field"><label>Show for</label>' +
          '<div style="display:flex; align-items:center; gap:8px;">' +
            '<input type="number" min="1" max="60" step="1" value="' + (b.seconds || '') + '" data-role="seconds" placeholder="5" style="width:80px;">' +
            '<span style="font-size:0.8rem; opacity:0.7;">seconds</span>' +
          '</div>' +
          '<p style="font-size:0.68rem; opacity:0.55; margin:4px 0 0;">Leave blank for the default (3s on the first slot, 5s after).</p></div>' +
        '<div class="admin-field admin-field-check"><label style="display:flex; align-items:center; gap:8px; cursor:pointer;">' +
          '<input type="checkbox" data-role="hideText"' + (b.hideText ? ' checked' : '') + ' style="width:auto;"> Hide text &amp; buttons (full image clickable)</label></div>' +
        '<div class="admin-banner-controls">' +
          '<button type="button" data-action="up" title="Move up">&uarr;</button>' +
          '<button type="button" data-action="down" title="Move down">&darr;</button>' +
          '<button type="button" data-action="remove" class="admin-banner-remove" title="Clear this slot">&times;</button>' +
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
        hideText: row.querySelector('[data-role="hideText"]').checked,
        eyebrow: row.querySelector('[data-role="eyebrow"]').value.trim(),
        heading: row.querySelector('[data-role="heading"]').value.trim(),
        description: row.querySelector('[data-role="description"]').value.trim(),
        seconds: Number(row.querySelector('[data-role="seconds"]').value) || ''
      };
    });
  }

  function loadBanners() {
    fetch('assets/banners/banners.json?_=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (data) {
        banners = normalizeSlots(data);
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
      banners[idx] = emptySlot();
    }
    renderList();
  });

  document.getElementById('admin-banner-refresh-btn').addEventListener('click', function () {
    loadBanners();
    showStatus('success', 'Reloaded the current banner slots from GitHub.');
  });

  document.getElementById('admin-banner-save-btn').addEventListener('click', function () {
    readListFromDom();
    if (!banners.some(function (b) { return b.image; })) {
      showStatus('error', 'At least one slot needs an image — use Refresh to restore the list if you cleared them all by mistake.');
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
  var latestOrderStats = null;
  var activeChartSeries = 'revenue';
  var adminChartType = 'bar';

  // A "nice" axis step (1/2/5 x a power of ten) so tick labels land on
  // round numbers instead of whatever the data happens to range over --
  // same helper as the offline finance tool's trend chart.
  function niceAxisStep(range, targetTicks) {
    if (!range) return 1;
    var rawStep = range / targetTicks;
    var mag = Math.pow(10, Math.floor(Math.log(rawStep) / Math.LN10));
    var residual = rawStep / mag;
    var step;
    if (residual > 5) step = 10 * mag;
    else if (residual > 2) step = 5 * mag;
    else if (residual > 1) step = 2 * mag;
    else step = mag;
    return step;
  }
  function formatAxisTick(v) {
    if (v === 0) return '0';
    var sign = v < 0 ? '-' : '';
    var av = Math.abs(v);
    if (av >= 1000) return sign + (av % 1000 === 0 ? (av / 1000) : (av / 1000).toFixed(1)) + 'K';
    return sign + Math.round(av);
  }
  // Catmull-Rom to cubic-Bezier -- a smooth curve that still passes
  // exactly through every data point, used for the "Line" chart style.
  function smoothChartPath(pts) {
    if (pts.length < 2) return '';
    var d = 'M' + pts[0].x.toFixed(1) + ',' + pts[0].y.toFixed(1) + ' ';
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[i + 2] || p2;
      var c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      var c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += 'C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' ' + p2.x.toFixed(1) + ',' + p2.y.toFixed(1) + ' ';
    }
    return d;
  }

  function showStatus(type, html) {
    statusMsg.className = 'admin-status-msg ' + type;
    statusMsg.innerHTML = html;
    statusMsg.style.display = 'block';
  }

  function findProductLabel(id) {
    var p = (window.PRODUCTS || []).find(function (x) { return x.id === id; });
    if (!p) return id;
    // Jewellery/accessories don't have a "design" field (only sarees
    // do) -- falling through to .type (and finally the bare id) avoids
    // showing a literal "undefined — AC001" for those rows, which is
    // what the plain `p.design` lookup used to produce.
    var name = p.design || p.type || '';
    return name ? (name + ' — ' + id) : id;
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

  function renderStats(data, orderStats) {
    latestStats = data;
    latestOrderStats = orderStats;
    var inStock = (window.PRODUCTS || []).filter(function (p) { return !isEffectivelySold(p); }).length;
    var soldOut = (window.PRODUCTS || []).filter(function (p) { return isEffectivelySold(p); }).length;

    if (data.filtered) {
      showStatus('success', 'Showing results for the selected date range.');
    } else {
      statusMsg.style.display = 'none';
    }

    function deltaHtml(pct) {
      if (pct === null || pct === undefined) return '';
      var sign = pct > 0 ? '+' : '';
      var cls = pct >= 0 ? '' : ' negative';
      var label = (orderStats && orderStats.isDefaultWeek) ? 'vs last week' : 'vs previous period';
      return '<p class="delta' + cls + '">' + sign + pct + '% ' + label + '</p>';
    }

    function countDeltaHtml(count, verb) {
      if (!count) return '';
      var periodLabel = (orderStats && orderStats.isDefaultWeek) ? 'this week' : 'this period';
      return '<p class="delta">+' + count + ' ' + verb + ' ' + periodLabel + '</p>';
    }

    var soldDelta = orderStats ? countDeltaHtml(orderStats.newlySoldCount, 'sold') : '';
    // In Stock's delta mirrors Sold Out's exactly, since every saree that
    // sells reduces stock by exactly one — this holds as long as no new
    // sarees were also added to the catalogue in the same window, which
    // isn't separately tracked, so treat this as a close estimate rather
    // than a guaranteed-exact count if new stock was added mid-period.
    var stockPeriodLabel = (orderStats && orderStats.isDefaultWeek) ? 'this week' : 'this period';
    var stockDelta = orderStats && orderStats.newlySoldCount ? '<p class="delta negative">-' + orderStats.newlySoldCount + ' sold ' + stockPeriodLabel + '</p>' : '';

    // Only shown once jewellery/accessories actually have real sales in
    // this period — a saree-only business (or a saree-only date range)
    // sees the Revenue card exactly as it always has, with nothing new
    // to look at.
    function departmentBreakdownHtml(split) {
      if (!split || (split.jewellery <= 0 && split.accessory <= 0)) return '';
      var fmt = function (n) { return Math.round(n).toLocaleString(); };
      return '<p class="admin-dept-breakdown">Sarees AED ' + fmt(split.saree) +
        ' &middot; Jewellery AED ' + fmt(split.jewellery) +
        ' &middot; Accessories AED ' + fmt(split.accessory) + '</p>';
    }

    var hasJewelleryOrAccessory = (window.PRODUCTS || []).some(function (p) { return p.department === 'jewellery' || p.department === 'accessory'; });

    // ---- Primary 6-card row: Total Orders / Sold Out / Total Revenue /
    // Processing / Completed / Cancelled. Per-card sparklines were tried
    // and then deliberately dropped -- the trend line belongs to the
    // Sales Overview chart below (which already covers Revenue/Orders/
    // Visitors), not repeated on every card. ----
    var totalOrdersCard = buildStatCardHtml('Total Orders', orderStats ? orderStats.orderCount : 0, 'box', 'gold',
      orderStats ? deltaHtml(orderStats.orderCountDelta) : '');
    var soldOutCard = hasJewelleryOrAccessory
      ? buildSplitStatCardHtml('Sold Out', (window.PRODUCTS || []).filter(function (p) { return isEffectivelySold(p) && (p.department || 'saree') === 'saree'; }).length,
          (window.PRODUCTS || []).filter(function (p) { return isEffectivelySold(p) && (p.department === 'jewellery' || p.department === 'accessory'); }).length, 'hangerX', 'red', soldDelta)
      : buildStatCardHtml('Sold Out', soldOut, 'hangerX', 'red', soldDelta);
    var totalRevenueCard = buildStatCardHtml('Total Revenue (AED)', orderStats ? orderStats.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 }) : 0, 'wallet', 'gold',
      (orderStats ? deltaHtml(orderStats.revenueDelta) : '') + (orderStats ? departmentBreakdownHtml(orderStats.departmentRevenue) : ''));
    var processingCard = buildStatCardHtml('Processing', orderStats ? orderStats.processingCount : 0, 'clock', 'orange');
    var completedCard = buildStatCardHtml('Completed', orderStats ? orderStats.completedCount : 0, 'check', 'green');
    var cancelledCard = buildStatCardHtml('Cancelled', orderStats ? orderStats.cancelledCount : 0, 'cross', 'red');

    metricGrid.innerHTML = totalOrdersCard + soldOutCard + totalRevenueCard + processingCard + completedCard + cancelledCard;

    // ---- Secondary row: the data that used to headline the dashboard
    // (In stock / Verified visitors / Saree views logged) still matters,
    // just not at the same visual priority as the order-flow numbers
    // above -- it stays one scroll away, not gone. ----
    var inStockCard = hasJewelleryOrAccessory
      ? buildSplitStatCardHtml('In stock', (window.PRODUCTS || []).filter(function (p) { return !isEffectivelySold(p) && (p.department || 'saree') === 'saree'; }).length,
          (window.PRODUCTS || []).filter(function (p) { return !isEffectivelySold(p) && (p.department === 'jewellery' || p.department === 'accessory'); }).length, 'hanger', 'green', stockDelta)
      : buildStatCardHtml('In stock', inStock, 'hanger', 'green', stockDelta);
    document.getElementById('admin-metric-grid-secondary').innerHTML =
      inStockCard +
      buildStatCardHtml('Verified visitors', data.totalVisitors, 'users', 'gold') +
      buildStatCardHtml('Saree views logged', data.totalViews, 'eye', 'gold');

    if (orderStats) {
      renderSalesChart();
      renderRecentOrders(orderStats.recentOrders);
    }

    function findProductImage(id) {
      var p = (window.PRODUCTS || []).find(function (x) { return x.id === id; });
      return p ? p.image : '';
    }
    renderScrollablePanel(
      mostViewedRows,
      data.mostViewed,
      function (v) {
        var img = findProductImage(v.productId);
        return '<div class="admin-rank-row admin-rank-row-with-img">' +
          '<span style="display:flex; align-items:center; gap:9px;">' +
            (img ? '<img src="' + img + '" class="admin-rank-thumb">' : '') +
            findProductLabel(v.productId) +
          '</span>' +
          '<span class="rank-value">' + v.views + ' view' + (v.views === 1 ? '' : 's') + '</span>' +
        '</div>';
      },
      'No views logged yet.',
      'Most Viewed Items'
    );

    regionsRows.innerHTML = buildDonutHtml(
      data.regions.map(function (r, i) {
        var pieColors = ['#3C1223', '#B68A69', '#DED0C7', '#946B4A', '#8a6f63', '#c9b8a8'];
        return { label: r.country, count: r.count, color: pieColors[i % pieColors.length] };
      }),
      'Visitors',
      true // scrollable legend -- caps Visitor Regions to the same height as Most Viewed Items alongside it
    );
    wireDonutLegendScroll(regionsRows);

    renderLoginsList();
  }

  function renderLoginsList() {
    if (!latestStats) return;
    var showFull = document.getElementById('admin-show-emails-toggle').checked;
    renderScrollablePanel(
      loginsRows,
      latestStats.recentLogins,
      function (v) {
        var emailDisplay = showFull ? (v.email || '') : maskEmail(v.email);
        var location = v.country ? (v.region ? v.region + ', ' + v.country : v.country) : 'Unknown';
        return '<div class="admin-rank-row"><span>' + emailDisplay + '<br><span style="font-size:0.7rem; opacity:0.6;">' + location + '</span></span><span style="color:var(--ink); opacity:0.6; font-weight:400;">' + timeAgo(v.verified_at) + '</span></div>';
      },
      'No logins yet.',
      'Recent logins'
    );
  }

  document.getElementById('admin-show-emails-toggle').addEventListener('change', renderLoginsList);

  document.querySelectorAll('.admin-chart-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.admin-chart-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      activeChartSeries = tab.getAttribute('data-chart-series');
      renderSalesChart();
    });
  });

  document.querySelectorAll('[data-view-jump]').forEach(function (link) {
    link.addEventListener('click', function () {
      var target = document.querySelector('.admin-nav-item[data-view="' + link.getAttribute('data-view-jump') + '"]');
      if (target) target.click();
    });
  });

  // Orders/revenue stats are computed entirely from the same order
  // list the Orders tab already fetches — no separate backend
  // aggregation needed. Only these statuses represent a genuine
  // completed sale; pending/cancelled/payment_error/refunded don't
  // count toward revenue. A partially-refunded order still counts —
  // netOrderRevenue() below reduces it by whatever was actually
  // refunded in cash/bank transfer (gift-card refunds don't reduce
  // revenue, since the money never actually left the business).
  var REVENUE_STATUSES = ['paid', 'shipped', 'delivered', 'delivered_direct_pay', 'partially_refunded'];

  // UTC-based deliberately (not local time) -- matches the day-bucketing
  // admin-get-stats.js does server-side for dailyVisitors, so the two
  // line up when visitorsSeries below is read from that lookup instead
  // of computed fresh from a (truncated, max-50) client-side list.
  function dayKey(iso) {
    var d = new Date(iso);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }

  function computeOrderStats(allOrders, fromDate, toDate, dailyVisitorsRaw) {
    var isAllTime = fromDate === 'ALL_TIME';
    var now = new Date();
    var rangeEnd = toDate ? new Date(toDate + 'T23:59:59') : now;
    var rangeStart = isAllTime ? new Date(0) // genuinely unbounded — every order ever placed
      : fromDate ? new Date(fromDate.indexOf('T') !== -1 ? fromDate : fromDate + 'T00:00:00')
      : new Date(rangeEnd.getTime() - 6 * 86400000); // undecided yet -> default: last 7 days
    var rangeLengthMs = rangeEnd.getTime() - rangeStart.getTime();
    var prevEnd = new Date(rangeStart.getTime() - 1);
    var prevStart = new Date(prevEnd.getTime() - rangeLengthMs);

    var revenueOrders = allOrders.filter(function (o) { return REVENUE_STATUSES.indexOf(o.status) !== -1; });

    function withinRange(o, start, end) {
      var t = new Date(o.created_at).getTime();
      return t >= start.getTime() && t <= end.getTime();
    }

    var current = revenueOrders.filter(function (o) { return withinRange(o, rangeStart, rangeEnd); });
    // A "vs previous period" comparison is meaningless for All-time —
    // there is no period before all of history — so it's skipped
    // entirely rather than comparing against an empty, arbitrary
    // pre-epoch window.
    var previous = isAllTime ? [] : revenueOrders.filter(function (o) { return withinRange(o, prevStart, prevEnd); });

    var currentRevenue = current.reduce(function (sum, o) { return sum + netOrderRevenue(o); }, 0);
    var previousRevenue = previous.reduce(function (sum, o) { return sum + netOrderRevenue(o); }, 0);

    function pctChange(cur, prev) {
      if (prev === 0) return cur > 0 ? 100 : 0;
      return Math.round(((cur - prev) / prev) * 100);
    }

    var dailyMap = {};
    current.forEach(function (o) {
      var key = dayKey(o.created_at);
      dailyMap[key] = (dailyMap[key] || 0) + netOrderRevenue(o);
    });

    // Same day-bucketing, but over ALL orders in range (any status) --
    // feeds both the "Orders" tab of the Sales Overview chart and the
    // per-card sparklines on the stat row (Processing/Completed/
    // Cancelled), so every card's trend line is a genuine day-by-day
    // count rather than a single current-vs-previous-period number.
    var allInRange = allOrders.filter(function (o) { return withinRange(o, rangeStart, rangeEnd); });
    var ordersCountMap = {}, processingMap = {}, completedMap = {}, cancelledMap = {};
    allInRange.forEach(function (o) {
      var key = dayKey(o.created_at);
      ordersCountMap[key] = (ordersCountMap[key] || 0) + 1;
      if (o.status === 'paid' || o.status === 'shipped') processingMap[key] = (processingMap[key] || 0) + 1;
      if (o.status === 'delivered' || o.status === 'delivered_direct_pay') completedMap[key] = (completedMap[key] || 0) + 1;
      if (['cancelled', 'refunded', 'refunded_giftcard', 'payment_error'].indexOf(o.status) !== -1) cancelledMap[key] = (cancelledMap[key] || 0) + 1;
    });

    // dailyVisitorsRaw comes from admin-get-stats.js, already bucketed
    // server-side as [{date: 'YYYY-MM-DD', count}] (UTC day keys) -- turn
    // it into a lookup so it can be walked with the exact same
    // rangeStart/rangeEnd cursor as everything else below, rather than
    // trusting its own (possibly sparse, gap-y) day list to line up.
    var visitorsByDay = {};
    (dailyVisitorsRaw || []).forEach(function (d) { visitorsByDay[d.date] = d.count; });

    var dailyPoints = [], ordersSeries = [], processingSeries = [], completedSeries = [], cancelledSeries = [], visitorsSeries = [];
    var cursor = new Date(rangeStart);
    while (cursor <= rangeEnd) {
      var key = dayKey(cursor.toISOString());
      dailyPoints.push({ date: cursor.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), revenue: dailyMap[key] || 0 });
      ordersSeries.push(ordersCountMap[key] || 0);
      processingSeries.push(processingMap[key] || 0);
      completedSeries.push(completedMap[key] || 0);
      cancelledSeries.push(cancelledMap[key] || 0);
      visitorsSeries.push(visitorsByDay[key] || 0);
      cursor.setDate(cursor.getDate() + 1);
    }

    var currentSareeIds = {};
    current.forEach(function (o) {
      try { JSON.parse(o.items || '[]').forEach(function (it) { currentSareeIds[it.id] = true; }); } catch (e) {}
    });
    var newlySoldCount = Object.keys(currentSareeIds).length;

    return {
      orderCount: current.length,
      revenue: currentRevenue,
      departmentRevenue: departmentRevenueSplit(current),
      orderCountDelta: isAllTime ? null : pctChange(current.length, previous.length),
      revenueDelta: isAllTime ? null : pctChange(currentRevenue, previousRevenue),
      newlySoldCount: newlySoldCount,
      isDefaultWeek: !fromDate && !toDate,
      isAllTime: isAllTime,
      dailyPoints: dailyPoints,
      ordersSeries: ordersSeries,
      visitorsSeries: visitorsSeries,
      processingCount: allOrders.filter(function (o) { return o.status === 'paid' || o.status === 'shipped'; }).length,
      processingSeries: processingSeries,
      completedCount: allOrders.filter(function (o) { return o.status === 'delivered' || o.status === 'delivered_direct_pay'; }).length,
      completedSeries: completedSeries,
      cancelledCount: allOrders.filter(function (o) { return ['cancelled', 'refunded', 'refunded_giftcard', 'payment_error'].indexOf(o.status) !== -1; }).length,
      cancelledSeries: cancelledSeries,
      recentOrders: allOrders.slice(0, 20) // "recent" is always just the newest, independent of the date filter
    };
  }

  // One chart, three tabs. "Revenue" plots orderStats.dailyPoints (AED);
  // "Orders" plots orderStats.ordersSeries (a plain count, any status,
  // computed client-side from the same order list the Orders tab
  // already fetches); "Visitors" plots orderStats.visitorsSeries, which
  // is re-aligned (in computeOrderStats, above) from dailyVisitors --
  // bucketed server-side by admin-get-stats.js from the full
  // verified-visitor list for the selected range, since the client only
  // ever receives the newest 50 of those (recentLogins) -- not enough
  // to chart a 30-day range accurately on its own.
  // Grouped-bar-chart's single-series sibling: a bar chart (default) or
  // smooth line chart, with a labelled Y axis, up to 6 evenly-spaced X
  // labels, and a hover/tap tooltip per bar or point -- same mechanism
  // as the offline finance tool's Revenue & Profit Trend chart,
  // including drawing the chart at the card's own *measured* width
  // (not a fixed size) so it always fills the card on phone or desktop,
  // and HTML divs instead of SVG <text> for every label (SVG text
  // wasn't rendering reliably in this environment).
  function renderSalesChart() {
    var chartEl = document.getElementById('admin-revenue-chart');
    if (!chartEl || !latestOrderStats) return;

    var dates = latestOrderStats.dailyPoints.map(function (p) { return p.date; });
    var values, emptyMessage, color, formatValue;
    if (activeChartSeries === 'orders') {
      values = latestOrderStats.ordersSeries;
      emptyMessage = 'No orders in this range yet.';
      color = '#3C1223';
      formatValue = function (v) { return String(Math.round(v)); };
    } else if (activeChartSeries === 'visitors') {
      values = latestOrderStats.visitorsSeries;
      emptyMessage = 'No verified visitors in this range yet.';
      color = '#946B4A';
      formatValue = function (v) { return String(Math.round(v)); };
    } else {
      values = latestOrderStats.dailyPoints.map(function (p) { return p.revenue; });
      emptyMessage = 'No revenue in this range yet.';
      color = '#B68A69';
      formatValue = function (v) { return 'AED ' + Math.round(v).toLocaleString(); };
    }

    if (!values.length || values.every(function (v) { return v === 0; })) {
      chartEl.innerHTML = '<p style="font-size:0.82rem; opacity:0.6;">' + emptyMessage + '</p>';
      return;
    }

    var n = values.length;
    var isMobile = window.innerWidth <= 560;
    var h = isMobile ? 190 : 220, padTop = 14, padBottom = isMobile ? 26 : 30, leftM = isMobile ? 38 : 48, rightM = 8;
    var w = Math.max(260, chartEl.clientWidth || 480);
    var plotW = w - leftM - rightM;

    var maxV = Math.max.apply(null, values), minV = Math.min(0, Math.min.apply(null, values));
    var step = niceAxisStep(Math.max(maxV - minV, 1), 5);
    var niceMax = Math.ceil(maxV / step) * step;
    var niceMin = Math.floor(minV / step) * step;
    if (niceMax === niceMin) niceMax = niceMin + step;
    var plotH = h - padTop - padBottom;
    function scaleY(v) { return padTop + (1 - (v - niceMin) / (niceMax - niceMin)) * plotH; }
    var zeroY = scaleY(0);
    var plotBottom = padTop + plotH;

    var tickVals = [];
    for (var tv = niceMin; tv <= niceMax + step * 1e-6; tv += step) tickVals.push(Math.round(tv * 100) / 100);

    var gridLines = '', tickLabels = '';
    tickVals.forEach(function (t) {
      var y = scaleY(t);
      gridLines += '<line x1="' + leftM + '" y1="' + y.toFixed(1) + '" x2="' + (leftM + plotW) + '" y2="' + y.toFixed(1) + '" stroke="#eee1d6" stroke-width="1"/>';
      tickLabels += '<div class="admin-chart-axis-tick" style="left:0; top:' + y.toFixed(1) + 'px; width:' + (leftM - 6) + 'px; transform:translateY(-50%); text-align:right;">' + formatAxisTick(t) + '</div>';
    });
    var axisLines = '<line x1="' + leftM + '" y1="' + padTop + '" x2="' + leftM + '" y2="' + plotBottom + '" stroke="var(--stone)" stroke-width="1.5"/>' +
      '<line x1="' + leftM + '" y1="' + zeroY.toFixed(1) + '" x2="' + (leftM + plotW) + '" y2="' + zeroY.toFixed(1) + '" stroke="#c9b6a9" stroke-width="1.5"/>';

    // Up to 6 (fewer on a phone) evenly-spaced date labels along the x
    // axis -- showing every single day's label would overlap when
    // there are dozens of points.
    var maxLabels = Math.min(isMobile ? 4 : 6, n);
    var labelIndices = [];
    for (var li = 0; li < maxLabels; li++) {
      var idx = maxLabels > 1 ? Math.round(li * (n - 1) / (maxLabels - 1)) : 0;
      if (labelIndices.indexOf(idx) === -1) labelIndices.push(idx);
    }
    var monthLabels = '';
    labelIndices.forEach(function (idx) {
      var x = leftM + (idx + 0.5) * (plotW / n);
      monthLabels += '<div class="admin-chart-month-label" style="left:' + x.toFixed(1) + 'px; top:' + plotBottom + 'px; transform:translate(-50%, 6px);">' + dates[idx] + '</div>';
    });

    var marks = '';
    if (adminChartType === 'bar') {
      var groupW = plotW / n;
      var barW = Math.min(isMobile ? 10 : 18, groupW * 0.6);
      values.forEach(function (v, i) {
        var x = leftM + (i + 0.5) * groupW - barW / 2;
        var y1 = scaleY(Math.max(v, 0));
        var y2 = scaleY(Math.min(v, 0));
        var barH = Math.max(1, y2 - y1);
        var topY = Math.min(y1, y2);
        marks += '<rect class="admin-chart-mark" data-cx="' + (x + barW / 2).toFixed(1) + '" data-cy="' + (topY - 8).toFixed(1) + '" data-label="' + dates[i] + '" data-value="' + formatValue(v) + '" x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + barH.toFixed(1) + '" rx="2" fill="' + color + '" opacity="0.88"/>';
      });
    } else {
      var pts = values.map(function (v, i) { return { x: leftM + (i + 0.5) * (plotW / n), y: scaleY(v) }; });
      marks += '<path d="' + smoothChartPath(pts) + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
      values.forEach(function (v, i) {
        var x = leftM + (i + 0.5) * (plotW / n), y = scaleY(v);
        marks += '<circle class="admin-chart-mark" data-cx="' + x.toFixed(1) + '" data-cy="' + (y - 10).toFixed(1) + '" data-label="' + dates[i] + '" data-value="' + formatValue(v) + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="9" fill="transparent"/>' +
          '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.8" fill="' + color + '" style="pointer-events:none;"/>';
      });
    }

    var svg = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="display:block;">' + gridLines + axisLines + marks + '</svg>';
    chartEl.innerHTML = '<div style="position:relative; width:' + w + 'px; height:' + h + 'px;">' + svg + tickLabels + monthLabels +
      '<div class="admin-chart-tooltip" id="admin-chart-tooltip"></div></div>';
    wireChartTooltips();
  }

  // Hover (desktop) / tap (mobile, no real hover) tooltip wiring for
  // whatever renderSalesChart() just drew -- called after every
  // innerHTML replacement since listeners don't survive that.
  function wireChartTooltips() {
    var tooltip = document.getElementById('admin-chart-tooltip');
    if (!tooltip) return;
    function showTip(el) {
      tooltip.innerHTML = '<div style="font-weight:600;">' + el.getAttribute('data-label') + '</div><div>' + el.getAttribute('data-value') + '</div>';
      tooltip.style.left = el.getAttribute('data-cx') + 'px';
      tooltip.style.top = el.getAttribute('data-cy') + 'px';
      tooltip.style.display = 'block';
    }
    function hideTip() { tooltip.style.display = 'none'; }
    document.querySelectorAll('#admin-revenue-chart .admin-chart-mark').forEach(function (el) {
      el.addEventListener('mouseenter', function () { showTip(el); });
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('touchstart', function (e) { e.preventDefault(); showTip(el); }, { passive: false });
    });
    document.addEventListener('touchstart', function (e) {
      if (!e.target.closest('.admin-chart-mark')) hideTip();
    }, { passive: true });
  }

  (function initChartTypeToggle() {
    var barBtn = document.getElementById('admin-chart-bar-btn');
    var lineBtn = document.getElementById('admin-chart-line-btn');
    if (barBtn) barBtn.addEventListener('click', function () {
      adminChartType = 'bar'; barBtn.classList.add('active'); lineBtn.classList.remove('active'); renderSalesChart();
    });
    if (lineBtn) lineBtn.addEventListener('click', function () {
      adminChartType = 'line'; lineBtn.classList.add('active'); barBtn.classList.remove('active'); renderSalesChart();
    });
    // Redraw (not refetch) on resize so the chart keeps filling the
    // card's actual width -- e.g. rotating a phone, or the browser
    // window being resized on desktop.
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var el = document.getElementById('admin-revenue-chart');
        if (el && el.offsetParent) renderSalesChart();
      }, 200);
    });
  })();

  function recentOrderStatusLabel(s) {
    if (s === 'delivered_direct_pay') return 'Delivered (Direct Pay)';
    if (s === 'partially_refunded') return 'Partially Refunded';
    return (s || 'pending').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function renderRecentOrders(orders) {
    var el = document.getElementById('admin-recent-orders-rows');
    if (!el) return;
    renderScrollablePanel(
      el,
      orders,
      function (o) {
        var dateLabel = o.created_at ? new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
        return '<div class="admin-rank-row admin-recent-order-row">' +
          '<span>#' + (o.order_number || o.id) + ' — ' + (o.customer_name || 'Customer') +
            '<br><span style="font-size:0.7rem; opacity:0.6;">' + dateLabel + '</span>' +
          '</span>' +
          '<span class="rank-value" style="text-align:right;">AED ' + formatAED(o.total || 0) +
            '<br><span style="font-size:0.7rem; opacity:0.65; font-weight:600;">' + recentOrderStatusLabel(o.status) + '</span>' +
          '</span>' +
        '</div>';
      },
      'No orders yet.',
      'Recent Orders'
    );
  }


  function loadStats() {
    metricGrid.innerHTML = '<p style="font-size:0.85rem; opacity:0.6;">Loading stats...</p>';
    var fromDate = statsPresetFromISO || document.getElementById('admin-stats-from').value || null;
    var toDate = statsPresetFromISO ? null : (document.getElementById('admin-stats-till').value || null);
    // 'ALL_TIME' is a client-side-only sentinel so computeOrderStats can
    // tell "explicitly chose All-time" apart from "nothing chosen yet"
    // (which falls back to a default week) — admin-get-stats has no
    // such distinction to make, so it gets a genuine null instead,
    // which it already correctly treats as no filter at all.
    var fromDateForStatsApi = fromDate === 'ALL_TIME' ? null : fromDate;

    Promise.all([
      fetch('/.netlify/functions/admin-get-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminToken: token, fromDate: fromDateForStatsApi, toDate: toDate })
      }).then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); }),
      fetch('/.netlify/functions/admin-get-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminToken: token })
      }).then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    ])
      .then(function (results) {
        var statsResult = results[0];
        var ordersResult = results[1];
        if (!statsResult.ok) { showStatus('error', statsResult.data.error || 'Could not load stats.'); return; }
        var orderStats = ordersResult.ok ? computeOrderStats(ordersResult.data.orders || [], fromDate, toDate, statsResult.data.dailyVisitors) : null;
        renderStats(statsResult.data, orderStats);
      })
      .catch(function () { showStatus('error', 'Network error loading stats.'); });
  }

  var dateRangeBtn = document.getElementById('admin-date-range-btn');
  var dateRangePopover = document.getElementById('admin-date-range-popover');
  var dateRangeLabel = document.getElementById('admin-date-range-label');

  dateRangeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    dateRangePopover.classList.toggle('is-open');
  });
  document.addEventListener('click', function (e) {
    if (!dateRangePopover.contains(e.target) && e.target !== dateRangeBtn) {
      dateRangePopover.classList.remove('is-open');
    }
  });

  function formatRangeLabel(from, till) {
    if (!from && !till) return 'All-time';
    var opts = { day: 'numeric', month: 'short', year: 'numeric' };
    var fromLabel = from ? new Date(from + 'T00:00:00').toLocaleDateString('en-GB', opts) : '…';
    var tillLabel = till ? new Date(till + 'T00:00:00').toLocaleDateString('en-GB', opts) : '…';
    return fromLabel + ' – ' + tillLabel;
  }

  document.getElementById('admin-stats-apply-btn').addEventListener('click', function () {
    var from = document.getElementById('admin-stats-from').value;
    var till = document.getElementById('admin-stats-till').value;
    if (!from && !till) {
      showStatus('error', 'Pick at least one date, or use "Reset to all-time" instead.');
      return;
    }
    statsPresetFromISO = null;
    document.querySelectorAll('[data-stats-preset]').forEach(function (b) { b.classList.remove('active'); });
    dateRangeLabel.textContent = formatRangeLabel(from, till);
    dateRangePopover.classList.remove('is-open');
    loadStats();
  });

  document.getElementById('admin-stats-reset-btn').addEventListener('click', function () {
    statsPresetFromISO = 'ALL_TIME';
    document.querySelectorAll('[data-stats-preset]').forEach(function (b) { b.classList.remove('active'); });
    document.querySelector('[data-stats-preset="all"]').classList.add('active');
    document.getElementById('admin-stats-from').value = '';
    document.getElementById('admin-stats-till').value = '';
    dateRangeLabel.textContent = 'All-time';
    dateRangePopover.classList.remove('is-open');
    loadStats();
  });

  var statsPresetFromISO = null; // set when a rolling-window preset (24h/7d/30d) is active, overriding the manual date inputs
  var statsPresetLabels = { all: 'All-time', '24h': 'Last 24 Hours', '7d': 'Last 7 Days', '30d': 'Last 30 Days' };
  document.querySelectorAll('[data-stats-preset]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var preset = btn.getAttribute('data-stats-preset');
      document.querySelectorAll('[data-stats-preset]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('admin-stats-from').value = '';
      document.getElementById('admin-stats-till').value = '';

      if (preset === 'all') {
        statsPresetFromISO = 'ALL_TIME';
      } else {
        var hoursBack = preset === '24h' ? 24 : (preset === '7d' ? 24 * 7 : 24 * 30);
        statsPresetFromISO = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
      }
      dateRangeLabel.textContent = statsPresetLabels[preset];
      dateRangePopover.classList.remove('is-open');
      loadStats();
    });
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
    var inStock = (window.PRODUCTS || []).filter(function (p) { return !isEffectivelySold(p); }).length;
    var soldOut = (window.PRODUCTS || []).filter(function (p) { return isEffectivelySold(p); }).length;

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

  // Sold-Out Item Visibility (live site) -- reads straight from the
  // committed JSON file (same mechanism as banners), no auth needed
  // for that; saving goes through admin-save-settings.js, which does
  // require the admin token, same as every other admin-save-*.js.
  var soldVisibilityInput = document.getElementById('admin-sold-visibility-days');
  var soldVisibilityMsg = document.getElementById('admin-sold-visibility-msg');
  var soldVisibilitySaveBtn = document.getElementById('admin-sold-visibility-save-btn');
  if (soldVisibilityInput) {
    fetch('/assets/settings/site-settings.json')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (s) { soldVisibilityInput.value = (s && s.soldOutVisibleDays) || 60; })
      .catch(function () { soldVisibilityInput.value = 60; });

    soldVisibilitySaveBtn.addEventListener('click', function () {
      var days = parseInt(soldVisibilityInput.value, 10);
      if (!days || days < 1 || days > 3650) {
        soldVisibilityMsg.className = 'admin-status-msg admin-status-error';
        soldVisibilityMsg.textContent = 'Please enter a number of days between 1 and 3650.';
        soldVisibilityMsg.style.display = 'block';
        return;
      }
      soldVisibilitySaveBtn.disabled = true;
      soldVisibilitySaveBtn.textContent = 'Saving…';
      fetch('/.netlify/functions/admin-save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminToken: token, soldOutVisibleDays: days })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          soldVisibilitySaveBtn.disabled = false;
          soldVisibilitySaveBtn.textContent = 'Save';
          if (!result.ok) {
            soldVisibilityMsg.className = 'admin-status-msg admin-status-error';
            soldVisibilityMsg.textContent = result.data.error || 'Could not save.';
            soldVisibilityMsg.style.display = 'block';
            return;
          }
          soldVisibilityMsg.className = 'admin-status-msg admin-status-success';
          soldVisibilityMsg.textContent = 'Saved — sold-out items now stay visible on the live site for ' + days + ' day(s) after they sell out.';
          soldVisibilityMsg.style.display = 'block';
        })
        .catch(function () {
          soldVisibilitySaveBtn.disabled = false;
          soldVisibilitySaveBtn.textContent = 'Save';
          soldVisibilityMsg.className = 'admin-status-msg admin-status-error';
          soldVisibilityMsg.textContent = 'Network error saving.';
          soldVisibilityMsg.style.display = 'block';
        });
    });
  }

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
  var promoStatsEl = document.getElementById('admin-promo-stats');
  var createMode = 'percent';

  var percentModeEl = document.getElementById('admin-promo-percent-mode');
  var valueModeEl = document.getElementById('admin-promo-value-mode');
  document.getElementById('admin-promo-type-percent').addEventListener('click', function () {
    createMode = 'percent';
    document.getElementById('admin-promo-type-percent').classList.add('active');
    document.getElementById('admin-promo-type-value').classList.remove('active');
    percentModeEl.style.display = 'block';
    valueModeEl.style.display = 'none';
  });
  document.getElementById('admin-promo-type-value').addEventListener('click', function () {
    createMode = 'value';
    document.getElementById('admin-promo-type-value').classList.add('active');
    document.getElementById('admin-promo-type-percent').classList.remove('active');
    percentModeEl.style.display = 'none';
    valueModeEl.style.display = 'block';
  });

  function updatePromoValuePreview() {
    var val = Number(document.getElementById('admin-promo-value-input').value);
    var ref = Number(document.getElementById('admin-promo-reference-input').value);
    var el = document.getElementById('admin-promo-computed-preview');
    if (val > 0 && ref > 0) {
      var pct = Math.round((val / ref) * 100);
      el.textContent = '≈ ' + pct + '% off — this is the percentage code that will actually be created.';
    } else {
      el.textContent = 'Enter both amounts to see the equivalent percentage.';
    }
  }
  document.getElementById('admin-promo-value-input').addEventListener('input', updatePromoValuePreview);
  document.getElementById('admin-promo-reference-input').addEventListener('input', updatePromoValuePreview);

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

    var usedCount = data.history.filter(function (p) { return p.used; }).length;
    promoStatsEl.innerHTML =
      buildStatCardHtml('Active Codes', data.active.length, 'tag', 'gold') +
      buildStatCardHtml('Used', usedCount, 'tagCheck', 'green');

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
    var discount;
    if (createMode === 'percent') {
      discount = parseInt(document.getElementById('admin-promo-discount').value, 10);
    } else {
      var val = Number(document.getElementById('admin-promo-value-input').value);
      var ref = Number(document.getElementById('admin-promo-reference-input').value);
      if (!val || !ref) {
        showStatus('error', 'Please enter both the discount amount and the reference order total.');
        return;
      }
      discount = Math.round((val / ref) * 100);
    }

    if (!discount || discount < 1 || discount > 95) {
      showStatus('error', 'Please enter a discount between 1 and 95.');
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

/* ---------- POS Users ---------- */
function initPosUsersEditor(token) {
  var statusMsg = document.getElementById('admin-pos-users-status-msg');
  function showStatus(type, msg) {
    statusMsg.textContent = msg;
    statusMsg.className = 'admin-status-msg ' + type;
    setTimeout(function () { statusMsg.textContent = ''; }, 4000);
  }

  function renderUsers(users) {
    var rowsEl = document.getElementById('admin-pos-users-rows');
    if (!users.length) {
      rowsEl.innerHTML = '<tr><td colspan="4" style="opacity:0.6;">No POS users yet.</td></tr>';
      return;
    }
    rowsEl.innerHTML = users.map(function (u) {
      var created = new Date(u.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      return '<tr><td>' + u.username + '</td><td>' + u.display_name + '</td><td>' + created + '</td>' +
        '<td><label class="admin-toggle-switch"><input type="checkbox" data-toggle-admin="' + u.id + '"' + (u.is_admin ? ' checked' : '') + '><span class="admin-toggle-slider"></span></label></td>' +
        '<td><button type="button" class="admin-btn-secondary" data-delete-user="' + u.id + '" style="font-size:0.72rem; padding:5px 12px;">Delete</button></td></tr>';
    }).join('');

    rowsEl.querySelectorAll('[data-toggle-admin]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        fetch('/.netlify/functions/admin-toggle-pos-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminToken: token, id: cb.getAttribute('data-toggle-admin'), isAdmin: cb.checked })
        })
          .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
          .then(function (result) {
            if (!result.ok) { showStatus('error', result.data.error || 'Could not update admin access.'); cb.checked = !cb.checked; return; }
            showStatus('success', cb.checked ? 'Admin access granted.' : 'Admin access removed.');
          })
          .catch(function () { showStatus('error', 'Network error updating admin access.'); cb.checked = !cb.checked; });
      });
    });

    rowsEl.querySelectorAll('[data-delete-user]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var username = btn.closest('tr').querySelector('td').textContent;
        if (!confirm('Delete POS user "' + username + '"? They will no longer be able to log in.')) return;
        fetch('/.netlify/functions/admin-delete-pos-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminToken: token, id: btn.getAttribute('data-delete-user') })
        })
          .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
          .then(function (result) {
            if (!result.ok) { showStatus('error', result.data.error || 'Could not delete user.'); return; }
            showStatus('success', 'User deleted.');
            loadUsers();
          })
          .catch(function () { showStatus('error', 'Network error deleting user.'); });
      });
    });
  }

  function loadUsers() {
    fetch('/.netlify/functions/admin-list-pos-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) { renderUsers(data.users || []); })
      .catch(function () { showStatus('error', 'Could not load POS users.'); });
  }

  document.getElementById('admin-pos-create-btn').addEventListener('click', function () {
    var username = document.getElementById('admin-pos-username').value.trim();
    var password = document.getElementById('admin-pos-password').value;
    var displayName = document.getElementById('admin-pos-display-name').value.trim();

    if (!username || !password) { showStatus('error', 'Username and password are required.'); return; }

    var btn = document.getElementById('admin-pos-create-btn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    fetch('/.netlify/functions/admin-create-pos-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, username: username, password: password, displayName: displayName, isAdmin: document.getElementById('admin-pos-is-admin').checked })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        btn.disabled = false;
        btn.textContent = 'Create User';
        if (!result.ok) { showStatus('error', result.data.error || 'Could not create user.'); return; }
        showStatus('success', 'POS user created.');
        document.getElementById('admin-pos-username').value = '';
        document.getElementById('admin-pos-password').value = '';
        document.getElementById('admin-pos-display-name').value = '';
        document.getElementById('admin-pos-is-admin').checked = false;
        loadUsers();
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = 'Create User';
        showStatus('error', 'Network error creating user.');
      });
  });

  loadUsers();
}

/* ---------- Admin Users (access to this panel itself) ---------- */
function initAdminUsersEditor(token) {
  var statusMsg = document.getElementById('admin-admin-users-status-msg');
  function showStatus(type, msg) {
    statusMsg.textContent = msg;
    statusMsg.className = 'admin-status-msg ' + type;
    setTimeout(function () { statusMsg.textContent = ''; }, 4000);
  }

  function renderUsers(users) {
    var rowsEl = document.getElementById('admin-admin-users-rows');
    if (!users.length) {
      rowsEl.innerHTML = '<tr><td colspan="4" style="opacity:0.6;">No admin users yet.</td></tr>';
      return;
    }
    rowsEl.innerHTML = users.map(function (u) {
      var created = new Date(u.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      return '<tr><td>' + u.username + '</td><td>' + u.display_name + '</td><td>' + created + '</td>' +
        '<td><button type="button" class="admin-btn-secondary" data-delete-admin-user="' + u.id + '" style="font-size:0.72rem; padding:5px 12px;">Delete</button></td></tr>';
    }).join('');

    rowsEl.querySelectorAll('[data-delete-admin-user]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var username = btn.closest('tr').querySelector('td').textContent;
        if (!confirm('Delete admin user "' + username + '"? They will no longer be able to sign in to this panel.')) return;
        fetch('/.netlify/functions/admin-delete-admin-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminToken: token, id: btn.getAttribute('data-delete-admin-user') })
        })
          .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
          .then(function (result) {
            if (!result.ok) { showStatus('error', result.data.error || 'Could not delete admin user.'); return; }
            showStatus('success', 'Admin user deleted.');
            loadUsers();
          })
          .catch(function () { showStatus('error', 'Network error deleting admin user.'); });
      });
    });
  }

  function loadUsers() {
    fetch('/.netlify/functions/admin-list-admin-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) { renderUsers(data.users || []); })
      .catch(function () { showStatus('error', 'Could not load admin users.'); });
  }

  document.getElementById('admin-au-create-btn').addEventListener('click', function () {
    var username = document.getElementById('admin-au-username').value.trim();
    var password = document.getElementById('admin-au-password').value;
    var displayName = document.getElementById('admin-au-display-name').value.trim();

    if (!username || !password) { showStatus('error', 'Username and password are required.'); return; }

    var btn = document.getElementById('admin-au-create-btn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    fetch('/.netlify/functions/admin-create-admin-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, username: username, password: password, displayName: displayName })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        btn.disabled = false;
        btn.textContent = 'Create Admin';
        if (!result.ok) { showStatus('error', result.data.error || 'Could not create admin user.'); return; }
        showStatus('success', 'Admin user created.');
        document.getElementById('admin-au-username').value = '';
        document.getElementById('admin-au-password').value = '';
        document.getElementById('admin-au-display-name').value = '';
        loadUsers();
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = 'Create Admin';
        showStatus('error', 'Network error creating admin user.');
      });
  });

  loadUsers();
}

/* ---------- Company Settings (TRN, trade license, address -- feeds invoice emails) ---------- */
function initBusinessSettings(token) {
  var statusMsg = document.getElementById('admin-business-settings-status-msg');
  var updatedNote = document.getElementById('admin-bs-updated-note');
  var saveBtn = document.getElementById('admin-bs-save-btn');

  function showStatus(type, msg) {
    statusMsg.textContent = msg;
    statusMsg.className = 'admin-status-msg ' + type;
    setTimeout(function () { statusMsg.textContent = ''; }, 4000);
  }

  function fillForm(s) {
    document.getElementById('admin-bs-legal-name').value = (s && s.legal_name) || '';
    document.getElementById('admin-bs-trade-license').value = (s && s.trade_license_number) || '';
    document.getElementById('admin-bs-licensing-authority').value = (s && s.licensing_authority) || '';
    document.getElementById('admin-bs-registered-address').value = (s && s.registered_address) || '';
    document.getElementById('admin-bs-vat-registered').checked = !!(s && s.vat_registered);
    document.getElementById('admin-bs-trn').value = (s && s.trn) || '';
    document.getElementById('admin-bs-corporate-tax-trn').value = (s && s.corporate_tax_trn) || '';
    if (s && s.updated_at) {
      var when = new Date(s.updated_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      updatedNote.textContent = 'Last updated ' + when + (s.updated_by ? (' by ' + s.updated_by) : '') + '.';
    } else {
      updatedNote.textContent = 'Not set yet -- the invoice email will use its built-in fallback details until you save here.';
    }
  }

  function loadSettings() {
    fetch('/.netlify/functions/admin-get-business-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) { fillForm(data.settings); })
      .catch(function () { showStatus('error', 'Could not load company settings.'); });
  }

  saveBtn.addEventListener('click', function () {
    var legalName = document.getElementById('admin-bs-legal-name').value.trim();
    var registeredAddress = document.getElementById('admin-bs-registered-address').value.trim();
    if (!legalName || !registeredAddress) { showStatus('error', 'Legal trading name and registered address are required.'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    fetch('/.netlify/functions/admin-save-business-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminToken: token,
        legalName: legalName,
        tradeLicenseNumber: document.getElementById('admin-bs-trade-license').value.trim(),
        licensingAuthority: document.getElementById('admin-bs-licensing-authority').value.trim(),
        registeredAddress: registeredAddress,
        vatRegistered: document.getElementById('admin-bs-vat-registered').checked,
        trn: document.getElementById('admin-bs-trn').value.trim(),
        corporateTaxTrn: document.getElementById('admin-bs-corporate-tax-trn').value.trim()
      })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Company Settings';
        if (!result.ok) { showStatus('error', result.data.error || 'Could not save company settings.'); return; }
        showStatus('success', 'Company settings saved. New invoice emails will use these details.');
        fillForm(result.data.settings);
      })
      .catch(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Company Settings';
        showStatus('error', 'Network error saving company settings.');
      });
  });

  loadSettings();
}

/* ---------- Delivery Rates (Partner/Own/Other flat AED amounts) ---------- */
function initDeliveryRatesSettings(token) {
  var statusMsg = document.getElementById('admin-dr-status-msg');
  var updatedNote = document.getElementById('admin-dr-updated-note');
  var saveBtn = document.getElementById('admin-dr-save-btn');

  function showStatus(type, msg) {
    statusMsg.textContent = msg;
    statusMsg.className = 'admin-status-msg ' + type;
    setTimeout(function () { statusMsg.textContent = ''; }, 4000);
  }

  function fillForm(r) {
    document.getElementById('admin-dr-partner-rate').value = (r && r.partner_rate != null) ? r.partner_rate : '';
    document.getElementById('admin-dr-own-rate').value = (r && r.own_rate != null) ? r.own_rate : '';
    document.getElementById('admin-dr-other-rate').value = ''; // no stored rate any more -- typed in per order instead
    if (r && r.updated_at) {
      var when = new Date(r.updated_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      updatedNote.textContent = 'Last updated ' + when + (r.updated_by ? (' by ' + r.updated_by) : '') + '.';
    } else {
      updatedNote.textContent = 'Not set yet -- every rate defaults to AED 0 until saved here.';
    }
  }

  function loadRates() {
    fetch('/.netlify/functions/admin-get-delivery-rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) { fillForm(data.rates); })
      .catch(function () { showStatus('error', 'Could not load delivery rates.'); });
  }

  saveBtn.addEventListener('click', function () {
    var partnerRate = parseFloat(document.getElementById('admin-dr-partner-rate').value);
    var ownRate = parseFloat(document.getElementById('admin-dr-own-rate').value);
    if (isNaN(partnerRate) || partnerRate < 0 || isNaN(ownRate) || ownRate < 0) {
      showStatus('error', 'Both rates must be numbers of 0 or more.');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    fetch('/.netlify/functions/admin-save-delivery-rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, partnerRate: partnerRate, ownRate: ownRate })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Delivery Rates';
        if (!result.ok) { showStatus('error', result.data.error || 'Could not save delivery rates.'); return; }
        showStatus('success', 'Delivery rates saved. Only orders/sales where a method is picked after this will use the new rates.');
        fillForm(result.data.rates);
      })
      .catch(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Delivery Rates';
        showStatus('error', 'Network error saving delivery rates.');
      });
  });

  loadRates();
}

/* ---------- Orders view ---------- */
function initOrdersView(token) {
  var statusMsg = document.getElementById('admin-orders-status-msg');
  var pendingListEl = document.getElementById('admin-pending-list');
  var rowsEl = document.getElementById('admin-orders-rows');
  var statusFilter = document.getElementById('admin-orders-status-filter');
  var searchInput = document.getElementById('admin-orders-search');

  // Barcode scanner: scans a printed/on-screen receipt barcode (see
  // rc-barcode in account.html) and drops the decoded reference straight
  // into this same search box, reusing whatever filtering it already
  // does — no separate lookup logic to keep in sync.
  (function initOrdersBarcodeScanner() {
    var scanBtn = document.getElementById('admin-orders-scan-btn');
    var overlay = document.getElementById('admin-scan-overlay');
    var videoEl = document.getElementById('admin-scan-video');
    var errorEl = document.getElementById('admin-scan-error');
    var closeBtn = document.getElementById('admin-scan-close');
    if (!scanBtn || !overlay || !videoEl) return;

    var codeReader = null;

    function stopScanning() {
      if (codeReader) {
        try { codeReader.reset(); } catch (e) { /* already stopped */ }
        codeReader = null;
      }
      overlay.style.display = 'none';
    }

    function startScanning() {
      if (typeof ZXing === 'undefined') {
        errorEl.textContent = 'Barcode scanning isn\u2019t available in this browser.';
        errorEl.style.display = 'block';
        overlay.style.display = 'flex';
        return;
      }
      errorEl.style.display = 'none';
      overlay.style.display = 'flex';

      codeReader = new ZXing.BrowserMultiFormatReader();
      codeReader.decodeFromConstraints(
        {
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            advanced: [{ focusMode: 'continuous' }]
          }
        },
        videoEl,
        function (result) {
          if (!result) return; // NotFoundException fires constantly between frames — normal, not an error
          var text = result.getText ? result.getText() : result.text;
          if (!text) return;
          stopScanning();
          searchInput.value = text;
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          if (navigator.vibrate) navigator.vibrate(60);
        }
      ).catch(function () {
        errorEl.textContent = 'Could not access the camera. Check camera permissions and try again.';
        errorEl.style.display = 'block';
      });
    }

    scanBtn.addEventListener('click', startScanning);
    closeBtn.addEventListener('click', stopScanning);
  })();

  var allOrders = [];
  var allShopOrders = [];
  var currentDeliveryRates = { partner_rate: 0, own_rate: 0 };
  fetch('/.netlify/functions/admin-get-delivery-rates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminToken: token })
  })
    .then(function (res) { return res.json(); })
    .then(function (data) { if (data && data.rates) currentDeliveryRates = data.rates; })
    .catch(function () {}); // non-fatal -- the popup's Partner field just falls back to 0, still editable
  var activeChannel = 'online';
  var sortKey = 'created_at';
  var sortDir = 'desc';
  var ordersPage = 1;
  var shopOrdersPage = 1;
  var ORDERS_PAGE_SIZE = 15;

  // Shared page-button renderer for the Orders tables -- same button
  // markup/CSS (.admin-pagination/.admin-page-btn) as the Sarees &
  // Jewellery catalog's pager, just parameterised so both the online
  // and shop tables (two independent page counters) can use it.
  function renderPager(containerEl, totalItems, page, pageSize, onPageChange) {
    var totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (page > totalPages) page = totalPages;
    if (!containerEl) return page;
    if (totalPages <= 1) { containerEl.innerHTML = ''; return page; }
    var buttons = [];
    buttons.push('<button type="button" class="admin-page-btn" data-page="' + (page - 1) + '"' + (page === 1 ? ' disabled' : '') + '>&lsaquo;</button>');
    for (var i = 1; i <= totalPages; i++) {
      buttons.push('<button type="button" class="admin-page-btn' + (i === page ? ' active' : '') + '" data-page="' + i + '">' + i + '</button>');
    }
    buttons.push('<button type="button" class="admin-page-btn" data-page="' + (page + 1) + '"' + (page === totalPages ? ' disabled' : '') + '>&rsaquo;</button>');
    containerEl.innerHTML = buttons.join('');
    containerEl.querySelectorAll('.admin-page-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = parseInt(btn.getAttribute('data-page'), 10);
        if (!p || p < 1 || p > totalPages) return;
        onPageChange(p);
      });
    });
    return page;
  }

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
    if (s === 'delivered_direct_pay') return 'Delivered (Direct Pay)';
    if (s === 'refunded_giftcard') return 'Refunded (To Gift Card)';
    if (s === 'cod_pending') return 'Cash on Delivery (Pending)';
    if (s === 'partially_refunded') return 'Partially Refunded';
    return (s || 'pending').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function recentOrderRowHtml(o, channel) {
    var label = channel === 'shop' ? (o.status || '—') : statusLabel(o.status);
    return '<div class="admin-rank-row"><span>' + (o.order_number || o.id) + ' — ' + (o.customer_name || 'Unknown') +
      '<br><span style="font-size:0.7rem; opacity:0.6;">' + new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '</span></span>' +
      '<span class="rank-value" style="text-align:right;">AED ' + formatAED(o.total || 0) + '<br><span style="font-size:0.66rem; opacity:0.7; font-weight:400;">' + label + '</span></span></div>';
  }

  function renderSummary() {
    var pendingDispatch = allOrders.filter(function (o) { return o.status === 'paid'; });

    // Overall
    var allOrdersCount = allOrders.length + allShopOrders.length;
    var onlineRevenue = allOrders.filter(function (o) { return ['pending', 'cod_pending', 'cancelled', 'payment_error', 'refunded'].indexOf(o.status) === -1; })
      .reduce(function (sum, o) { return sum + netOrderRevenue(o); }, 0);
    var shopRevenue = allShopOrders.filter(function (o) { return o.status !== 'Returned'; })
      .reduce(function (sum, o) { return sum + (Number(o.total) || 0); }, 0);
    var totalRevenue = onlineRevenue + shopRevenue;

    // Online
    var pending = allOrders.filter(function (o) { return (o.status || 'pending') === 'pending' || o.status === 'cod_pending'; }).length;
    var processing = allOrders.filter(function (o) { return o.status === 'paid' || o.status === 'shipped'; }).length;
    var onlineCompleted = allOrders.filter(function (o) { return o.status === 'delivered' || o.status === 'delivered_direct_pay'; }).length;
    var onlineCancelled = allOrders.filter(function (o) { return ['cancelled', 'refunded', 'refunded_giftcard', 'payment_error'].indexOf(o.status) !== -1; }).length;

    // Shop
    var shopCompleted = allShopOrders.filter(function (o) { return o.status === 'Completed'; }).length;
    var shopReturned = allShopOrders.filter(function (o) { return o.status !== 'Completed'; }).length;

    // Combined (channel-agnostic) counts -- used for the single unified
    // top row that mirrors the reference layout, rather than three
    // separate Overall/Online/Shop rows.
    var completed = onlineCompleted + shopCompleted;
    var cancelled = onlineCancelled + shopReturned;

    document.getElementById('admin-orders-summary-unified').innerHTML =
      buildStatCardHtml('Total Orders', allOrdersCount, 'box', 'gold') +
      buildStatCardHtml('Total Revenue (AED)', Math.round(totalRevenue).toLocaleString(), 'wallet', 'gold') +
      buildStatCardHtml('Processing', processing, 'clock', 'orange') +
      buildStatCardHtml('Completed', completed, 'check', 'green') +
      buildStatCardHtml('Cancelled', cancelled, 'cross', 'red');

    document.getElementById('admin-orders-summary-mobile').innerHTML =
      '<div class="admin-summary-card">' +
        '<h4><span class="admin-summary-card-icon">' + ADMIN_STAT_ICONS.box + '</span>Overall Summary</h4>' +
        '<div class="admin-summary-row">' +
          '<div class="admin-summary-stat"><p class="lbl">All Orders</p><p class="val">' + allOrdersCount + '</p></div>' +
          '<div class="admin-summary-stat"><p class="lbl">Total Revenue</p><p class="val">AED ' + Math.round(totalRevenue).toLocaleString() + '</p></div>' +
        '</div>' +
      '</div>' +
      '<div class="admin-summary-card">' +
        '<h4><span class="admin-summary-card-icon" style="background:#FAECE7; color:#B8142A;">' + ADMIN_STAT_ICONS.box + '</span>Online Orders</h4>' +
        '<div class="admin-summary-row">' +
          '<div class="admin-summary-stat"><p class="lbl">Orders</p><p class="val">' + allOrders.length + '</p></div>' +
          '<div class="admin-summary-stat"><p class="lbl">Processing</p><p class="val">' + processing + '</p></div>' +
          '<div class="admin-summary-stat"><p class="lbl">Completed</p><p class="val">' + onlineCompleted + '</p></div>' +
          '<div class="admin-summary-stat"><p class="lbl">Cancelled</p><p class="val">' + onlineCancelled + '</p></div>' +
        '</div>' +
        '<div class="admin-summary-revenue-row">Revenue <span class="val">AED ' + Math.round(onlineRevenue).toLocaleString() + '</span></div>' +
      '</div>' +
      '<div class="admin-summary-card">' +
        '<h4><span class="admin-summary-card-icon" style="background:#F8ECE2; color:#B68A69;">' + ADMIN_STAT_ICONS.box + '</span>In Shop Orders</h4>' +
        '<div class="admin-summary-row">' +
          '<div class="admin-summary-stat"><p class="lbl">Orders</p><p class="val">' + allShopOrders.length + '</p></div>' +
          '<div class="admin-summary-stat"><p class="lbl">Returned / Exchanged</p><p class="val">' + shopReturned + '</p></div>' +
        '</div>' +
        '<div class="admin-summary-revenue-row">Revenue <span class="val">AED ' + Math.round(shopRevenue).toLocaleString() + '</span></div>' +
      '</div>';

    var statusDonutEl = document.getElementById('admin-orders-status-donut');
    if (statusDonutEl) {
      statusDonutEl.innerHTML = buildDonutHtml([
        { label: 'Pending', count: pending, color: '#DED0C7' },
        { label: 'Processing', count: processing, color: '#E69E42' },
        { label: 'Completed', count: completed, color: '#3B6D11' },
        { label: 'Cancelled', count: cancelled, color: '#B8142A' }
      ], 'Orders');
    }

    var recentPanelEl = document.getElementById('admin-orders-page-recent-rows');
    if (recentPanelEl) {
      var combinedRecent = allOrders.map(function (o) { return { o: o, channel: 'online' }; })
        .concat(allShopOrders.map(function (o) { return { o: o, channel: 'shop' }; }))
        .sort(function (a, b) { return new Date(b.o.created_at) - new Date(a.o.created_at); })
        .slice(0, 5);
      recentPanelEl.innerHTML = combinedRecent.length
        ? combinedRecent.map(function (x) { return recentOrderRowHtml(x.o, x.channel); }).join('')
        : '<p style="font-size:0.82rem; opacity:0.6;">No orders yet.</p>';
    }

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

  // The "Awaiting dispatch" elapsed times ("2h 14m ago") were only ever
  // computed once, at whatever moment renderSummary() last ran — leaving
  // this tab open just let them sit there frozen instead of ticking
  // forward, since nothing was re-rendering them on their own. This just
  // re-runs the cheap, already-in-memory summary render every minute so
  // they stay live without needing a manual refresh or refetch.
  setInterval(renderSummary, 60000);

  var ordersPresetFromTime = null; // set when a rolling-window preset (24h/7d/30d) is active, overriding the manual date inputs
  var currentDrawerShopOrder = null; // the shop order currently open in the detail drawer, for the Delete button
  var currentDrawerOnlineOrder = null; // the website order currently open in the detail drawer, for the Process Return controls

  function getOrdersDateBounds() {
    if (ordersPresetFromTime !== null) {
      return { fromTime: ordersPresetFromTime, toTime: null };
    }
    var dateFrom = document.getElementById('admin-orders-date-from').value;
    var dateTo = document.getElementById('admin-orders-date-to').value;
    return {
      fromTime: dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : null,
      toTime: dateTo ? new Date(dateTo + 'T23:59:59').getTime() : null
    };
  }

  function getFilteredSorted() {
    var statusVal = statusFilter.value;
    var query = searchInput.value.trim().toLowerCase();
    var dateBounds = getOrdersDateBounds();

    var filtered = allOrders.filter(function (o) {
      var okStatus = !statusVal || (o.status || 'pending') === statusVal;
      var itemsText = '';
      try { itemsText = (JSON.parse(o.items || '[]')).map(function (it) { return (it.name || '') + ' ' + (it.id || ''); }).join(' ').toLowerCase(); } catch (e) {}
      var okSearch = !query ||
        (o.order_number || '').toLowerCase().indexOf(query) !== -1 ||
        (o.customer_name || '').toLowerCase().indexOf(query) !== -1 ||
        (o.customer_email || '').toLowerCase().indexOf(query) !== -1 ||
        itemsText.indexOf(query) !== -1;
      var orderTime = new Date(o.created_at).getTime();
      var okFrom = dateBounds.fromTime === null || orderTime >= dateBounds.fromTime;
      var okTo = dateBounds.toTime === null || orderTime <= dateBounds.toTime;
      return okStatus && okSearch && okFrom && okTo;
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
    ordersPage = renderPager(document.getElementById('admin-orders-pagination'), filtered.length, ordersPage, ORDERS_PAGE_SIZE, function (p) { ordersPage = p; renderTable(); });
    var pageStart = (ordersPage - 1) * ORDERS_PAGE_SIZE;
    var pageItems = filtered.slice(pageStart, pageStart + ORDERS_PAGE_SIZE);
    rowsEl.innerHTML = pageItems.length ? pageItems.map(function (o) {
      var items = [];
      try { items = JSON.parse(o.items || '[]'); } catch (e) {}
      var itemsSummary = items.map(function (it) { return it.id; }).join(', ');

      return (
        '<tr class="admin-orders-clickable-row" data-id="' + o.id + '">' +
          '<td>' + (o.order_number || '—') + '</td>' +
          '<td>' + new Date(o.created_at).toLocaleString() + '</td>' +
          '<td>' + (o.customer_name || '—') + '<br><span style="opacity:0.6; font-size:0.72rem;">' + (o.customer_email || '') + '</span></td>' +
          '<td style="font-size:0.76rem;">' + itemsSummary + '</td>' +
          '<td>AED ' + Number(o.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }) + '</td>' +
          '<td style="font-size:0.76rem;">' + buildPaymentMethodSelect(o) + '</td>' +
          '<td>' + buildStatusSelect(o) + '</td>' +
        '</tr>'
      );
    }).join('') : '<tr><td colspan="7">No orders match.</td></tr>';

    var mobileListEl = document.getElementById('admin-orders-mobile-list');
    mobileListEl.innerHTML = pageItems.length ? pageItems.map(function (o) {
      var dateLabel = new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      return (
        '<div class="admin-order-mobile-card admin-orders-clickable-row" data-id="' + o.id + '">' +
          '<div class="admin-order-mobile-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/></svg></div>' +
          '<div class="admin-order-mobile-info">' +
            '<p class="omn">' + (o.order_number || '—') + '</p>' +
            '<p class="omd">&#128197; ' + dateLabel + '</p>' +
            '<p class="omc">' + (o.customer_name || '—') + '</p>' +
            '<p class="ome">' + (o.customer_email || '') + '</p>' +
          '</div>' +
          '<div class="admin-order-mobile-right">' +
            '<p class="omt">AED ' + formatAED(o.total || 0) + '</p>' +
            '<p class="omp">' + (o.payment_method || '—') + '</p>' +
            '<span class="admin-order-mobile-badge status-' + (o.status || 'pending') + '">' + statusLabel(o.status) + '</span>' +
          '</div>' +
          '<span class="admin-order-mobile-chevron">&rsaquo;</span>' +
        '</div>'
      );
    }).join('') : '<p style="font-size:0.85rem; opacity:0.6; padding:16px;">No orders match.</p>';
    // Delegated click handling (below, in this view's setup) uses
    // .closest('.admin-orders-clickable-row'), so it keeps working
    // through the extra wrapper div this adds -- no per-row rebinding
    // needed here.
    if (pageItems.length) wireMobileScrollList(mobileListEl);
  }

  function getFilteredSortedShop() {
    var query = searchInput.value.trim().toLowerCase();
    var statusVal = document.getElementById('admin-shop-status-filter').value;
    var dateBounds = getOrdersDateBounds();

    var filtered = allShopOrders.filter(function (o) {
      var okStatus = !statusVal || o.status === statusVal;
      var itemsText = '';
      try { itemsText = (JSON.parse(o.items || '[]')).map(function (it) { return (it.name || '') + ' ' + (it.id || ''); }).join(' ').toLowerCase(); } catch (e) {}
      var okSearch = !query ||
        (o.order_number || '').toLowerCase().indexOf(query) !== -1 ||
        (o.customer_name || '').toLowerCase().indexOf(query) !== -1 ||
        (o.customer_email || '').toLowerCase().indexOf(query) !== -1 ||
        itemsText.indexOf(query) !== -1;
      var orderTime = new Date(o.created_at).getTime();
      var okFrom = dateBounds.fromTime === null || orderTime >= dateBounds.fromTime;
      var okTo = dateBounds.toTime === null || orderTime <= dateBounds.toTime;
      return okStatus && okSearch && okFrom && okTo;
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

  function shopStatusBadgeColor(status) {
    if (status === 'Completed') return 'background:#EAF3DE; color:#3B6D11;';
    if (status === 'Exchanged') return 'background:#FAEEDA; color:#854F0B;';
    return 'background:#FBEAEA; color:#B8142A;'; // Returned, Partially Returned
  }

  var pendingDeleteSale = null;

  function openDeleteSaleWarning(order) {
    var items = [];
    try { items = JSON.parse(order.items || '[]'); } catch (e) {}
    var itemsSummary = items.map(function (it) { return it.id; }).join(', ') || 'No items on record';

    var html =
      '<p style="margin:0 0 4px;"><strong>' + (order.order_number || order.id) + '</strong> \u2014 ' + (order.customer_name || 'Walk-in Customer') + '</p>' +
      '<p style="margin:0 0 4px; opacity:0.75;">Items: ' + itemsSummary + '</p>' +
      '<p style="margin:0 0 12px; opacity:0.75;">Total: AED ' + formatAED(order.total || 0) + '</p>';

    if (order.gift_card_credit > 0) {
      html +=
        '<div style="background:#FBEAEA; border-radius:8px; padding:12px; margin-bottom:8px;">' +
          '<p style="margin:0 0 6px; font-weight:700; color:#B8142A;">This sale has an exchange/return on record</p>' +
          '<p style="margin:0 0 6px;">It credited AED ' + formatAED(order.gift_card_credit) + ' to this customer\u2019s gift card. Deleting this sale will also delete that return record (cascading automatically).</p>' +
          '<p style="margin:0; font-weight:700;">Important: the customer\u2019s actual gift card balance will NOT be reversed. They keep the credit \u2014 only the record explaining where it came from will be gone.</p>' +
        '</div>';
    } else {
      html += '<p style="margin:0; opacity:0.75; font-size:0.8rem;">No associated return/exchange record on this sale.</p>';
    }

    html += '<p style="margin:12px 0 0; font-weight:700;">This cannot be undone.</p>';

    document.getElementById('admin-delete-sale-details').innerHTML = html;
    var reasonInput = document.getElementById('admin-delete-sale-reason');
    reasonInput.value = '';
    document.getElementById('admin-delete-sale-confirm-btn').disabled = true;
    document.getElementById('admin-delete-sale-overlay').classList.add('is-open');
    pendingDeleteSale = order;
  }

  // The delete button stays disabled until a reason is actually typed
  // in — a required field enforced in the UI as well as server-side,
  // so staff get immediate feedback rather than a rejected request.
  document.getElementById('admin-delete-sale-reason').addEventListener('input', function (e) {
    document.getElementById('admin-delete-sale-confirm-btn').disabled = !e.target.value.trim();
  });

  document.getElementById('admin-delete-sale-cancel-btn').addEventListener('click', function () {
    document.getElementById('admin-delete-sale-overlay').classList.remove('is-open');
    document.getElementById('admin-delete-sale-reason').value = '';
    pendingDeleteSale = null;
  });
  document.getElementById('admin-delete-sale-confirm-btn').addEventListener('click', function () {
    if (!pendingDeleteSale) return;
    var reason = document.getElementById('admin-delete-sale-reason').value.trim();
    if (!reason) return; // belt-and-suspenders — button should already be disabled without one

    var btn = document.getElementById('admin-delete-sale-confirm-btn');
    btn.disabled = true;
    btn.textContent = 'Deleting...';

    fetch('/.netlify/functions/admin-delete-pos-sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, saleId: pendingDeleteSale.id, reason: reason })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        btn.textContent = 'Delete Permanently';
        if (!result.ok) {
          btn.disabled = !document.getElementById('admin-delete-sale-reason').value.trim();
          showStatus('error', result.data.error || 'Could not delete this sale.');
          return;
        }

        allShopOrders = allShopOrders.filter(function (o) { return o.id !== pendingDeleteSale.id; });
        renderSummary();
        renderShopTable();
        document.getElementById('admin-delete-sale-overlay').classList.remove('is-open');
        document.getElementById('admin-delete-sale-reason').value = '';
        drawerOverlay.classList.remove('is-open');
        pendingDeleteSale = null;
      })
      .catch(function () {
        btn.disabled = !document.getElementById('admin-delete-sale-reason').value.trim();
        btn.textContent = 'Delete Permanently';
        showStatus('error', 'Network error deleting this sale.');
      });
  });

  function renderShopTable() {
    var filtered = getFilteredSortedShop();
    shopOrdersPage = renderPager(document.getElementById('admin-shop-orders-pagination'), filtered.length, shopOrdersPage, ORDERS_PAGE_SIZE, function (p) { shopOrdersPage = p; renderShopTable(); });
    var shopPageStart = (shopOrdersPage - 1) * ORDERS_PAGE_SIZE;
    var pageItems = filtered.slice(shopPageStart, shopPageStart + ORDERS_PAGE_SIZE);
    var shopRowsEl = document.getElementById('admin-shop-orders-rows');
    shopRowsEl.innerHTML = pageItems.length ? pageItems.map(function (o) {
      var items = [];
      try { items = JSON.parse(o.items || '[]'); } catch (e) {}
      var itemsSummary = items.map(function (it) { return it.id; }).join(', ');

      return (
        '<tr class="admin-orders-clickable-row" data-channel="shop" data-id="' + o.id + '">' +
          '<td>' + (o.order_number || '\u2014') + '</td>' +
          '<td>' + new Date(o.created_at).toLocaleString() + '</td>' +
          '<td>' + (o.customer_name || '\u2014') + '<br><span style="opacity:0.6; font-size:0.72rem;">' + (o.customer_email || '') + '</span></td>' +
          '<td style="font-size:0.76rem;">' + itemsSummary + '</td>' +
          '<td>AED ' + Number(o.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }) + '</td>' +
          '<td style="font-size:0.76rem;">' + (o.sales_person || '\u2014') + '</td>' +
          '<td><span style="font-size:0.72rem; font-weight:700; padding:3px 10px; border-radius:6px; ' + shopStatusBadgeColor(o.status) + '">' + o.status + '</span></td>' +
        '</tr>'
      );
    }).join('') : '<tr><td colspan="7">No shop orders match.</td></tr>';

    var mobileListEl = document.getElementById('admin-shop-orders-mobile-list');
    mobileListEl.innerHTML = pageItems.length ? pageItems.map(function (o) {
      var dateLabel = new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      return (
        '<div class="admin-order-mobile-card admin-orders-clickable-row" data-channel="shop" data-id="' + o.id + '">' +
          '<div class="admin-order-mobile-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l1-5h16l1 5"/><path d="M4 9h16v11H4z"/></svg></div>' +
          '<div class="admin-order-mobile-info">' +
            '<p class="omn">' + (o.order_number || '\u2014') + '</p>' +
            '<p class="omd">&#128197; ' + dateLabel + '</p>' +
            '<p class="omc">' + (o.customer_name || '\u2014') + '</p>' +
          '</div>' +
          '<div class="admin-order-mobile-right">' +
            '<p class="omt">AED ' + formatAED(o.total || 0) + '</p>' +
            '<span class="admin-order-mobile-badge" style="' + shopStatusBadgeColor(o.status) + '">' + o.status + '</span>' +
          '</div>' +
          '<span class="admin-order-mobile-chevron">&rsaquo;</span>' +
        '</div>'
      );
    }).join('') : '<p style="font-size:0.85rem; opacity:0.6; padding:16px;">No shop orders match.</p>';
    if (pageItems.length) wireMobileScrollList(mobileListEl);
  }

  // Reduces whatever's actually sitting in payment_method — a raw
  // Nomod response ("visa", "card"), "Nomod (confirmed manually)" from
  // a logged manual sale, "Bank Transfer", "Cash", "COD", or already
  // one of the three clean categories — down to exactly one of Cash /
  // Bank Transfer / Electronic. This is what the payment-method
  // dropdown below pre-selects to, and what the customer receipt
  // (script.js) now also uses, so both always agree with each other
  // without needing every existing order re-tagged by hand.
  function normalizePaymentMethod(raw) {
    var v = String(raw || '').toLowerCase();
    if (!v) return null;
    if (v.indexOf('cash') !== -1 || v === 'cod') return 'Cash';
    if (v.indexOf('bank') !== -1 || v.indexOf('transfer') !== -1) return 'Bank Transfer';
    return 'Electronic'; // Nomod (confirmed manually), visa, mastercard, card, any other gateway string
  }

  function buildPaymentMethodSelect(o) {
    var methods = ['Cash', 'Bank Transfer', 'Electronic'];
    var current = normalizePaymentMethod(o.payment_method);
    var options = (current ? '' : '<option value="" selected disabled>Not recorded</option>') + methods.map(function (m) {
      return '<option value="' + m + '"' + (current === m ? ' selected' : '') + '>' + m + '</option>';
    }).join('');
    return '<select class="admin-order-payment-select" data-id="' + o.id + '" title="Raw value on file: ' + (o.payment_method ? o.payment_method.replace(/"/g, '&quot;') : 'none') + '">' + options + '</select>';
  }

  // Refunded / Refunded (To Gift Card) / Partially Refunded are
  // deliberately NOT settable from this dropdown -- all three used to
  // be here, but none of them went through the item-level, qty-aware,
  // discount-prorated math "Process Return" now handles, and could be
  // picked independently of it. That's how an order could end up
  // refunded twice (once via this dropdown, once via Process Return)
  // with two different amounts -- exactly what happened to prompt this
  // change. "Partially Refunded" additionally never worked at all when
  // picked here (the backend doesn't accept it as a settable status).
  // Any refund now goes through Process Return only.
  //
  // An order that already carries one of these three statuses (set
  // before this change, or by Process Return itself) still needs to
  // show that truthfully -- it's added back in as a disabled option so
  // it displays and stays selected, without being re-selectable. The
  // admin can still move an order OFF one of these statuses (e.g. to
  // correct a mistaken entry) by picking any of the normal statuses.
  var SETTABLE_ORDER_STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'delivered_direct_pay', 'cod_pending', 'payment_error', 'cancelled'];
  var LEGACY_REFUND_STATUSES = ['refunded', 'refunded_giftcard', 'partially_refunded'];

  // Same per-status colors as the .admin-status-pill-select CSS classes
  // (admin.html) -- applied inline to each <option> below because the
  // <select>'s own background/color (its colored "pill" look when
  // closed) otherwise gets inherited by every option in the native
  // open dropdown list, since un-styled <option>s pick up the select's
  // computed colors. Giving each option its own explicit colors keeps
  // the open list readable, status by status, instead of the whole
  // list flooding to whichever color happens to be currently selected.
  function statusOptionColors(s) {
    if (s === 'paid' || s === 'shipped') return { bg: '#FDF0E0', color: '#946B4A' };
    if (s === 'delivered' || s === 'delivered_direct_pay' || s === 'refunded' || s === 'refunded_giftcard') return { bg: '#eaf3de', color: '#3B6D11' };
    if (s === 'partially_refunded') return { bg: '#FAEEDA', color: '#854F0B' };
    return { bg: '#FBE9E9', color: '#B8142A' }; // pending, cancelled, payment_error, cod_pending
  }

  function buildStatusSelect(o) {
    var statuses = SETTABLE_ORDER_STATUSES.slice();
    var currentIsLegacyRefundStatus = LEGACY_REFUND_STATUSES.indexOf(o.status) !== -1;
    var options = statuses.map(function (s) {
      var c = statusOptionColors(s);
      return '<option value="' + s + '" style="background-color:' + c.bg + '; color:' + c.color + ';"' + (o.status === s ? ' selected' : '') + '>' + statusLabel(s) + '</option>';
    }).join('');
    if (currentIsLegacyRefundStatus) {
      var lc = statusOptionColors(o.status);
      options = '<option value="' + o.status + '" style="background-color:' + lc.bg + '; color:' + lc.color + ';" selected disabled>' + statusLabel(o.status) + ' (use Process Return to change this)</option>' + options;
    }
    return '<select class="admin-order-status-select admin-status-pill-select status-' + (o.status || 'pending') + '" data-id="' + o.id + '">' + options + '</select>';
  }

  var DELIVERY_METHOD_LABEL = { partner: 'Delivery Partner', own: 'Own / Self Delivery', other: 'Other' };

  // A button, not a <select> -- picking (or changing) a method opens
  // the same "Delivery Method" popup used when an order is marked
  // Delivered, rather than offering an inline dropdown.
  function buildDeliveryButton(o, isShop) {
    var label = o.delivery_method ? DELIVERY_METHOD_LABEL[o.delivery_method] : 'Not set — tap to choose';
    return '<button type="button" class="admin-order-delivery-btn" data-id="' + o.id + '" data-channel="' + (isShop ? 'shop' : 'online') + '">' + label + '</button>';
  }

  // Shows the AED amount actually locked onto this order/sale — a
  // snapshot from whenever the method was last (re-)picked, which can
  // differ from today's Delivery Rates if they've changed since.
  function deliveryCostNote(o) {
    if (!o.delivery_method) return '<p style="margin:6px 0 0; font-size:0.72rem; opacity:0.6;">Pick a method to lock in today’s rate for this ' + (o.bill_number ? 'sale' : 'order') + '.</p>';
    return '<p style="margin:6px 0 0; font-size:0.72rem; opacity:0.6;">Locked at AED ' + formatAED(o.delivery_cost || 0) + ' when last set — won’t change if Delivery Rates are edited later.</p>';
  }

  // Shared by the table's inline status select, the drawer's status
  // select, and the Delivery Method button: sets delivery_method/
  // delivery_cost for an order or sale, then returns a promise
  // resolving with {ok, data}, same shape as the status-update fetches
  // below so callers can chain them identically.
  function applyDeliveryMethod(channel, id, method, customCost) {
    var payload = { adminToken: token, channel: channel, id: id, method: method };
    if (method === 'partner' || method === 'other') payload.customCost = customCost;
    return fetch('/.netlify/functions/admin-set-delivery-method', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); });
  }

  function updateOrderStatus(orderId, newStatus) {
    return fetch('/.netlify/functions/admin-update-order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, orderId: orderId, status: newStatus })
    }).then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); });
  }

  rowsEl.addEventListener('change', function (e) {
    var statusSelectEl = e.target.closest('.admin-order-status-select');
    if (statusSelectEl) {
      var orderId = statusSelectEl.getAttribute('data-id');
      var newStatus = statusSelectEl.value;
      var order = allOrders.find(function (o) { return String(o.id) === String(orderId); });

      if (newStatus === 'delivered') {
        var prevStatusTable = order ? order.status : newStatus;
        statusSelectEl.value = prevStatusTable; // hold the visible value until the popup is confirmed
        showDeliveryMethodPopup('Marking Order #' + (order ? order.order_number : orderId) + ' as Delivered.', function (method, customCost) {
          applyDeliveryMethod('online', orderId, method, customCost).then(function (dmResult) {
            if (!dmResult.ok) { showStatus('error', dmResult.data.error || 'Could not set delivery method.'); return; }
            if (order) { order.delivery_method = dmResult.data.deliveryMethod; order.delivery_cost = dmResult.data.deliveryCost; }
            return updateOrderStatus(orderId, newStatus).then(function (result) {
              if (!result.ok) { showStatus('error', result.data.error || 'Could not update status.'); return; }
              if (order) order.status = newStatus;
              statusSelectEl.value = newStatus;
              showStatus('success', 'Order #' + (order ? order.order_number : orderId) + ' marked Delivered (' + DELIVERY_METHOD_LABEL[dmResult.data.deliveryMethod] + ', AED ' + formatAED(dmResult.data.deliveryCost || 0) + ').');
              renderSummary();
              renderTable();
            });
          }).catch(function () { showStatus('error', 'Network error — status was not updated.'); });
        }, function () { statusSelectEl.value = prevStatusTable; }, { partnerRate: currentDeliveryRates.partner_rate });
        return;
      }

      updateOrderStatus(orderId, newStatus)
        .then(function (result) {
          if (!result.ok) { showStatus('error', result.data.error || 'Could not update status.'); return; }
          if (order) order.status = newStatus;
          showStatus('success', 'Order #' + (order ? order.order_number : orderId) + ' updated to ' + statusLabel(newStatus) + '.');
          renderSummary();
          renderTable(); // re-render so the status pill's colour matches the new status
        })
        .catch(function () { showStatus('error', 'Network error — status was not updated.'); });
      return;
    }

    var paymentSelectEl = e.target.closest('.admin-order-payment-select');
    if (paymentSelectEl) {
      var payOrderId = paymentSelectEl.getAttribute('data-id');
      var newPaymentMethod = paymentSelectEl.value;
      if (!newPaymentMethod) return; // the disabled "Not recorded" placeholder — nothing to save

      fetch('/.netlify/functions/admin-update-order-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminToken: token, orderId: payOrderId, paymentMethod: newPaymentMethod })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok) { showStatus('error', result.data.error || 'Could not update payment method.'); return; }
          var order = allOrders.find(function (o) { return String(o.id) === String(payOrderId); });
          // Store the clean category, not the old raw value — this is a
          // deliberate correction (that's the point of setting it here),
          // and keeps this admin session's own view consistent with what
          // was just saved without needing a full reload.
          if (order) order.payment_method = newPaymentMethod;
          showStatus('success', 'Order #' + (order ? order.order_number : payOrderId) + ' payment method set to ' + newPaymentMethod + '.');
        })
        .catch(function () { showStatus('error', 'Network error — payment method was not updated.'); });
    }
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
      renderShopTable();
    });
  });

  statusFilter.addEventListener('change', renderTable);
  document.getElementById('admin-shop-status-filter').addEventListener('change', renderShopTable);
  searchInput.addEventListener('input', function () { renderTable(); renderShopTable(); });

  var ordersDateBtn = document.getElementById('admin-orders-date-range-btn');
  var ordersDatePopover = document.getElementById('admin-orders-date-range-popover');
  var ordersDateLabel = document.getElementById('admin-orders-date-range-label');

  ordersDateBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    ordersDatePopover.classList.toggle('is-open');
  });
  window.addEventListener('scroll', function () {
    ordersDatePopover.classList.remove('is-open');
  }, true);
  document.addEventListener('click', function (e) {
    if (!ordersDatePopover.contains(e.target) && e.target !== ordersDateBtn) {
      ordersDatePopover.classList.remove('is-open');
    }
  });

  function formatOrdersRangeLabel(from, till) {
    if (!from && !till) return 'All Dates';
    var opts = { day: 'numeric', month: 'short', year: 'numeric' };
    var fromLabel = from ? new Date(from + 'T00:00:00').toLocaleDateString('en-GB', opts) : '…';
    var tillLabel = till ? new Date(till + 'T00:00:00').toLocaleDateString('en-GB', opts) : '…';
    return fromLabel + ' – ' + tillLabel;
  }

  document.getElementById('admin-orders-date-apply-btn').addEventListener('click', function () {
    var from = document.getElementById('admin-orders-date-from').value;
    var till = document.getElementById('admin-orders-date-to').value;
    ordersPresetFromTime = null;
    document.querySelectorAll('[data-orders-preset]').forEach(function (b) { b.classList.remove('active'); });
    ordersDateLabel.textContent = formatOrdersRangeLabel(from, till);
    ordersDatePopover.classList.remove('is-open');
    renderTable();
    renderShopTable();
  });

  document.getElementById('admin-orders-date-reset-btn').addEventListener('click', function () {
    ordersPresetFromTime = null;
    document.querySelectorAll('[data-orders-preset]').forEach(function (b) { b.classList.remove('active'); });
    document.getElementById('admin-orders-date-from').value = '';
    document.getElementById('admin-orders-date-to').value = '';
    ordersDateLabel.textContent = 'All Dates';
    ordersDatePopover.classList.remove('is-open');
    renderTable();
    renderShopTable();
  });

  var ordersPresetLabels = { all: 'All Dates', '24h': 'Last 24 Hours', '7d': 'Last 7 Days', '30d': 'Last 30 Days' };
  document.querySelectorAll('[data-orders-preset]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var preset = btn.getAttribute('data-orders-preset');
      document.querySelectorAll('[data-orders-preset]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('admin-orders-date-from').value = '';
      document.getElementById('admin-orders-date-to').value = '';

      if (preset === 'all') {
        ordersPresetFromTime = null;
      } else {
        var hoursBack = preset === '24h' ? 24 : (preset === '7d' ? 24 * 7 : 24 * 30);
        ordersPresetFromTime = Date.now() - hoursBack * 60 * 60 * 1000;
      }
      ordersDateLabel.textContent = ordersPresetLabels[preset];
      ordersDatePopover.classList.remove('is-open');
      renderTable();
      renderShopTable();
    });
  });

  // ---------- Right-side order drawer ----------
  var drawerOverlay = document.getElementById('admin-order-drawer-overlay');
  var drawerNumber = document.getElementById('admin-drawer-order-number');
  var drawerStatusBadge = document.getElementById('admin-drawer-status-badge');
  var drawerBody = document.getElementById('admin-order-drawer-body');

  function addressBlock(addrJson) {
    var addr;
    try { addr = JSON.parse(addrJson || '{}'); } catch (e) { addr = {}; }
    if (!addr.building && !addr.city) return '<p style="opacity:0.6;">Not provided</p>';
    return '<p style="margin:0;">' + [addr.building, addr.street, addr.city, addr.state, addr.pincode, addr.country].filter(Boolean).join(', ') + '</p>';
  }

  // Only an order that's actually been paid for, and isn't already
  // fully refunded, can have something returned from it.
  var RETURNABLE_STATUSES = ['paid', 'shipped', 'delivered', 'delivered_direct_pay', 'partially_refunded'];
  var RETURN_METHOD_LABEL = { cash: 'Cash', bank_transfer: 'Bank transfer', gift_card: 'Store credit' };

  function buildReturnSectionHtml(order, items) {
    var alreadyReturnedIds = {};
    (order.returns || []).forEach(function (r) {
      (r.items_returned || []).forEach(function (it) { alreadyReturnedIds[it.id] = true; });
    });

    var returnableItems = items.filter(function (it) { return !alreadyReturnedIds[it.id]; });

    var itemsHtml = items.map(function (it) {
      var isReturned = !!alreadyReturnedIds[it.id];
      if (isReturned) {
        return '<div style="display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid #EADFD6; font-size:0.82rem; opacity:0.5;">' +
          '<span style="flex:1;">' + (it.id || '') + ' \u2014 ' + (it.name || it.id || 'Item') + '</span>' +
          '<span style="font-size:0.68rem; color:#B8142A; font-weight:700; text-transform:uppercase;">Already returned</span>' +
        '</div>';
      }
      var itQty = Number(it.qty) || 1;
      var itLineValue = (Number(it.price) || 0) * itQty;
      return '<label style="display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid #EADFD6; font-size:0.82rem; cursor:pointer;">' +
        '<input type="checkbox" class="admin-return-item-checkbox" data-item-id="' + it.id + '" data-item-price="' + itLineValue + '">' +
        '<span style="flex:1;">' + (it.id || '') + ' \u2014 ' + (it.name || it.id || 'Item') + (itQty > 1 ? ' (Qty: ' + itQty + ')' : '') + '</span>' +
        '<span style="font-weight:600;">AED ' + formatAED(itLineValue) + '</span>' +
      '</label>';
    }).join('');

    var historyHtml = '';
    if ((order.returns || []).length) {
      historyHtml = '<p style="font-size:0.72rem; opacity:0.6; margin:12px 0 4px;">Return history</p>' +
        order.returns.map(function (r) {
          var names = (r.items_returned || []).map(function (it) { return it.id || it.name; }).join(', ');
          return '<div style="font-size:0.72rem; opacity:0.75; padding:4px 0;">' +
            new Date(r.created_at).toLocaleDateString() + ' \u2014 ' + names + ' \u2014 AED ' + formatAED(r.refund_amount || 0) +
            ' via ' + (RETURN_METHOD_LABEL[r.refund_method] || r.refund_method) +
            (r.processed_by ? ' (' + r.processed_by + ')' : '') +
          '</div>';
        }).join('');
    }

    if (!returnableItems.length) {
      return '<h4 style="margin-top:20px;">Process Return</h4>' +
        '<p style="font-size:0.82rem; opacity:0.6;">Every item on this order has already been returned.</p>' + historyHtml;
    }

    return '<div style="margin-top:20px; display:flex; align-items:center; justify-content:space-between;">' +
        '<h4 style="margin:0;">Process Return</h4>' +
        '<label class="admin-toggle-switch" for="admin-return-toggle"><input type="checkbox" id="admin-return-toggle"><span class="admin-toggle-slider"></span></label>' +
      '</div>' +
      '<div id="admin-return-section-body" style="display:none; margin-top:10px;">' +
        '<div id="admin-return-items">' + itemsHtml + '</div>' +
        '<div style="margin-top:10px;" class="admin-field">' +
          '<label style="font-size:0.76rem; opacity:0.7; display:block; margin-bottom:4px;">Refund via</label>' +
          '<select id="admin-return-method" class="admin-pill-input" style="width:100%;">' +
            '<option value="cash">Cash</option>' +
            '<option value="bank_transfer">Bank transfer</option>' +
            '<option value="gift_card">Store credit (Gift Card)</option>' +
          '</select>' +
        '</div>' +
        '<p id="admin-return-estimate" style="font-size:0.82rem; font-weight:600; margin:10px 0 0;">Select at least one item</p>' +
        '<div style="display:flex; gap:10px; margin-top:10px;">' +
          '<button type="button" class="btn btn-primary" id="admin-return-submit-btn" style="flex:1;" disabled>Process Return</button>' +
          '<button type="button" class="btn btn-ghost" id="admin-return-cancel-btn" style="flex:1;">Cancel</button>' +
        '</div>' +
        '<p id="admin-return-msg" class="admin-status-msg" style="display:none; margin-top:8px;"></p>' +
      '</div>' +
      historyHtml;
  }

  function updateReturnEstimate(order) {
    var submitBtn = document.getElementById('admin-return-submit-btn');
    var estimateEl = document.getElementById('admin-return-estimate');
    if (!submitBtn || !estimateEl) return;
    var checked = Array.prototype.slice.call(drawerBody.querySelectorAll('.admin-return-item-checkbox:checked'));
    if (!checked.length) {
      estimateEl.textContent = 'Select at least one item';
      submitBtn.disabled = true;
      return;
    }
    var listValue = checked.reduce(function (sum, cb) { return sum + (Number(cb.getAttribute('data-item-price')) || 0); }, 0);
    var subtotal = order.subtotal != null ? Number(order.subtotal) : Number(order.total);
    var ratio = subtotal > 0 ? (Number(order.total) || 0) / subtotal : 1;
    var estimate = Math.round(listValue * ratio * 100) / 100;
    estimateEl.textContent = 'Estimated refund: AED ' + formatAED(estimate) + (ratio !== 1 ? ' (after order discount)' : '');
    submitBtn.disabled = false;
  }

  function openOrderDrawer(order) {
    drawerStatusMsg.className = 'admin-status-msg';
    drawerStatusMsg.textContent = '';
    var isShop = order.channel === 'shop';
    drawerNumber.textContent = (isShop ? 'Bill ' : 'Order #') + (order.order_number || order.id);
    drawerStatusBadge.textContent = isShop ? order.status : statusLabel(order.status);

    var items = [];
    try { items = JSON.parse(order.items || '[]'); } catch (e) {}
    var itemsHtml = items.map(function (it) {
      var p = (window.PRODUCTS || []).find(function (x) { return x.id === it.id; });
      var img = p ? p.image : (it.image || '');
      return '<div class="admin-order-drawer-item">' +
        (img ? '<img src="' + img + '">' : '') +
        '<span style="flex:1;">' + (it.id ? it.id + ' \u2014 ' : '') + (it.name || it.id || 'Item') + (it.qty && it.qty > 1 ? ' &times; ' + it.qty : '') + '</span>' +
        '<span style="font-weight:600;">AED ' + formatAED(it.price || 0) + '</span>' +
      '</div>';
    }).join('') || '<p style="opacity:0.6;">No items on record.</p>';

    var subtotal = order.subtotal != null ? Number(order.subtotal) : Number(order.total);
    var discount = Number(order.discount_amount) || 0;

    var html =
      '<h4>Customer</h4>' +
      '<p style="margin:0;"><strong>' + (order.customer_name || '—') + '</strong></p>' +
      '<p style="margin:0;">' + (order.customer_email || '') + '</p>' +
      '<p style="margin:0;">' + (order.customer_phone || '') + '</p>' +

      '<h4>Items</h4>' + itemsHtml +

      '<h4>Order Summary</h4>' +
      '<div class="admin-order-drawer-totals-row"><span>Subtotal</span><span>AED ' + formatAED(subtotal) + '</span></div>' +
      (discount > 0 ? '<div class="admin-order-drawer-totals-row"><span>Discount' + (order.promo_code ? ' (' + order.promo_code + ')' : '') + '</span><span>-AED ' + formatAED(discount) + '</span></div>' : '') +
      '<div class="admin-order-drawer-totals-row total"><span>Total</span><span>AED ' + formatAED(order.total || 0) + '</span></div>' +

      '<h4>Payment Method</h4>' +
      (isShop
        ? '<p style="margin:0;">' + (order.payment_method || 'Not recorded') + '</p>'
        : buildPaymentMethodSelect(order));

    if (isShop) {
      html +=
        (order.sales_person ? '<h4>Sales Person</h4><p style="margin:0;">' + order.sales_person + '</p>' : '') +
        '<h4>Fulfillment</h4>' +
        '<p style="margin:0; opacity:0.7;">In-store purchase — no shipping address.</p>' +
        '<h4>Status</h4>' +
        '<span style="font-size:0.78rem; font-weight:700; padding:4px 12px; border-radius:6px; ' + shopStatusBadgeColor(order.status) + '">' + order.status + '</span>' +
        '<p style="margin:6px 0 0; font-size:0.72rem; opacity:0.6;">Reflects returns/exchanges recorded in the POS — not editable here.</p>' +
        '<h4>Delivery Method</h4>' +
        buildDeliveryButton(order, true) +
        deliveryCostNote(order) +
        '<h4>Danger Zone</h4>' +
        '<button type="button" class="btn btn-ghost" id="admin-shop-delete-btn" style="width:100%; color:#B8142A; border-color:#B8142A;">Delete This Sale</button>';
    } else {
      html +=
        '<h4>Billing Address</h4>' + addressBlock(order.billing_address) +
        '<h4>Shipping Address' + (order.billing_address === order.shipping_address ? ' (same as billing)' : '') + '</h4>' + addressBlock(order.shipping_address) +
        '<h4>Update Status</h4>' +
        buildStatusSelect(order) +
        '<h4>Delivery Method</h4>' +
        buildDeliveryButton(order, false) +
        deliveryCostNote(order);

      if (order.status === 'pending' && order.customer_phone) {
        html += '<button type="button" class="btn btn-outline" id="admin-pending-followup-btn" style="width:100%; margin-top:10px;">Send WhatsApp Follow-up</button>';
      }

      // Only while an order is still awaiting dispatch — Paid, or Cash
      // on Delivery still pending — does confirming the delivery
      // address make sense. Once it's shipped/delivered/cancelled,
      // there's nothing left to confirm before dispatch.
      if ((order.status === 'paid' || order.status === 'cod_pending') && order.customer_phone) {
        html += '<h4 style="margin-top:20px;">Dispatch</h4>' +
          '<button type="button" class="btn" id="admin-dispatch-confirm-btn" style="width:100%; background:#25D366; color:#fff;">Send WhatsApp confirmation</button>' +
          '<p style="font-size:0.72rem; opacity:0.6; margin:6px 0 0;">Confirms delivery address, asks for a Google Maps pin, thanks the customer, signed from the Pavnika dispatch team.</p>';
      }

      if (RETURNABLE_STATUSES.indexOf(order.status) !== -1) {
        html += buildReturnSectionHtml(order, items);
      }
    }

    drawerBody.innerHTML = html;
    drawerOverlay.classList.add('is-open');

    var followUpBtn = document.getElementById('admin-pending-followup-btn');
    if (followUpBtn) {
      followUpBtn.addEventListener('click', function () {
        var message = buildPendingFollowUpMessage(order, items);
        window.open(buildWhatsAppUrl(order.customer_phone, message), '_blank', 'noopener');
      });
    }

    var dispatchConfirmBtn = document.getElementById('admin-dispatch-confirm-btn');
    if (dispatchConfirmBtn) {
      dispatchConfirmBtn.addEventListener('click', function () {
        var message = buildDispatchConfirmationMessage(order);
        window.open(buildWhatsAppUrl(order.customer_phone, message), '_blank', 'noopener');
      });
    }

    currentDrawerShopOrder = isShop ? order : null;
    currentDrawerOnlineOrder = isShop ? null : order;
    if (isShop) {
      document.getElementById('admin-shop-delete-btn').addEventListener('click', function () {
        openDeleteSaleWarning(order);
      });
    }

    var returnToggle = document.getElementById('admin-return-toggle');
    var returnSectionBody = document.getElementById('admin-return-section-body');
    if (returnToggle && returnSectionBody) {
      returnToggle.addEventListener('change', function () {
        returnSectionBody.style.display = returnToggle.checked ? 'block' : 'none';
      });
    }
    var returnCancelBtn = document.getElementById('admin-return-cancel-btn');
    if (returnCancelBtn && returnToggle) {
      returnCancelBtn.addEventListener('click', function () {
        drawerBody.querySelectorAll('.admin-return-item-checkbox:checked').forEach(function (cb) { cb.checked = false; });
        updateReturnEstimate(order);
        returnToggle.checked = false;
        returnSectionBody.style.display = 'none';
      });
    }

    var returnSubmitBtn = document.getElementById('admin-return-submit-btn');
    if (returnSubmitBtn) {
      returnSubmitBtn.addEventListener('click', function () {
        var checked = Array.prototype.slice.call(drawerBody.querySelectorAll('.admin-return-item-checkbox:checked'));
        if (!checked.length) return;
        var itemIds = checked.map(function (cb) { return cb.getAttribute('data-item-id'); });
        var method = document.getElementById('admin-return-method').value;
        var returnMsgEl = document.getElementById('admin-return-msg');

        showConfirmPopup('Process a return for ' + itemIds.length + ' item(s) via ' + RETURN_METHOD_LABEL[method] + '? This cannot be undone here.', function () {
        returnSubmitBtn.disabled = true;
        returnSubmitBtn.textContent = 'Processing...';
        returnMsgEl.style.display = 'none';

        fetch('/.netlify/functions/admin-process-order-return', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminToken: token, orderId: order.id, itemIds: itemIds, refundMethod: method })
        })
          .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
          .then(function (result) {
            if (!result.ok) {
              returnMsgEl.className = 'admin-status-msg admin-status-error';
              returnMsgEl.textContent = result.data.error || 'Could not process the return.';
              returnMsgEl.style.display = 'block';
              returnSubmitBtn.disabled = false;
              returnSubmitBtn.textContent = 'Process Return';
              return;
            }
            var liveOrder = allOrders.find(function (o) { return String(o.id) === String(order.id); });
            if (liveOrder) {
              liveOrder.status = result.data.newStatus;
              liveOrder.returns = (liveOrder.returns || []).concat([result.data.returnRecord]);
              openOrderDrawer(liveOrder);
            }
            showDrawerStatus('success', 'Return processed \u2014 AED ' + formatAED(result.data.refundAmount || 0) + ' refunded via ' + RETURN_METHOD_LABEL[method] + '.');
            renderSummary();
            renderTable();
          })
          .catch(function () {
            returnMsgEl.className = 'admin-status-msg admin-status-error';
            returnMsgEl.textContent = 'Network error \u2014 return was not processed.';
            returnMsgEl.style.display = 'block';
            returnSubmitBtn.disabled = false;
            returnSubmitBtn.textContent = 'Process Return';
          });
        });
      });
    }
  }

  function closeOrderDrawer() {
    drawerOverlay.classList.remove('is-open');
  }

  function handleOrderRowClick(e) {
    if (e.target.closest('select')) return; // clicking the status dropdown updates status, doesn't open the drawer
    var row = e.target.closest('.admin-orders-clickable-row');
    if (!row) return;
    var isShop = row.getAttribute('data-channel') === 'shop';
    var source = isShop ? allShopOrders : allOrders;
    var order = source.find(function (o) { return String(o.id) === String(row.getAttribute('data-id')); });
    if (order) openOrderDrawer(order);
  }
  rowsEl.addEventListener('click', handleOrderRowClick);
  document.getElementById('admin-orders-mobile-list').addEventListener('click', handleOrderRowClick);
  document.getElementById('admin-shop-orders-rows').addEventListener('click', handleOrderRowClick);
  document.getElementById('admin-shop-orders-mobile-list').addEventListener('click', handleOrderRowClick);

  document.getElementById('admin-order-drawer-close').addEventListener('click', closeOrderDrawer);
  drawerOverlay.addEventListener('click', function (e) {
    if (e.target === drawerOverlay) closeOrderDrawer();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawerOverlay.classList.contains('is-open')) closeOrderDrawer();
  });

  // The drawer's own status select uses the same change handler as
  // the table's (delegated on rowsEl), so it also needs its own
  // listener since it isn't inside rowsEl.
  var drawerStatusMsg = document.getElementById('admin-drawer-status-msg');
  function showDrawerStatus(type, msg) {
    drawerStatusMsg.className = 'admin-status-msg admin-status-' + type;
    drawerStatusMsg.textContent = msg;
  }

  drawerBody.addEventListener('change', function (e) {
    if (e.target.classList && e.target.classList.contains('admin-return-item-checkbox') && currentDrawerOnlineOrder) {
      updateReturnEstimate(currentDrawerOnlineOrder);
      return;
    }

    var select = e.target.closest('.admin-order-status-select');
    if (select) {
      var orderId = select.getAttribute('data-id');
      var newStatus = select.value;
      var orderForStatus = allOrders.find(function (o) { return String(o.id) === String(orderId); });
      var prevStatus = orderForStatus ? orderForStatus.status : select.value;
      select.value = prevStatus; // hold the visible value until confirmed

      if (newStatus === 'delivered') {
        showDeliveryMethodPopup('Marking this order as Delivered.', function (method, customCost) {
          select.value = newStatus;
          showDrawerStatus('success', 'Saving...');

          applyDeliveryMethod('online', orderId, method, customCost)
            .then(function (dmResult) {
              if (!dmResult.ok) { showDrawerStatus('error', dmResult.data.error || 'Could not set delivery method.'); select.value = prevStatus; return; }
              if (orderForStatus) { orderForStatus.delivery_method = dmResult.data.deliveryMethod; orderForStatus.delivery_cost = dmResult.data.deliveryCost; }
              var deliveryBtnEl = drawerBody.querySelector('.admin-order-delivery-btn[data-channel="online"]');
              if (deliveryBtnEl) {
                deliveryBtnEl.textContent = DELIVERY_METHOD_LABEL[dmResult.data.deliveryMethod];
                var noteEl = deliveryBtnEl.nextElementSibling;
                if (noteEl) noteEl.innerHTML = 'Locked at AED ' + formatAED(dmResult.data.deliveryCost || 0) + ' when last set — won’t change if Delivery Rates are edited later.';
              }
              return updateOrderStatus(orderId, newStatus).then(function (result) {
                if (!result.ok) { showDrawerStatus('error', result.data.error || 'Could not update status.'); select.value = prevStatus; return; }
                if (orderForStatus) orderForStatus.status = newStatus;
                drawerStatusBadge.textContent = statusLabel(newStatus);
                showDrawerStatus('success', 'Updated to Delivered (' + DELIVERY_METHOD_LABEL[dmResult.data.deliveryMethod] + ', AED ' + formatAED(dmResult.data.deliveryCost || 0) + ').');
                renderSummary();
                renderTable();
              });
            })
            .catch(function () { showDrawerStatus('error', 'Network error — status was not updated.'); select.value = prevStatus; });
        }, function () { select.value = prevStatus; }, { partnerRate: currentDeliveryRates.partner_rate });
        return;
      }

      showConfirmPopup('Change this order’s status to “' + statusLabel(newStatus) + '”?', function () {
        select.value = newStatus;
        showDrawerStatus('success', 'Saving...');

        updateOrderStatus(orderId, newStatus)
          .then(function (result) {
            if (!result.ok) { showDrawerStatus('error', result.data.error || 'Could not update status.'); select.value = prevStatus; return; }
            var order = allOrders.find(function (o) { return String(o.id) === String(orderId); });
            if (order) order.status = newStatus;
            drawerStatusBadge.textContent = statusLabel(newStatus);
            showDrawerStatus('success', 'Updated to ' + statusLabel(newStatus) + '.');
            renderSummary();
            renderTable();
          })
          .catch(function () { showDrawerStatus('error', 'Network error — status was not updated.'); select.value = prevStatus; });
      }, function () { select.value = prevStatus; });
      return;
    }

    var paymentSelect = e.target.closest('.admin-order-payment-select');
    if (paymentSelect) {
      var payOrderId = paymentSelect.getAttribute('data-id');
      var newPaymentMethod = paymentSelect.value;
      if (!newPaymentMethod) return; // the disabled "Not recorded" placeholder — nothing to save
      var orderForPayment = allOrders.find(function (o) { return String(o.id) === String(payOrderId); });
      var prevPaymentMethod = orderForPayment ? orderForPayment.payment_method : newPaymentMethod;
      paymentSelect.value = prevPaymentMethod || newPaymentMethod;

      showConfirmPopup('Change this order’s payment method to “' + newPaymentMethod + '”?', function () {
        paymentSelect.value = newPaymentMethod;
        showDrawerStatus('success', 'Saving...');

        fetch('/.netlify/functions/admin-update-order-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminToken: token, orderId: payOrderId, paymentMethod: newPaymentMethod })
        })
          .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
          .then(function (result) {
            if (!result.ok) { showDrawerStatus('error', result.data.error || 'Could not update payment method.'); paymentSelect.value = prevPaymentMethod; return; }
            var order = allOrders.find(function (o) { return String(o.id) === String(payOrderId); });
            if (order) order.payment_method = newPaymentMethod;
            showDrawerStatus('success', 'Payment method set to ' + newPaymentMethod + '.');
            renderTable();
          })
          .catch(function () { showDrawerStatus('error', 'Network error — payment method was not updated.'); paymentSelect.value = prevPaymentMethod; });
      });
      return;
    }

  });

  // The Delivery Method control is a button, not a <select> -- tapping
  // it opens the same popup used when marking an order Delivered, so
  // this is a separate 'click' listener rather than part of the
  // 'change' one above.
  drawerBody.addEventListener('click', function (e) {
    var deliveryBtn = e.target.closest('.admin-order-delivery-btn');
    if (!deliveryBtn) return;

    var deliveryChannel = deliveryBtn.getAttribute('data-channel');
    var deliveryId = deliveryBtn.getAttribute('data-id');
    var deliverySource = deliveryChannel === 'shop' ? allShopOrders : allOrders;
    var orderForDelivery = deliverySource.find(function (o) { return String(o.id) === String(deliveryId); });
    var prevLabel = deliveryBtn.textContent;

    showDeliveryMethodPopup(
      'Choose how this ' + (deliveryChannel === 'shop' ? 'sale' : 'order') + ' was delivered. This locks in the amount shown for it.',
      function (method, customCost) {
        showDrawerStatus('success', 'Saving...');
        applyDeliveryMethod(deliveryChannel, deliveryId, method, customCost)
          .then(function (result) {
            if (!result.ok) { showDrawerStatus('error', result.data.error || 'Could not set delivery method.'); deliveryBtn.textContent = prevLabel; return; }
            if (orderForDelivery) {
              orderForDelivery.delivery_method = result.data.deliveryMethod;
              orderForDelivery.delivery_cost = result.data.deliveryCost;
            }
            deliveryBtn.textContent = DELIVERY_METHOD_LABEL[result.data.deliveryMethod];
            var noteEl = deliveryBtn.nextElementSibling;
            if (noteEl) noteEl.innerHTML = 'Locked at AED ' + formatAED(result.data.deliveryCost || 0) + ' when last set — won’t change if Delivery Rates are edited later.';
            showDrawerStatus('success', 'Delivery method set to ' + DELIVERY_METHOD_LABEL[result.data.deliveryMethod] + ' (AED ' + formatAED(result.data.deliveryCost || 0) + ').');
          })
          .catch(function () { showDrawerStatus('error', 'Network error — delivery method was not updated.'); deliveryBtn.textContent = prevLabel; });
      },
      null,
      { partnerRate: currentDeliveryRates.partner_rate, prefillMethod: orderForDelivery ? orderForDelivery.delivery_method : null, prefillCost: orderForDelivery ? orderForDelivery.delivery_cost : null }
    );
  });

  function loadOrders() {
    Promise.all([
      fetch('/.netlify/functions/admin-get-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminToken: token })
      }).then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); }),
      fetch('/.netlify/functions/admin-get-pos-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminToken: token })
      }).then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    ])
      .then(function (results) {
        var onlineResult = results[0];
        var shopResult = results[1];
        if (!onlineResult.ok) { showStatus('error', onlineResult.data.error || 'Could not load online orders.'); }
        if (!shopResult.ok) { showStatus('error', shopResult.data.error || 'Could not load shop orders.'); }
        allOrders = onlineResult.data.orders || [];
        allShopOrders = shopResult.data.sales || [];
        document.getElementById('admin-tab-online-count').textContent = allOrders.length;
        document.getElementById('admin-tab-shop-count').textContent = allShopOrders.length;
        renderSummary();
        renderTable();
        renderShopTable();
      })
      .catch(function () { showStatus('error', 'Network error loading orders.'); });
  }

  document.querySelectorAll('.admin-channel-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      activeChannel = tab.getAttribute('data-channel');
      document.querySelectorAll('.admin-channel-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var isOnline = activeChannel === 'online';
      document.getElementById('admin-orders-table-online').classList.toggle('admin-channel-hidden', !isOnline);
      document.getElementById('admin-orders-table-shop').classList.toggle('admin-channel-hidden', isOnline);
      document.getElementById('admin-orders-mobile-list').classList.toggle('admin-channel-hidden', !isOnline);
      document.getElementById('admin-shop-orders-mobile-list').classList.toggle('admin-channel-hidden', isOnline);
      document.getElementById('admin-orders-pagination').classList.toggle('admin-channel-hidden', !isOnline);
      document.getElementById('admin-shop-orders-pagination').classList.toggle('admin-channel-hidden', isOnline);
      document.getElementById('admin-orders-status-filter').style.display = isOnline ? '' : 'none';
      document.getElementById('admin-shop-status-filter').style.display = isOnline ? 'none' : '';
    });
  });

  // Quick Actions -> Export Report: downloads whatever the currently
  // active channel/filters/search/date-range show right now (same
  // getFilteredSorted()/getFilteredSortedShop() the table itself uses,
  // so the export always matches what's on screen) as a CSV.
  var exportBtn = document.getElementById('admin-orders-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', function () {
      function esc(val) {
        val = val === undefined || val === null ? '' : String(val);
        if (val.indexOf(',') !== -1 || val.indexOf('"') !== -1 || val.indexOf('\n') !== -1) return '"' + val.replace(/"/g, '""') + '"';
        return val;
      }
      var rows, header;
      if (activeChannel === 'shop') {
        header = ['Bill No.', 'Date', 'Customer', 'Email', 'Items', 'Total (AED)', 'Sales Person', 'Status'];
        rows = getFilteredSortedShop().map(function (o) {
          var items = [];
          try { items = JSON.parse(o.items || '[]'); } catch (e) {}
          return [o.order_number || o.id, new Date(o.created_at).toLocaleString(), o.customer_name || '', o.customer_email || '',
            items.map(function (it) { return it.id; }).join('|'), Number(o.total || 0).toFixed(2), o.sales_person || '', o.status || ''].map(esc).join(',');
        });
      } else {
        header = ['Order #', 'Date', 'Customer', 'Email', 'Items', 'Total (AED)', 'Payment', 'Status'];
        rows = getFilteredSorted().map(function (o) {
          var items = [];
          try { items = JSON.parse(o.items || '[]'); } catch (e) {}
          return [o.order_number || o.id, new Date(o.created_at).toLocaleString(), o.customer_name || '', o.customer_email || '',
            items.map(function (it) { return it.id; }).join('|'), Number(o.total || 0).toFixed(2), o.payment_method || '', statusLabel(o.status)].map(esc).join(',');
        });
      }
      var csv = [header.map(esc).join(',')].concat(rows).join('\n');
      var blob = new Blob([csv], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pavnika-orders-' + activeChannel + '-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
    });
  }

  loadOrders();
  window.__refreshOrders = loadOrders;
}

/* ---------- Manual order entry (bank transfer / cash / offline Nomod) ---------- */
function initManualOrderView(token) {
  var statusMsg = document.getElementById('admin-mo-status-msg');
  var searchInput = document.getElementById('admin-mo-saree-search');
  var qtyInput = document.getElementById('admin-mo-saree-qty');
  var addBtn = document.getElementById('admin-mo-add-saree-btn');
  var pickedWrap = document.getElementById('admin-mo-picked-items');
  var discountTypeBtns = document.querySelectorAll('.admin-mo-discount-type-btn');
  var discountValueInput = document.getElementById('admin-mo-discount-value');
  var totalPreview = document.getElementById('admin-mo-total-preview');
  var sameAddressBox = document.getElementById('admin-mo-same-address');
  var shippingCard = document.getElementById('admin-mo-shipping-card');
  var billingCountrySelect = document.getElementById('admin-mo-billing-country');
  var shippingCountrySelect = document.getElementById('admin-mo-shipping-country');
  var submitBtn = document.getElementById('admin-mo-submit-btn');
  var giftCardCard = document.getElementById('admin-mo-giftcard-card');
  var giftCardBalanceText = document.getElementById('admin-mo-giftcard-balance-text');
  var giftCardCheckboxLabel = document.getElementById('admin-mo-giftcard-checkbox-label');
  var applyGiftCardCheckbox = document.getElementById('admin-mo-apply-giftcard');
  var knownGiftCardBalance = 0;
  var moConfirmOverlay = document.getElementById('admin-mo-confirm-overlay');
  var moConfirmDetails = document.getElementById('admin-mo-confirm-details');
  var moConfirmCancelBtn = document.getElementById('admin-mo-confirm-cancel-btn');
  var moConfirmSubmitBtn = document.getElementById('admin-mo-confirm-submit-btn');

  // Same country list and reconstruction logic as checkout.html's phone
  // field, duplicated here rather than shared — admin.js and script.js
  // are two entirely separate files with no shared module system, so
  // this is the same pragmatic small duplication already used
  // elsewhere in this codebase (e.g. formatAED).
  var MO_PHONE_COUNTRY_CODES = [
    { code: '971', label: '\uD83C\uDDE6\uD83C\uDDEA UAE +971', leadingZero: true },
    { code: '91', label: '\uD83C\uDDEE\uD83C\uDDF3 India +91', leadingZero: false },
    { code: '966', label: '\uD83C\uDDF8\uD83C\uDDE6 Saudi Arabia +966', leadingZero: false },
    { code: '968', label: '\uD83C\uDDF4\uD83C\uDDF2 Oman +968', leadingZero: false },
    { code: '974', label: '\uD83C\uDDF6\uD83C\uDDE6 Qatar +974', leadingZero: false },
    { code: '973', label: '\uD83C\uDDE7\uD83C\uDDED Bahrain +973', leadingZero: false },
    { code: '965', label: '\uD83C\uDDF0\uD83C\uDDFC Kuwait +965', leadingZero: false },
    { code: '44', label: '\uD83C\uDDEC\uD83C\uDDE7 UK +44', leadingZero: false },
    { code: '1', label: '\uD83C\uDDFA\uD83C\uDDF8 USA/Canada +1', leadingZero: false }
  ];
  var MO_PHONE_RE = /^\+[1-9][0-9]{6,14}$/;

  var phoneCodeSelect = document.getElementById('admin-mo-phone-code');
  var phoneNumberInput = document.getElementById('admin-mo-phone-number');
  var phoneHiddenInput = document.getElementById('admin-mo-phone');
  var phoneNote = document.getElementById('admin-mo-phone-note');

  phoneCodeSelect.innerHTML = MO_PHONE_COUNTRY_CODES.map(function (c, i) {
    return '<option value="' + c.code + '"' + (i === 0 ? ' selected' : '') + '>' + c.label + '</option>';
  }).join('');
  // First entry in the list above is UAE, so the default selection
  // (i === 0) already pre-fills +971 as requested — nothing extra
  // needed here beyond keeping UAE first in that list.

  function syncManualOrderPhone() {
    var codeEntry = MO_PHONE_COUNTRY_CODES.find(function (c) { return c.code === phoneCodeSelect.value; });
    var digits = phoneNumberInput.value.replace(/[^\d]/g, '');
    var startsWithZero = digits.charAt(0) === '0';

    if (codeEntry && codeEntry.leadingZero && startsWithZero) {
      phoneHiddenInput.value = '';
      phoneNote.textContent = 'Don\u2019t include the leading 0 \u2014 with +' + codeEntry.code + ' already selected, just enter e.g. "50 123 4567".';
      phoneNote.classList.remove('ok');
      phoneNote.style.display = digits ? 'block' : 'none';
      phoneNumberInput.classList.toggle('field-invalid', !!digits);
      return false;
    }

    var full = '+' + phoneCodeSelect.value + digits;
    phoneHiddenInput.value = digits ? full : '';

    if (!digits) {
      phoneNote.style.display = 'none';
      phoneNumberInput.classList.remove('field-invalid');
      return true;
    }
    if (!MO_PHONE_RE.test(full)) {
      phoneNote.textContent = 'Please enter a valid mobile number.';
      phoneNote.classList.remove('ok');
      phoneNote.style.display = 'block';
      phoneNumberInput.classList.add('field-invalid');
      return false;
    }
    phoneNote.textContent = '\u2713 Looks good';
    phoneNote.classList.add('ok');
    phoneNote.style.display = 'block';
    phoneNumberInput.classList.remove('field-invalid');
    return true;
  }

  // Splits a phone string already on file (e.g. from a searched-up
  // existing customer) back into {code, number} for the two visible
  // fields — matched by longest code first, so +91... isn't
  // accidentally matched by a hypothetical single-digit code before
  // the real one is checked.
  function splitExistingPhone(raw) {
    var digits = String(raw || '').replace(/[^\d]/g, '');
    var sorted = MO_PHONE_COUNTRY_CODES.slice().sort(function (a, b) { return b.code.length - a.code.length; });
    for (var i = 0; i < sorted.length; i++) {
      if (digits.indexOf(sorted[i].code) === 0) {
        return { code: sorted[i].code, number: digits.slice(sorted[i].code.length) };
      }
    }
    return { code: '971', number: digits }; // unrecognized prefix — default to UAE rather than guess wrong
  }

  function setManualOrderPhone(raw) {
    var parts = splitExistingPhone(raw);
    phoneCodeSelect.value = parts.code;
    phoneNumberInput.value = parts.number;
    syncManualOrderPhone();
  }

  phoneCodeSelect.addEventListener('change', syncManualOrderPhone);
  phoneNumberInput.addEventListener('input', syncManualOrderPhone);
  syncManualOrderPhone();

  // Purely informational until submit — the server always re-checks
  // and re-caps the real balance itself, so a stale value here (e.g.
  // if the balance changed in another tab a second ago) can't cause
  // more credit to be applied than the customer actually has.
  function checkGiftCardBalance() {
    var email = document.getElementById('admin-mo-email').value.trim();
    var phone = phoneHiddenInput.value.trim();
    if (!email && !phone) {
      giftCardCard.style.display = 'none';
      knownGiftCardBalance = 0;
      applyGiftCardCheckbox.checked = false;
      return;
    }
    fetch('/.netlify/functions/admin-lookup-gift-card-balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, email: email, phone: phone })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        knownGiftCardBalance = (data.found && Number(data.balance) > 0) ? Number(data.balance) : 0;
        if (knownGiftCardBalance > 0) {
          giftCardCard.style.display = 'block';
          giftCardBalanceText.textContent = 'This customer has AED ' + formatAED(knownGiftCardBalance) + ' in store credit.';
          giftCardCheckboxLabel.textContent = 'Apply available store credit (up to AED ' + formatAED(knownGiftCardBalance) + ')';
        } else {
          giftCardCard.style.display = 'none';
          applyGiftCardCheckbox.checked = false;
        }
        renderTotals();
      })
      .catch(function () { giftCardCard.style.display = 'none'; });
  }

  document.getElementById('admin-mo-email').addEventListener('blur', checkGiftCardBalance);
  phoneNumberInput.addEventListener('blur', checkGiftCardBalance);
  applyGiftCardCheckbox.addEventListener('change', renderTotals);

  var MO_COUNTRY_LIST = [
    'United Arab Emirates', 'India', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Bahrain', 'Oman',
    'United Kingdom', 'United States', 'Canada', 'Australia', 'Singapore', 'Pakistan',
    'Sri Lanka', 'Bangladesh', 'Other'
  ];
  [billingCountrySelect, shippingCountrySelect].forEach(function (select) {
    select.innerHTML = MO_COUNTRY_LIST.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
  });

  sameAddressBox.addEventListener('change', function () {
    shippingCard.style.display = sameAddressBox.checked ? 'none' : 'block';
  });

  // ---------- Customer search/autocomplete ----------
  var customerSearchInput = document.getElementById('admin-mo-customer-search');
  var customerResultsEl = document.getElementById('admin-mo-customer-results');
  var customerSearchTimer = null;

  customerSearchInput.addEventListener('input', function () {
    var query = customerSearchInput.value.trim();
    clearTimeout(customerSearchTimer);
    if (query.length < 2) {
      customerResultsEl.classList.remove('is-open');
      return;
    }
    customerSearchTimer = setTimeout(function () {
      fetch('/.netlify/functions/admin-search-customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminToken: token, query: query })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var customers = data.customers || [];
          if (!customers.length) {
            customerResultsEl.innerHTML = '<div class="admin-mo-customer-result-item" style="cursor:default; opacity:0.6;">No matching customers found.</div>';
          } else {
            customerResultsEl.innerHTML = customers.map(function (c, i) {
              return '<div class="admin-mo-customer-result-item" data-i="' + i + '">' +
                '<div class="cname">' + (c.name || 'Unnamed') + '</div>' +
                '<div class="cmeta">' + [c.email, c.phone].filter(Boolean).join(' · ') + '</div>' +
              '</div>';
            }).join('');
            customerResultsEl.__customers = customers;
          }
          customerResultsEl.classList.add('is-open');
        })
        .catch(function () { customerResultsEl.classList.remove('is-open'); });
    }, 300);
  });

  customerResultsEl.addEventListener('click', function (e) {
    var item = e.target.closest('.admin-mo-customer-result-item');
    if (!item || !item.hasAttribute('data-i')) return;
    var c = customerResultsEl.__customers[Number(item.getAttribute('data-i'))];
    if (!c) return;

    var nameParts = (c.name || '').trim().split(/\s+/);
    document.getElementById('admin-mo-first-name').value = nameParts[0] || '';
    document.getElementById('admin-mo-last-name').value = nameParts.slice(1).join(' ');
    document.getElementById('admin-mo-email').value = c.email || '';
    setManualOrderPhone(c.phone || '');

    if (c.billingAddress) {
      try {
        var addr = JSON.parse(c.billingAddress);
        document.getElementById('admin-mo-billing-building').value = addr.building || '';
        document.getElementById('admin-mo-billing-street').value = addr.street || '';
        document.getElementById('admin-mo-billing-city').value = addr.city || '';
        document.getElementById('admin-mo-billing-state').value = addr.state || '';
        document.getElementById('admin-mo-billing-pincode').value = addr.pincode || '';
        if (addr.country) billingCountrySelect.value = addr.country;
      } catch (e) { /* address on file wasn't valid JSON — skip prefilling it, contact fields are still filled */ }
    }

    customerSearchInput.value = '';
    customerResultsEl.classList.remove('is-open');
    checkGiftCardBalance();
  });

  document.addEventListener('click', function (e) {
    if (!customerResultsEl.contains(e.target) && e.target !== customerSearchInput) {
      customerResultsEl.classList.remove('is-open');
    }
  });

  var pickedItems = []; // [{id, name, price, qty}]
  var discountType = 'percent';

  var sareeResultsEl = document.getElementById('admin-mo-saree-results');

  // Sarees identify themselves by material/design; Jewellery and
  // Accessories have neither, which is what was showing up as the
  // literal text "undefined" here (and, more importantly, in the
  // order record, confirmation email, and invoice, since this exact
  // name is what gets stored against the order).
  function itemDisplayName(p) {
    if (p.department === 'jewellery') return p.type + (p.colour ? ' — ' + p.colour : '');
    if (p.department === 'accessory') return p.type || 'Accessory';
    return p.material || p.design || p.id;
  }

  function sareeResultLabel(p) {
    return itemDisplayName(p) + ' — ' + p.id + ' — AED ' + formatAED(effectivePrice(p));
  }

  function renderSareeResults(query) {
    var q = query.trim().toLowerCase();
    if (!q) {
      sareeResultsEl.classList.remove('is-open');
      return;
    }
    var available = (window.PRODUCTS || []).filter(function (p) { return !p.sold; });
    var matches = available.filter(function (p) {
      return (p.id && String(p.id).toLowerCase().indexOf(q) !== -1) ||
        (p.material && p.material.toLowerCase().indexOf(q) !== -1) ||
        (p.design && p.design.toLowerCase().indexOf(q) !== -1) ||
        (p.type && p.type.toLowerCase().indexOf(q) !== -1) ||
        (p.colour && p.colour.toLowerCase().indexOf(q) !== -1) ||
        (p.category && p.category.toLowerCase().indexOf(q) !== -1);
    }).slice(0, 20);

    if (!matches.length) {
      sareeResultsEl.innerHTML = '<div class="admin-mo-saree-result-item" style="cursor:default; opacity:0.6;">No matching sarees found.</div>';
    } else {
      sareeResultsEl.innerHTML = matches.map(function (p, i) {
        var label = sareeResultLabel(p);
        return '<div class="admin-mo-saree-result-item" data-i="' + i + '">' +
          (p.image ? '<img src="' + p.image + '" loading="lazy" alt="">' : '') +
          '<div class="sinfo">' +
            '<div class="sname">' + itemDisplayName(p) + '</div>' +
            '<div class="smeta">' + p.id + (p.pattern ? ' · ' + p.pattern : '') + '</div>' +
          '</div>' +
          '<span class="sprice">AED ' + formatAED(effectivePrice(p)) + '</span>' +
        '</div>';
      }).join('');
      sareeResultsEl.__matches = matches;
    }
    sareeResultsEl.classList.add('is-open');
  }

  searchInput.addEventListener('input', function () { renderSareeResults(searchInput.value); });
  searchInput.addEventListener('focus', function () { if (searchInput.value.trim()) renderSareeResults(searchInput.value); });

  sareeResultsEl.addEventListener('click', function (e) {
    var item = e.target.closest('.admin-mo-saree-result-item');
    if (!item || !item.hasAttribute('data-i')) return;
    var p = sareeResultsEl.__matches[Number(item.getAttribute('data-i'))];
    if (!p) return;
    searchInput.value = sareeResultLabel(p);
    sareeResultsEl.classList.remove('is-open');
    qtyInput.focus();
  });

  document.addEventListener('click', function (e) {
    if (!sareeResultsEl.contains(e.target) && e.target !== searchInput) {
      sareeResultsEl.classList.remove('is-open');
    }
  });

  function showStatus(type, html) {
    statusMsg.className = 'admin-status-msg admin-status-' + type;
    statusMsg.innerHTML = html;
    if (html) statusMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function isAddressComplete(addr) {
    var pincodeOk = addr.country === 'United Arab Emirates' || !!addr.pincode;
    return !!(addr && addr.building && addr.street && addr.city && addr.state && pincodeOk && addr.country);
  }

  function showValidationError(message) {
    document.getElementById('admin-mo-error-text').textContent = message;
    document.getElementById('admin-mo-error-overlay').classList.add('is-open');
  }
  document.getElementById('admin-mo-error-ok-btn').addEventListener('click', function () {
    document.getElementById('admin-mo-error-overlay').classList.remove('is-open');
  });

  function computeTotals() {
    var subtotal = pickedItems.reduce(function (sum, it) { return sum + (Number(it.price) || 0) * (Number(it.qty) || 1); }, 0);
    var discountInput = Number(discountValueInput.value) || 0;
    var discountAmount = discountType === 'percent' ? subtotal * discountInput / 100 : discountInput;
    if (discountAmount > subtotal) discountAmount = subtotal; // never let a flat/percent typo produce a negative total
    var owedBeforeCredit = subtotal - discountAmount;
    var giftCardEstimate = (applyGiftCardCheckbox.checked && knownGiftCardBalance > 0)
      ? Math.min(knownGiftCardBalance, owedBeforeCredit)
      : 0;
    var total = owedBeforeCredit - giftCardEstimate;
    return { subtotal: subtotal, discountAmount: discountAmount, giftCardEstimate: giftCardEstimate, total: total };
  }

  function renderTotals() {
    var t = computeTotals();
    totalPreview.innerHTML =
      '<div style="display:flex; justify-content:space-between; padding:2px 0;"><span>Subtotal</span><span>AED ' + formatAED(t.subtotal) + '</span></div>' +
      (t.discountAmount > 0 ? '<div style="display:flex; justify-content:space-between; padding:2px 0; color:var(--green);"><span>Discount</span><span>-AED ' + formatAED(t.discountAmount) + '</span></div>' : '') +
      (t.giftCardEstimate > 0 ? '<div style="display:flex; justify-content:space-between; padding:2px 0; color:var(--green);"><span>Store credit</span><span>-AED ' + formatAED(t.giftCardEstimate) + '</span></div>' : '') +
      '<div style="display:flex; justify-content:space-between; padding:6px 0 0; margin-top:4px; border-top:1px solid var(--stone); font-weight:700; color:var(--green-deep);"><span>Total</span><span>AED ' + formatAED(t.total) + '</span></div>';
  }

  function renderPickedItems() {
    if (!pickedItems.length) {
      pickedWrap.innerHTML = '<p style="font-size:0.82rem; opacity:0.6; margin:0;">No sarees added yet.</p>';
    } else {
      pickedWrap.innerHTML = pickedItems.map(function (it, i) {
        var atStockCap = it.qty >= it.stockCap;
        return '<div style="display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--stone); border-radius:6px; margin-bottom:6px; font-size:0.82rem;">' +
          (it.image ? '<img src="' + it.image + '" style="width:34px; height:44px; object-fit:cover; border-radius:3px; flex-shrink:0;">' : '') +
          '<span style="flex:1; font-weight:600; color:var(--green-deep);">' + it.name + ' — ' + it.id + '</span>' +
          '<div class="admin-mo-qty-stepper">' +
            '<button type="button" class="admin-mo-qty-minus" data-i="' + i + '">&#8722;</button>' +
            '<span>' + it.qty + '</span>' +
            '<button type="button" class="admin-mo-qty-plus" data-i="' + i + '"' + (atStockCap ? ' disabled title="Only ' + it.stockCap + ' in stock"' : '') + '>+</button>' +
          '</div>' +
          '<span style="color:var(--gold); font-weight:700; min-width:80px; text-align:right;">AED ' + formatAED(it.price) + '</span>' +
          '<button type="button" class="admin-mo-remove-item" data-i="' + i + '" style="background:none; border:none; color:#B8142A; cursor:pointer; font-size:0.95rem;">&#10005;</button>' +
        '</div>';
      }).join('');
    }
    renderTotals();
  }
  renderPickedItems();

  pickedWrap.addEventListener('click', function (e) {
    var removeBtn = e.target.closest('.admin-mo-remove-item');
    if (removeBtn) {
      pickedItems.splice(Number(removeBtn.getAttribute('data-i')), 1);
      renderPickedItems();
      return;
    }
    var plusBtn = e.target.closest('.admin-mo-qty-plus');
    if (plusBtn) {
      var plusIdx = Number(plusBtn.getAttribute('data-i'));
      var plusItem = pickedItems[plusIdx];
      // Capped at stockCap (the item's real stock, captured when it was
      // added -- see addProductToOrder) so staff can't quietly key in
      // more units than actually exist, same limit the website and POS
      // already enforce.
      if (plusItem.qty < plusItem.stockCap) plusItem.qty += 1;
      renderPickedItems();
      return;
    }
    var minusBtn = e.target.closest('.admin-mo-qty-minus');
    if (minusBtn) {
      var idx = Number(minusBtn.getAttribute('data-i'));
      if (pickedItems[idx].qty > 1) {
        pickedItems[idx].qty -= 1;
      } else {
        pickedItems.splice(idx, 1); // decrementing below 1 removes the item, same as clicking the ✕
      }
      renderPickedItems();
    }
  });

  discountTypeBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      discountTypeBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      discountType = btn.getAttribute('data-type');
      renderTotals();
    });
  });
  discountValueInput.addEventListener('input', renderTotals);

  function addProductToOrder(product, qty) {
    qty = Math.max(1, qty || 1);
    // Stock cap -- same reasoning as POS's own item picker (admin staff
    // can still sell beyond the website's maxPerOrder, but not beyond
    // what's actually left in stock). A one-of-a-kind item (no
    // .quantity field at all) is capped at 1, same as everywhere else
    // on the site.
    var hasQty = product.quantity !== null && product.quantity !== undefined && !isNaN(Number(product.quantity));
    var stockCap = hasQty ? Math.max(0, Number(product.quantity)) : 1;
    var existing = pickedItems.find(function (it) { return it.id === product.id; });
    if (existing) {
      existing.qty = Math.min(existing.qty + qty, existing.stockCap);
    } else {
      pickedItems.push({
        id: product.id,
        name: itemDisplayName(product),
        price: effectivePrice(product),
        qty: Math.min(qty, stockCap),
        stockCap: stockCap,
        series: product.series,
        type: product.type,
        sareeType: product.sareeType,
        pattern: product.pattern,
        image: product.image
      });
    }
    renderPickedItems();
  }

  addBtn.addEventListener('click', function () {
    var typed = searchInput.value.trim();
    if (!typed) return;
    var product = (window.PRODUCTS || []).find(function (p) { return typed.indexOf(p.id) !== -1; });
    if (!product) {
      showStatus('error', 'Could not match that to an item — pick one from the suggestions list.');
      return;
    }
    addProductToOrder(product, parseInt(qtyInput.value, 10) || 1);
    searchInput.value = '';
    qtyInput.value = '1';
    showStatus('', '');
  });

  // Browse Catalogue picker — same visual pattern as POS's own browse
  // grid, adapted as a popup here since Manual Order's layout is a
  // compact form rather than a dedicated browse panel.
  var browseOverlay = document.getElementById('admin-mo-browse-overlay');
  var browseGrid = document.getElementById('admin-mo-browse-grid');
  var browseSearch = document.getElementById('admin-mo-browse-search');
  var browseDeptRow = document.getElementById('admin-mo-browse-dept-row');
  var browseDeptFilter = 'all';
  var browseHideSoldToggle = document.getElementById('admin-mo-browse-hide-sold');

  function renderBrowseGrid() {
    var q = browseSearch.value.trim().toLowerCase();
    var products = (window.PRODUCTS || []).filter(function (p) {
      if (browseHideSoldToggle.checked && p.sold) return false;
      if (browseDeptFilter === 'saree' && (p.department || 'saree') !== 'saree') return false;
      if (browseDeptFilter === 'jewellery' && p.department !== 'jewellery' && p.department !== 'accessory') return false;
      if (!q) return true;
      var fields = ['id', 'material', 'design', 'type', 'colour', 'category', 'series'];
      return fields.some(function (f) { return p[f] && String(p[f]).toLowerCase().indexOf(q) !== -1; });
    });
    if (!products.length) {
      browseGrid.innerHTML = '<p style="grid-column:1/-1; text-align:center; opacity:0.6; font-size:0.85rem; padding:20px;">No items match.</p>';
      return;
    }
    browseGrid.innerHTML = products.map(function (p) {
      var img = p.image ? '<img src="' + p.image + '" alt="">' : '<div class="mbt-noimg"></div>';
      return '<div class="admin-mo-browse-tile' + (p.sold ? ' mbt-sold' : '') + '" data-browse-id="' + p.id + '">' +
        img +
        '<div class="mbt-info">' +
          '<div class="mbt-code">' + p.id + '</div>' +
          '<div class="mbt-name">' + itemDisplayName(p) + '</div>' +
          (p.sold ? '<div class="mbt-sold-tag">Sold</div>' : '<div class="mbt-price">AED ' + Math.round(effectivePrice(p)).toLocaleString() + '</div>') +
        '</div>' +
      '</div>';
    }).join('');
    browseGrid.querySelectorAll('[data-browse-id]').forEach(function (tile) {
      tile.addEventListener('click', function () {
        var id = tile.getAttribute('data-browse-id');
        var product = (window.PRODUCTS || []).find(function (p) { return p.id === id; });
        if (!product || product.sold) return;
        addProductToOrder(product, 1);
        browseOverlay.classList.remove('is-open');
      });
    });
  }

  document.getElementById('admin-mo-browse-btn').addEventListener('click', function () {
    browseOverlay.classList.add('is-open');
    renderBrowseGrid();
  });
  document.getElementById('admin-mo-browse-close-btn').addEventListener('click', function () {
    browseOverlay.classList.remove('is-open');
  });
  browseOverlay.addEventListener('click', function (e) {
    if (e.target === browseOverlay) browseOverlay.classList.remove('is-open');
  });
  browseSearch.addEventListener('input', renderBrowseGrid);
  browseHideSoldToggle.addEventListener('change', renderBrowseGrid);
  browseDeptRow.querySelectorAll('.admin-dept-filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      browseDeptRow.querySelectorAll('.admin-dept-filter-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      browseDeptFilter = btn.getAttribute('data-dept');
      renderBrowseGrid();
    });
  });

  submitBtn.addEventListener('click', function () {
    showStatus('', '');

    if (!pickedItems.length) {
      showValidationError('Add at least one saree before submitting.');
      return;
    }
    var firstName = document.getElementById('admin-mo-first-name').value.trim();
    var lastName = document.getElementById('admin-mo-last-name').value.trim();
    var email = document.getElementById('admin-mo-email').value.trim();
    if (!firstName || !email) {
      showValidationError('First name and email are required.');
      return;
    }

    var billing = {
      building: document.getElementById('admin-mo-billing-building').value.trim(),
      street: document.getElementById('admin-mo-billing-street').value.trim(),
      city: document.getElementById('admin-mo-billing-city').value.trim(),
      state: document.getElementById('admin-mo-billing-state').value.trim(),
      pincode: document.getElementById('admin-mo-billing-pincode').value.trim(),
      country: billingCountrySelect.value
    };
    if (!isAddressComplete(billing)) {
      showValidationError('Billing address is incomplete \u2014 building, street, city, and state are required (pincode too, outside the UAE).');
      return;
    }
    var sameAddress = sameAddressBox.checked;
    var shipping = sameAddress ? billing : {
      building: document.getElementById('admin-mo-shipping-building').value.trim(),
      street: document.getElementById('admin-mo-shipping-street').value.trim(),
      city: document.getElementById('admin-mo-shipping-city').value.trim(),
      state: document.getElementById('admin-mo-shipping-state').value.trim(),
      pincode: document.getElementById('admin-mo-shipping-pincode').value.trim(),
      country: shippingCountrySelect.value
    };

    var t = computeTotals();
    var payload = {
      adminToken: token,
      items: pickedItems,
      customer: {
        firstName: firstName,
        lastName: lastName,
        email: email,
        phone: document.getElementById('admin-mo-phone').value.trim()
      },
      billingAddress: billing,
      shippingAddress: shipping,
      discountType: discountType,
      discountValue: Number(discountValueInput.value) || 0,
      subtotal: t.subtotal,
      discountAmount: t.discountAmount,
      total: t.total,
      applyGiftCard: !!(applyGiftCardCheckbox.checked && knownGiftCardBalance > 0),
      paymentMode: document.getElementById('admin-mo-payment-mode').value
    };

    // Show a summary of exactly what's about to be created/charged/
    // emailed before actually doing any of it -- a manual order can't
    // be undone from here once the confirmation email is sent, so this
    // is the last chance to catch a wrong item, a typo'd email, or a
    // discount that isn't what was meant.
    openManualOrderConfirm(payload, email);
  });

  function openManualOrderConfirm(payload, email) {
    var t = computeTotals();
    var itemsHtml = pickedItems.map(function (it) {
      return '<div style="display:flex; justify-content:space-between; gap:10px; padding:3px 0;">' +
        '<span>' + it.name + ' — ' + it.id + (it.qty > 1 ? ' &times; ' + it.qty : '') + '</span>' +
        '<span style="white-space:nowrap;">AED ' + formatAED(it.price * it.qty) + '</span>' +
      '</div>';
    }).join('');

    var totalsHtml =
      '<div style="display:flex; justify-content:space-between; padding:2px 0;"><span>Subtotal</span><span>AED ' + formatAED(t.subtotal) + '</span></div>' +
      (t.discountAmount > 0 ? '<div style="display:flex; justify-content:space-between; padding:2px 0; color:var(--green);"><span>Discount</span><span>-AED ' + formatAED(t.discountAmount) + '</span></div>' : '') +
      (t.giftCardEstimate > 0 ? '<div style="display:flex; justify-content:space-between; padding:2px 0; color:var(--green);"><span>Store credit</span><span>-AED ' + formatAED(t.giftCardEstimate) + '</span></div>' : '') +
      '<div style="display:flex; justify-content:space-between; padding:6px 0 0; margin-top:4px; border-top:1px solid var(--stone); font-weight:700; color:var(--green-deep);"><span>Total</span><span>AED ' + formatAED(t.total) + '</span></div>';

    var customerName = (payload.customer.firstName + ' ' + payload.customer.lastName).trim();
    var shipSameNote = payload.shippingAddress === payload.billingAddress ? ' (same as billing)' : '';

    moConfirmDetails.innerHTML =
      '<div style="margin-bottom:14px;">' +
        '<h4 style="font-size:0.68rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--gold); margin:0 0 6px;">Customer</h4>' +
        '<div>' + customerName + '</div>' +
        '<div style="opacity:0.75;">' + payload.customer.email + '</div>' +
        (payload.customer.phone ? '<div style="opacity:0.75;">' + payload.customer.phone + '</div>' : '') +
      '</div>' +
      '<div style="margin-bottom:14px;">' +
        '<h4 style="font-size:0.68rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--gold); margin:0 0 6px;">Items</h4>' +
        itemsHtml +
      '</div>' +
      '<div style="margin-bottom:14px;">' +
        totalsHtml +
      '</div>' +
      '<div style="margin-bottom:4px;">' +
        '<h4 style="font-size:0.68rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--gold); margin:0 0 6px;">Payment &amp; Shipping</h4>' +
        '<div>Payment: ' + payload.paymentMode + '</div>' +
        '<div style="opacity:0.75;">Ships to: ' + [payload.shippingAddress.building, payload.shippingAddress.street, payload.shippingAddress.city].filter(Boolean).join(', ') + shipSameNote + '</div>' +
      '</div>' +
      '<p style="font-size:0.78rem; opacity:0.7; margin:10px 0 0;">This will immediately mark the item(s) as sold and email an order confirmation to ' + email + '.</p>';

    moConfirmOverlay.classList.add('is-open');

    function cleanup() {
      moConfirmOverlay.classList.remove('is-open');
      moConfirmSubmitBtn.removeEventListener('click', onConfirm);
      moConfirmCancelBtn.removeEventListener('click', onCancel);
      moConfirmOverlay.removeEventListener('click', onOverlayClick);
    }
    function onCancel() { cleanup(); }
    function onOverlayClick(e) { if (e.target === moConfirmOverlay) onCancel(); }
    function onConfirm() {
      cleanup();
      submitManualOrder(payload, email);
    }
    moConfirmSubmitBtn.addEventListener('click', onConfirm);
    moConfirmCancelBtn.addEventListener('click', onCancel);
    moConfirmOverlay.addEventListener('click', onOverlayClick);
  }

  // Mirrors what the server just did to products-data.js, against the
  // browser's own in-memory window.PRODUCTS copy -- without this, the
  // item(s) just sold would still show as available in the browse
  // picker (and anywhere else in this admin session reading
  // window.PRODUCTS) until the next full page reload. Also fixes a
  // previously-broken call here to a function (refreshSareeList) that
  // didn't exist anywhere in this file -- that threw inside the
  // success handler's try path on every single order, which the
  // surrounding .catch() silently turned into a false "Network error"
  // message even though the order had already been created and the
  // confirmation email already sent.
  function markSoldLocally(items) {
    items.forEach(function (it) {
      var p = (window.PRODUCTS || []).find(function (x) { return x.id === it.id; });
      if (!p) return;
      var hasQty = p.quantity !== null && p.quantity !== undefined && !isNaN(Number(p.quantity));
      if (hasQty) {
        p.quantity = Math.max(0, Number(p.quantity) - it.qty);
        if (p.quantity <= 0 && !p.sold) { p.sold = true; if (!p.soldAt) p.soldAt = new Date().toISOString(); }
      } else if (!p.sold) {
        p.sold = true;
        if (!p.soldAt) p.soldAt = new Date().toISOString();
      }
    });
  }

  function submitManualOrder(payload, email) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating…';

    fetch('/.netlify/functions/admin-create-manual-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) {
          showStatus('error', result.data.error || 'Could not create the order.');
          return;
        }
        var successMsg = 'Order #' + result.data.orderNumber + ' created and confirmation email sent to ' + email + '.';
        if (result.data.giftCardApplied > 0) {
          successMsg += ' AED ' + formatAED(result.data.giftCardApplied) + ' store credit was applied.';
        } else if (result.data.giftCardNote) {
          successMsg += ' Note: ' + result.data.giftCardNote;
        }
        showStatus('success', successMsg);
        markSoldLocally(pickedItems); // the sold saree(s) should drop out of the picker -- captured before pickedItems is cleared below
        pickedItems = [];
        renderPickedItems();
        document.getElementById('admin-mo-first-name').value = '';
        document.getElementById('admin-mo-last-name').value = '';
        document.getElementById('admin-mo-email').value = '';
        phoneCodeSelect.value = '971';
        phoneNumberInput.value = '';
        syncManualOrderPhone();
        discountValueInput.value = '0';
        applyGiftCardCheckbox.checked = false;
        giftCardCard.style.display = 'none';
        knownGiftCardBalance = 0;
        renderTotals();
        renderBrowseGrid();
        if (window.__refreshOrders) window.__refreshOrders();
      })
      .catch(function () {
        showStatus('error', 'Network error. Please try again.');
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Order & Send Confirmation Email';
      });
  }

  // "Clear Fields" -- a manual reset the admin can hit any time (not
  // just after a successful submit), for when they've started filling
  // the form and want to bail out and start over. Mirrors the
  // after-submit reset above, plus the fields that reset doesn't touch
  // (address, payment mode, customer search, discount type).
  document.getElementById('admin-mo-clear-btn').addEventListener('click', function () {
    showStatus('', '');
    customerSearchInput.value = '';
    customerResultsEl.classList.remove('is-open');
    document.getElementById('admin-mo-first-name').value = '';
    document.getElementById('admin-mo-last-name').value = '';
    document.getElementById('admin-mo-email').value = '';
    phoneCodeSelect.value = '971';
    phoneNumberInput.value = '';
    phoneNote.style.display = 'none';
    phoneNumberInput.classList.remove('field-invalid');
    syncManualOrderPhone();

    searchInput.value = '';
    qtyInput.value = '1';
    pickedItems = [];
    renderPickedItems();

    ['admin-mo-billing-building', 'admin-mo-billing-street', 'admin-mo-billing-city', 'admin-mo-billing-state', 'admin-mo-billing-pincode',
     'admin-mo-shipping-building', 'admin-mo-shipping-street', 'admin-mo-shipping-city', 'admin-mo-shipping-state', 'admin-mo-shipping-pincode'
    ].forEach(function (id) { document.getElementById(id).value = ''; });
    billingCountrySelect.selectedIndex = 0;
    shippingCountrySelect.selectedIndex = 0;
    sameAddressBox.checked = true;
    shippingCard.style.display = 'none';

    discountTypeBtns.forEach(function (b) { b.classList.remove('active'); });
    document.querySelector('.admin-mo-discount-type-btn[data-type="percent"]').classList.add('active');
    discountType = 'percent';
    discountValueInput.value = '0';

    applyGiftCardCheckbox.checked = false;
    giftCardCard.style.display = 'none';
    knownGiftCardBalance = 0;

    document.getElementById('admin-mo-payment-mode').selectedIndex = 0;

    renderTotals();
  });
}

// ---------------------------------------------------------------
/* ---------- Customers ---------- */
// Merges two independent identity sources by email: pos_customers
// (created by an in-store sale or a return credited to store credit)
// and orders (every website purchase, which never creates a
// pos_customers row on its own). An online-only customer therefore
// shows up here with customerId === null until their first edit,
// which is when admin-update-customer.js creates their row.
function initCustomersView(token) {
  try {
  var statusMsg = document.getElementById('admin-customers-status-msg');
  var summaryEl = document.getElementById('admin-customers-summary');
  var searchInput = document.getElementById('admin-customers-search');
  var sortSelect = document.getElementById('admin-customers-sort');
  var rowsEl = document.getElementById('admin-customers-rows');
  var drawerOverlay = document.getElementById('admin-customer-drawer-overlay');
  var drawerNameEl = document.getElementById('admin-customer-drawer-name');
  var drawerBody = document.getElementById('admin-customer-drawer-body');
  var drawerMsg = document.getElementById('admin-customer-drawer-msg');
  var drawerCloseBtn = document.getElementById('admin-customer-drawer-close');
  if (!statusMsg || !summaryEl || !searchInput || !sortSelect || !rowsEl || !drawerOverlay || !drawerNameEl || !drawerBody || !drawerMsg || !drawerCloseBtn) {
    alert('Customers tab: a required element is missing from the page (admin.html may be out of date). Missing: ' +
      [!statusMsg && 'status-msg', !summaryEl && 'summary', !searchInput && 'search', !sortSelect && 'sort', !rowsEl && 'rows', !drawerOverlay && 'drawer-overlay', !drawerNameEl && 'drawer-name', !drawerBody && 'drawer-body', !drawerMsg && 'drawer-msg', !drawerCloseBtn && 'drawer-close'].filter(Boolean).join(', '));
    return;
  }
  var allCustomers = [];
  var loaded = false;

  function formatAED(n) {
    return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function loadCustomers() {
    statusMsg.textContent = 'Loading customers\u2026';
    statusMsg.className = 'admin-status-msg';
    fetch('/.netlify/functions/admin-list-customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token })
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var parsed;
          try { parsed = JSON.parse(text); } catch (e) {
            throw new Error('Server did not return JSON (status ' + res.status + '): ' + text.slice(0, 200));
          }
          return { ok: res.ok, status: res.status, data: parsed };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          var msg = (result.data && result.data.error) || ('Could not load customers (status ' + result.status + ').');
          statusMsg.textContent = msg;
          statusMsg.className = 'admin-status-msg admin-status-error';
          alert('Customers tab: server said: ' + msg);
          return;
        }
        statusMsg.textContent = '';
        allCustomers = result.data.customers || [];
        loaded = true;
        renderSummary();
        renderRows();
      })
      .catch(function (e) {
        statusMsg.textContent = 'Error loading customers: ' + e.message;
        statusMsg.className = 'admin-status-msg admin-status-error';
        alert('Customers tab fetch failed: ' + e.message);
        console.error('loadCustomers error:', e);
      });
  }

  function renderSummary() {
    var totalSpend = allCustomers.reduce(function (s, c) { return s + c.totalSpend; }, 0);
    var totalCredit = allCustomers.reduce(function (s, c) { return s + c.giftCardBalance; }, 0);
    summaryEl.innerHTML =
      buildStatCardHtml('Total Customers', allCustomers.length, 'users', 'gold') +
      buildStatCardHtml('Combined Spend (AED)', formatAED(totalSpend), 'wallet', 'green') +
      buildStatCardHtml('Store Credit Outstanding (AED)', formatAED(totalCredit), 'wallet', 'orange');
  }

  function filteredSorted() {
    var q = (searchInput.value || '').trim().toLowerCase();
    var list = allCustomers.filter(function (c) {
      if (!q) return true;
      return (c.name || '').toLowerCase().indexOf(q) !== -1 ||
        (c.email || '').toLowerCase().indexOf(q) !== -1 ||
        (c.phone || '').indexOf(q) !== -1;
    });
    var sortBy = sortSelect.value;
    return list.slice().sort(function (a, b) {
      if (sortBy === 'spend') return b.totalSpend - a.totalSpend;
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
      var ad = a.lastPurchase ? new Date(a.lastPurchase).getTime() : 0;
      var bd = b.lastPurchase ? new Date(b.lastPurchase).getTime() : 0;
      return bd - ad; // most recent first
    });
  }

  function renderRows() {
    if (!loaded) return;
    var list = filteredSorted();
    if (!list.length) {
      rowsEl.innerHTML = '<p style="opacity:0.6; padding:20px 0; text-align:center;">No customers found.</p>';
      return;
    }
    rowsEl.innerHTML = list.map(function (c, idx) {
      var lastDate = c.lastPurchase ? new Date(c.lastPurchase).toLocaleDateString() : 'Never';
      var initials = (c.name || '?').trim().split(/\s+/).map(function (w) { return w[0] || ''; }).slice(0, 2).join('').toUpperCase();
      return '<div class="admin-order-mobile-card" data-idx="' + idx + '">' +
        '<div class="admin-order-mobile-icon">' + (initials || '?') + '</div>' +
        '<div class="admin-order-mobile-info">' +
          '<p class="omn">' + (c.name || 'Unnamed') + '</p>' +
          '<p class="ome">' + (c.email || c.phone || 'No contact on file') + '</p>' +
          '<p class="omd">Last purchase: ' + lastDate + ' &middot; ' + c.totalOrders + ' order' + (c.totalOrders === 1 ? '' : 's') + '</p>' +
        '</div>' +
        '<div class="admin-order-mobile-right">' +
          '<p class="omt">AED ' + formatAED(c.totalSpend) + '</p>' +
          (Math.round((c.giftCardBalance || 0) * 100) > 0 ? '<p class="omp" style="color:#3B6D11; font-weight:600;">AED ' + formatAED(c.giftCardBalance) + ' credit</p>' : '') +
        '</div>' +
      '</div>';
    }).join('');
    rowsEl.querySelectorAll('.admin-order-mobile-card').forEach(function (el) {
      el.addEventListener('click', function () {
        openCustomerDrawer(list[Number(el.getAttribute('data-idx'))]);
      });
    });
  }

  function openCustomerDrawer(c) {
    drawerNameEl.textContent = c.name || 'Unnamed customer';
    drawerMsg.style.display = 'none';
    drawerMsg.textContent = '';

    drawerBody.innerHTML =
      '<div class="admin-metric-grid" style="margin-bottom:16px;">' +
        buildStatCardHtml('Online Spend (AED)', formatAED(c.onlineSpend), 'box', 'gold') +
        buildStatCardHtml('In-Store Spend (AED)', formatAED(c.inStoreSpend), 'box', 'gold') +
      '</div>' +
      '<p style="font-size:0.8rem; opacity:0.7; margin:0 0 16px;">' + c.onlineOrders + ' online order' + (c.onlineOrders === 1 ? '' : 's') + ' &middot; ' + c.inStoreOrders + ' in-store order' + (c.inStoreOrders === 1 ? '' : 's') + '</p>' +
      (Math.round((c.giftCardBalance || 0) * 100) > 0 ? '<p style="background:#EAF3DE; color:#3B6D11; padding:10px 14px; border-radius:8px; font-weight:600; font-size:0.86rem; margin-bottom:16px;">Store credit balance: AED ' + formatAED(c.giftCardBalance) + '</p>' : '') +
      '<h4>Contact Details</h4>' +
      '<div class="admin-field"><label>Name</label><input type="text" id="admin-cust-name" value="' + (c.name || '').replace(/"/g, '&quot;') + '"></div>' +
      '<div class="admin-field"><label>Email</label><input type="text" id="admin-cust-email" value="' + (c.email || '').replace(/"/g, '&quot;') + '"></div>' +
      '<div class="admin-field"><label>Phone</label><input type="text" id="admin-cust-phone" value="' + (c.phone || '').replace(/"/g, '&quot;') + '"></div>' +
      '<button type="button" class="btn btn-primary" id="admin-cust-save-btn" style="width:100%; margin-top:14px;">Save Changes</button>' +
      '<h4 style="margin-top:22px;">Store Credit</h4>' +
      (c.customerId
        ? ('<p style="font-size:0.76rem; opacity:0.7; margin:0 0 10px;">Store credit normally only changes through a return or a checkout redemption. Use this only to correct a balance that’s wrong (e.g. fixing a past error) — every change here is logged with a reason.</p>' +
          '<div class="admin-field"><label>Current balance (AED)</label><input type="text" id="admin-cust-giftcard-balance" value="' + formatAED(c.giftCardBalance || 0) + '"></div>' +
          '<div class="admin-field"><label>Reason for this change</label><input type="text" id="admin-cust-giftcard-reason" placeholder="e.g. correcting an over-credit from order #PV-1234"></div>' +
          '<button type="button" class="btn" id="admin-cust-giftcard-save-btn" style="width:100%; margin-top:14px; color:#B8142A; border-color:#B8142A;">Adjust Store Credit</button>')
        : '<p style="font-size:0.76rem; opacity:0.7; margin:0;">This customer has only ever bought online and has no store-credit record yet — save their contact details above first, then this balance can be adjusted.</p>');

    document.getElementById('admin-cust-save-btn').addEventListener('click', function () {
      var btn = this;
      var name = document.getElementById('admin-cust-name').value.trim();
      var email = document.getElementById('admin-cust-email').value.trim();
      var phone = document.getElementById('admin-cust-phone').value.trim();
      btn.disabled = true;
      btn.textContent = 'Saving\u2026';
      fetch('/.netlify/functions/admin-update-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminToken: token, customerId: c.customerId, name: name, email: email, phone: phone })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          btn.disabled = false;
          btn.textContent = 'Save Changes';
          if (!result.ok) {
            drawerMsg.className = 'admin-status-msg admin-status-error';
            drawerMsg.textContent = result.data.error || 'Could not save changes.';
            drawerMsg.style.display = 'block';
            return;
          }
          drawerMsg.className = 'admin-status-msg admin-status-success';
          drawerMsg.textContent = 'Saved.';
          drawerMsg.style.display = 'block';
          c.customerId = result.data.customerId;
          c.name = name;
          c.email = email;
          c.phone = phone;
          renderRows();
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = 'Save Changes';
          drawerMsg.className = 'admin-status-msg admin-status-error';
          drawerMsg.textContent = 'Network error. Please try again.';
          drawerMsg.style.display = 'block';
        });
    });

    var giftCardSaveBtn = document.getElementById('admin-cust-giftcard-save-btn');
    if (giftCardSaveBtn) {
      giftCardSaveBtn.addEventListener('click', function () {
        var btn = this;
        var newBalance = parseFloat(document.getElementById('admin-cust-giftcard-balance').value);
        var reason = document.getElementById('admin-cust-giftcard-reason').value.trim();
        drawerMsg.style.display = 'none';

        if (!isFinite(newBalance) || newBalance < 0) {
          drawerMsg.className = 'admin-status-msg admin-status-error';
          drawerMsg.textContent = 'Enter a valid balance of 0 or more.';
          drawerMsg.style.display = 'block';
          return;
        }
        if (!reason) {
          drawerMsg.className = 'admin-status-msg admin-status-error';
          drawerMsg.textContent = 'A reason is required for this change.';
          drawerMsg.style.display = 'block';
          return;
        }
        if (!confirm('Set store credit to AED ' + formatAED(newBalance) + ' (currently AED ' + formatAED(c.giftCardBalance || 0) + ')?\n\nThis bypasses the normal return/redemption flow and is logged with the reason you gave.')) {
          return;
        }

        btn.disabled = true;
        btn.textContent = 'Saving…';
        fetch('/.netlify/functions/admin-adjust-gift-card-balance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminToken: token, customerId: c.customerId, newBalance: newBalance, reason: reason })
        })
          .then(function (res) {
            return res.text().then(function (text) {
              var parsed;
              try { parsed = JSON.parse(text); } catch (e) {
                throw new Error('Server did not return JSON (status ' + res.status + '): ' + text.slice(0, 300));
              }
              return { ok: res.ok, status: res.status, data: parsed };
            });
          })
          .then(function (result) {
            btn.disabled = false;
            btn.textContent = 'Adjust Store Credit';
            if (!result.ok) {
              drawerMsg.className = 'admin-status-msg admin-status-error';
              drawerMsg.textContent = result.data.error || ('Could not adjust the balance (status ' + result.status + ').');
              drawerMsg.style.display = 'block';
              return;
            }
            c.giftCardBalance = result.data.newBalance;
            drawerMsg.className = 'admin-status-msg admin-status-success';
            drawerMsg.textContent = 'Store credit updated to AED ' + formatAED(result.data.newBalance) + '.';
            drawerMsg.style.display = 'block';
            document.getElementById('admin-cust-giftcard-reason').value = '';
            renderSummary();
            renderRows();
          })
          .catch(function (e) {
            btn.disabled = false;
            btn.textContent = 'Adjust Store Credit';
            drawerMsg.className = 'admin-status-msg admin-status-error';
            drawerMsg.textContent = 'Network error: ' + e.message;
            drawerMsg.style.display = 'block';
          });
      });
    }

    drawerOverlay.classList.add('is-open');
  }

  drawerCloseBtn.addEventListener('click', function () { drawerOverlay.classList.remove('is-open'); });
  drawerOverlay.addEventListener('click', function (e) {
    if (e.target === drawerOverlay) drawerOverlay.classList.remove('is-open');
  });
  searchInput.addEventListener('input', renderRows);
  sortSelect.addEventListener('change', renderRows);

  loadCustomers();
  } catch (e) {
    alert('Customers tab crashed while setting up: ' + e.message);
    console.error('initCustomersView error:', e);
  }
}

// Saree Tags — select items and generate a printable tag sheet.
// Tags are 2in x 3.5in, folded in half to 2in x 1.75in (mountain
// fold, printed sides outward), 9 per A4 page. See tag design notes: the
// sheet MUST be printed at 100% scale, since scaling changes the
// physical size and can make barcodes unreliable to scan.
// ---------------------------------------------------------------
function initSareeTagsView(token) {
  var searchInput = document.getElementById('admin-tags-search');
  var hideSoldBox = document.getElementById('admin-tags-hide-sold');
  var listEl = document.getElementById('admin-tags-list');
  var countEl = document.getElementById('admin-tags-count');
  var sheetsEl = document.getElementById('admin-tags-sheets');
  var generateBtn = document.getElementById('admin-tags-generate-btn');
  var statusMsg = document.getElementById('admin-tags-status-msg');

  var selectedIds = [];
  var SAREE_TAGS_PER_SHEET = 9;
  var JEWELLERY_STICKERS_PER_SHEET = 55;

  function showStatus(type, msg) {
    statusMsg.className = 'admin-status-msg admin-status-' + type;
    statusMsg.textContent = msg;
  }

  var tagsDeptFilter = 'all';

  function getVisibleProducts() {
    var q = searchInput.value.trim().toLowerCase();
    return (window.PRODUCTS || []).filter(function (p) {
      if (hideSoldBox.checked && p.sold) return false;
      if (tagsDeptFilter === 'saree' && (p.department || 'saree') !== 'saree') return false;
      if (tagsDeptFilter === 'jewellery' && p.department !== 'jewellery' && p.department !== 'accessory') return false;
      if (!q) return true;
      return (p.id || '').toLowerCase().indexOf(q) !== -1 ||
             (p.material || '').toLowerCase().indexOf(q) !== -1 ||
             (p.type || '').toLowerCase().indexOf(q) !== -1 ||
             (p.colour || '').toLowerCase().indexOf(q) !== -1 ||
             (p.category || '').toLowerCase().indexOf(q) !== -1 ||
             (p.series || '').toLowerCase().indexOf(q) !== -1 ||
             (p.design || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  function seriesTitle(s) {
    return (s || '').toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function renderList() {
    var products = getVisibleProducts();
    if (!products.length) {
      listEl.innerHTML = '<p style="padding:20px; font-size:0.85rem; opacity:0.6;">No items match.</p>';
      return;
    }
    listEl.innerHTML = products.map(function (p) {
      var isSel = selectedIds.indexOf(p.id) !== -1;
      return (
        '<div class="admin-tag-row' + (isSel ? ' selected' : '') + '" data-id="' + p.id + '">' +
          '<input type="checkbox"' + (isSel ? ' checked' : '') + '>' +
          (p.image ? '<img src="' + p.image + '" alt="">' : '') +
          '<div>' +
            '<div class="tag-code">' + p.id + '</div>' +
            '<div class="tag-meta">' + tagListSubtitle(p) + '</div>' +
          '</div>' +
          (p.sold ? '<span class="tag-sold">Sold</span>' : '') +
        '</div>'
      );
    }).join('');

    listEl.querySelectorAll('.admin-tag-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-id');
        var idx = selectedIds.indexOf(id);
        if (idx === -1) selectedIds.push(id); else selectedIds.splice(idx, 1);
        renderList();
        updateCount();
      });
    });
  }

  function selectedItemsByDept() {
    var items = selectedIds.map(function (id) {
      return (window.PRODUCTS || []).find(function (p) { return p.id === id; });
    }).filter(Boolean);
    var sarees = items.filter(function (it) { return (it.department || 'saree') === 'saree'; });
    var jewellery = items.filter(function (it) { return it.department === 'jewellery' || it.department === 'accessory'; });
    return { sarees: sarees, jewellery: jewellery };
  }

  function updateCount() {
    countEl.textContent = selectedIds.length + ' selected';
    if (selectedIds.length) {
      var split = selectedItemsByDept();
      var parts = [];
      if (split.sarees.length) {
        var sareeSheets = Math.ceil(split.sarees.length / SAREE_TAGS_PER_SHEET);
        parts.push(sareeSheets + ' saree tag sheet' + (sareeSheets > 1 ? 's' : ''));
      }
      if (split.jewellery.length) {
        var jewellerySheets = Math.ceil(split.jewellery.length / JEWELLERY_STICKERS_PER_SHEET);
        parts.push(jewellerySheets + ' jewellery sticker sheet' + (jewellerySheets > 1 ? 's' : ''));
      }
      sheetsEl.textContent = '\u2192 ' + parts.join(' + ');
    } else {
      sheetsEl.textContent = '';
    }
    generateBtn.disabled = selectedIds.length === 0;
  }

  searchInput.addEventListener('input', renderList);
  hideSoldBox.addEventListener('change', renderList);

  var tagsDeptFilterRow = document.getElementById('admin-tags-dept-filter-row');
  if (tagsDeptFilterRow) {
    tagsDeptFilterRow.querySelectorAll('.admin-dept-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        tagsDeptFilterRow.querySelectorAll('.admin-dept-filter-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        tagsDeptFilter = btn.getAttribute('data-dept');
        renderList();
      });
    });
  }

  document.getElementById('admin-tags-select-all').addEventListener('click', function () {
    getVisibleProducts().forEach(function (p) {
      if (selectedIds.indexOf(p.id) === -1) selectedIds.push(p.id);
    });
    renderList();
    updateCount();
  });

  document.getElementById('admin-tags-clear').addEventListener('click', function () {
    selectedIds = [];
    renderList();
    updateCount();
  });

  generateBtn.addEventListener('click', function () {
    if (!selectedIds.length) return;
    if (typeof qrcode === 'undefined') {
      showStatus('error', 'QR code library did not load — please refresh the page and try again.');
      return;
    }

    var split = selectedItemsByDept();
    var openedAny = false;

    if (split.sarees.length) {
      var sareeWin = window.open('', '_blank');
      if (!sareeWin) {
        showStatus('error', 'Could not open the print window — please allow pop-ups for this site and try again.');
        return;
      }
      sareeWin.document.write(buildTagSheetHtml(split.sarees));
      sareeWin.document.close();
      openedAny = true;
    }

    if (split.jewellery.length) {
      var jewelleryWin = window.open('', '_blank');
      if (!jewelleryWin) {
        showStatus('error', 'Could not open the print window — please allow pop-ups for this site and try again.');
        return;
      }
      jewelleryWin.document.write(buildJewelleryStickerSheetHtml(split.jewellery));
      jewelleryWin.document.close();
      openedAny = true;
    }

    if (!openedAny) return;

    var parts = [];
    if (split.sarees.length) parts.push(split.sarees.length + ' saree tag' + (split.sarees.length > 1 ? 's' : ''));
    if (split.jewellery.length) parts.push(split.jewellery.length + ' jewellery sticker' + (split.jewellery.length > 1 ? 's' : ''));
    showStatus('success', 'Print sheet' + (parts.length > 1 ? 's' : '') + ' opened in a new tab for ' + parts.join(' and ') + '.');
  });

  renderList();
  updateCount();
}

// Builds the standalone printable saree tag sheet. QR codes are
// rendered inside the new window itself (qrcode-generator.min.js is
// loaded there too), since SVG generated in this document can't be
// reliably transplanted. The logo is referenced by URL rather than
// inlined as base64 — the sheet opens from this same site, so the
// path resolves, and it keeps admin.js from carrying an embedded image.
function buildTagSheetHtml(items) {
  var phoneIcon = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
  var igIcon = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>';
  var siteIcon = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Chunk into pages of 9 so each A4 sheet breaks cleanly
  var pages = [];
  for (var i = 0; i < items.length; i += 9) pages.push(items.slice(i, i + 9));

  var pagesHtml = pages.map(function (pageItems, pageIdx) {
    var tags = pageItems.map(function (item, idx) {
      var globalIdx = pageIdx * 9 + idx;
      return (
        '<div class="tag">' +
          '<div class="panel-outer">' +
            '<img src="assets/maroonlogo.png" alt="Pavnika by Saranya">' +
            '<p class="tagline">Elegance that Defines You</p>' +
            '<div class="contact-footer">' +
              '<span class="phone-line">' + phoneIcon + ' +971 52 66 30307</span>' +
              '<span class="contact-divider">|</span>' +
              '<span class="ig-line">' + igIcon + ' pavnika_by_saranya</span>' +
            '</div>' +
            '<div class="contact-footer site-footer">' +
              '<span class="site-line">' + siteIcon + ' www.pavnika.com</span>' +
            '</div>' +
          '</div>' +
          '<div class="fold-line"></div>' +
          '<div class="panel-inner">' +
            '<div class="qr-row">' +
              '<div class="qr-code" id="qr-' + globalIdx + '"></div>' +
              '<div class="qr-text">' +
                '<p class="series-text">' + esc(tagSubtitle(item)) + '</p>' +
                '<p class="code-text">' + esc(item.id) + '</p>' +
              '</div>' +
            '</div>' +
            '<div class="staple-zone"></div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
    return '<div class="sheet">' + tags + '</div>';
  }).join('');

  var qrData = items.map(function (it) { return it.id; });

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pavnika Saree Tags</title>' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:sans-serif;background:#d8d0c5;padding:20px}' +
    '.screen-note{max-width:8.27in;margin:0 auto 20px;background:#fff;border-left:4px solid #B68A69;padding:14px 18px;font-size:13px;line-height:1.6;color:#3B2528}' +
    '.print-btn{margin-top:10px;background:#3C1223;color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer}' +
    '.sheet{width:8.27in;height:11.69in;background:#fff;margin:0 auto 20px;padding:0.4in;display:grid;grid-template-columns:repeat(3,2in);grid-template-rows:repeat(3,3.5in);justify-content:center;align-content:start;box-shadow:0 10px 40px rgba(0,0,0,0.2)}' +
    '.tag{width:2in;height:3.5in;display:flex;flex-direction:column;position:relative;outline:1px dashed #ccc;outline-offset:-1px}' +
    '.fold-line{position:absolute;top:50%;left:0;right:0;border-top:1px dotted #ddd}' +
    '.panel-outer,.panel-inner{height:1.75in;display:flex;flex-direction:column;align-items:center;padding:0.12in 0.15in}' +
    '.panel-outer{justify-content:center}' +
    '.panel-outer img{width:1.5in;height:auto}' +
    '.panel-outer .tagline{font-size:7.5px;color:#B68A69;letter-spacing:0.8px;text-transform:uppercase;margin-top:6px;white-space:nowrap}' +
    '.panel-outer .contact-footer{margin-top:10px}' +
    '.panel-inner{justify-content:flex-start;padding-top:0.16in}' +
    '.qr-row{display:flex;align-items:center;gap:0.12in;width:100%}' +
    '.qr-code{width:0.95in;height:0.95in;flex-shrink:0}' +
    '.qr-code svg{width:100%;height:100%;display:block}' +
    '.qr-text{min-width:0;display:flex;flex-direction:column;justify-content:center}' +
    '.qr-text .series-text{font-size:8.5px;color:#8a7266;font-weight:600;line-height:1.3;margin-bottom:4px;word-break:break-word}' +
    '.qr-text .code-text{font-family:"Courier New",monospace;font-size:13px;font-weight:bold;color:#2B0D1A;letter-spacing:0.5px;word-break:break-word}' +
    '.staple-zone{flex:1;width:100%}' +
    '.contact-footer{font-size:5.6px;color:#B68A69;display:flex;align-items:center;gap:3px;flex-wrap:nowrap;white-space:nowrap;justify-content:center}' +
    '.contact-footer.site-footer{margin-top:3px}' +
    '.contact-divider{opacity:0.5}' +
    '.ig-line,.phone-line,.site-line{display:inline-flex;align-items:center;gap:3px}' +
    '@media print{@page{size:A4;margin:0}body{background:#fff;padding:0}.screen-note{display:none}.sheet{box-shadow:none;margin:0;page-break-after:always}.sheet:last-child{page-break-after:auto}}' +
    '</style></head><body>' +
    '<div class="screen-note"><b>Print instructions for the shop:</b><br>' +
    'Paper: 250&ndash;300 GSM white cardstock &middot; A4 &middot; <b>Laser print</b> (not inkjet) &middot; Optional matte lamination<br>' +
    'Print at <b>100% scale / "Actual size"</b> &mdash; do <b>not</b> use "Fit to page", or the tags will come out the wrong size and the QR codes may not scan reliably.<br>' +
    'Cut along the light dashed lines, then fold each tag in half along the dotted centre line (printed sides face outward). The blank area below the QR code is left clear for stapling the tag to the item.<br>' +
    '<button class="print-btn" onclick="window.print()">Print / Save as PDF</button></div>' +
    pagesHtml +
    '<script src="qrcode-generator.min.js"><\/script>' +
    '<script>var CODES=' + JSON.stringify(qrData) + ';' +
    'CODES.forEach(function(code,i){try{var qr=qrcode(0,"M");qr.addData(code);qr.make();document.getElementById("qr-"+i).innerHTML=qr.createSvgTag(0);}catch(e){' +
    'var el=document.getElementById("qr-"+i);if(el)el.outerHTML=\'<div style="font-size:10px;color:#B8142A;">QR failed: \'+code+\'</div>\';}});<\/script>' +
    '</body></html>';
}

// Builds the standalone printable jewellery sticker sheet — small
// individual stickers (logo + QR + ID) meant to be cut or peeled and
// stuck onto a separately-bought blank jewellery tag, not the fold-
// over saree tag format. Grid cut lines are shared between neighbouring
// stickers (no gaps), which is what gets 55 onto one A4 sheet instead
// of fewer with individually-outlined boxes. Sticker size (~36mm x
// 24mm) is a starting point pending the shop's actual blank tags —
// adjusting it later is a one-line change to STICKER_W_IN/STICKER_H_IN.
function buildJewelleryStickerSheetHtml(items) {
  var STICKERS_PER_ROW = 5;
  var STICKERS_PER_SHEET = 55;

  var pages = [];
  for (var i = 0; i < items.length; i += STICKERS_PER_SHEET) pages.push(items.slice(i, i + STICKERS_PER_SHEET));

  var pagesHtml = pages.map(function (pageItems, pageIdx) {
    var stickers = pageItems.map(function (item, idx) {
      var globalIdx = pageIdx * STICKERS_PER_SHEET + idx;
      return (
        '<div class="sticker">' +
          '<div class="top-row">' +
            '<img class="sticker-logo" src="assets/logo.png" alt="">' +
            '<div class="qr-code" id="jqr-' + globalIdx + '"></div>' +
          '</div>' +
          '<div class="sticker-id">' + item.id + '</div>' +
        '</div>'
      );
    }).join('');
    return '<div class="sheet"><div class="grid">' + stickers + '</div></div>';
  }).join('');

  var qrData = items.map(function (it) { return it.id; });

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pavnika Jewellery QR Stickers</title>' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:sans-serif;background:#d8d0c5;padding:20px}' +
    '.screen-note{max-width:8.27in;margin:0 auto 20px;background:#fff;border-left:4px solid #B68A69;padding:14px 18px;font-size:13px;line-height:1.6;color:#3B2528}' +
    '.print-btn{margin-top:10px;background:#3C1223;color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer}' +
    '.sheet{width:8.27in;height:11.69in;background:#fff;margin:0 auto 20px;padding:0.35in;box-shadow:0 10px 40px rgba(0,0,0,0.2)}' +
    '.grid{display:grid;grid-template-columns:repeat(' + STICKERS_PER_ROW + ',1fr);border-left:1px dashed #999;border-top:1px dashed #999}' +
    '.sticker{height:0.94in;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.02in;padding:0.06in;overflow:hidden;border-right:1px dashed #999;border-bottom:1px dashed #999}' +
    '.top-row{display:flex;align-items:center;justify-content:center;gap:0.08in}' +
    '.sticker-logo{width:0.48in;height:0.48in;flex-shrink:0;object-fit:contain}' +
    '.qr-code{width:0.63in;height:0.63in;flex-shrink:0}' +
    '.qr-code svg{width:100%;height:100%;display:block}' +
    '.sticker-id{font-family:"Courier New",monospace;font-size:11px;font-weight:bold;color:#2B0D1A;letter-spacing:0.3px;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}' +
    '@media print{@page{size:A4;margin:0}body{background:#fff;padding:0}.screen-note{display:none}.sheet{box-shadow:none;margin:0;page-break-after:always}.sheet:last-child{page-break-after:auto}}' +
    '</style></head><body>' +
    '<div class="screen-note"><b>Print instructions for the shop:</b><br>' +
    'Sticker size: ~36mm &times; 24mm &middot; 5 across &times; 11 down &middot; 55 per A4 sheet<br>' +
    'Paper: standard A4 self-adhesive sticker sheet &middot; <b>Laser print</b> preferred &middot; Print at <b>100% scale / "Actual size"</b> &mdash; not "Fit to page", or the stickers will come out the wrong size.<br>' +
    'Cut along every line in the grid, both directions, to separate each sticker, then peel and stick onto your blank jewellery tags.<br>' +
    '<button class="print-btn" onclick="window.print()">Print / Save as PDF</button></div>' +
    pagesHtml +
    '<script src="qrcode-generator.min.js"><\/script>' +
    '<script>var CODES=' + JSON.stringify(qrData) + ';' +
    'CODES.forEach(function(code,i){try{var qr=qrcode(0,"M");qr.addData(code);qr.make();document.getElementById("jqr-"+i).innerHTML=qr.createSvgTag(0);}catch(e){' +
    'var el=document.getElementById("jqr-"+i);if(el)el.outerHTML=\'<div style="font-size:8px;color:#B8142A;">QR failed<\/div>\';}});<\/script>' +
    '</body></html>';
}
