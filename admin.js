var ADMIN_TOKEN_KEY = 'pavnika_admin_token';

// The price a customer actually pays for this saree right now — a
// valid sale price if one is set, otherwise the regular price. Used
// anywhere a saree's price is shown or auto-filled in admin, so a
// discounted saree doesn't get quietly priced at its old amount in the
// manual order picker or anywhere else.
function effectivePrice(p) {
  var hasValidSale = p && p.salePrice && Number(p.salePrice) > 0 && Number(p.salePrice) < Number(p.price);
  return hasValidSale ? Number(p.salePrice) : Number(p && p.price || 0);
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
    var price = Number(it.price || 0).toFixed(2);
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
  initSareeTagsView(token);
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
  var hideSold = false;

  // The form now slides in as a drawer (overlay + panel), matching the
  // Orders drawer, instead of sitting permanently in a side column —
  // this lets the saree grid use the page's full width. These two
  // helpers replace the old formCard.style.display toggling.
  function showSareeDrawer() {
    formCard.style.display = 'block';
    sareeDrawerOverlay.classList.add('is-open');
  }
  function hideSareeDrawer() {
    sareeDrawerOverlay.classList.remove('is-open');
  }
  document.getElementById('admin-saree-drawer-close').addEventListener('click', hideSareeDrawer);
  sareeDrawerOverlay.addEventListener('click', function (e) {
    if (e.target === sareeDrawerOverlay) hideSareeDrawer();
  });

  function seriesTitle(code) {
    return code.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // A sale price only counts as a real offer if it's a positive number
  // genuinely below the regular price — otherwise it's silently
  // dropped, so a stray value can't accidentally show a "discount"
  // that's zero, negative, or actually higher than the normal price.
  function parseSalePriceInput() {
    var regular = parseInt(document.getElementById('admin-f-price').value, 10) || 0;
    var raw = document.getElementById('admin-f-sale-price').value;
    if (raw === '') return null;
    var sale = parseInt(raw, 10);
    if (!sale || sale <= 0 || sale >= regular) return null;
    return sale;
  }

  function updateSalePreview() {
    var previewEl = document.getElementById('admin-sale-preview');
    var regular = parseInt(document.getElementById('admin-f-price').value, 10) || 0;
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
  document.getElementById('admin-f-sale-price').addEventListener('input', updateSalePreview);

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

  var bulkSelectedIds = [];

  function priceHtml(p) {
    if (p.salePrice) {
      var pct = Math.round((1 - p.salePrice / p.price) * 100);
      return '<div class="admin-price-row">' +
        '<span class="admin-price-was">AED ' + Number(p.price).toFixed(2) + '</span>' +
        '<span class="admin-price-now">AED ' + Number(p.salePrice).toFixed(2) + '</span>' +
        '<span class="admin-price-pct">' + pct + '% off</span>' +
      '</div>';
    }
    return '<div style="color:var(--gold); font-weight:700; margin-bottom:4px;">AED ' + Number(p.price || 0).toFixed(2) + '</div>';
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
            '<div class="admin-saree-card-series">' + p.design + ' — ' + seriesTitle(p.series) + '</div>' +
            priceHtml(p) +
            (p.sold ? '<span class="admin-sold-badge">Sold out</span>' : '<span class="admin-avail-badge">Available</span>') +
            '<div class="admin-saree-card-actions">' +
              '<span class="admin-edit-link" data-id="' + p.id + '">Edit</span>' +
              '<span class="admin-delete-link" data-id="' + p.id + '">Delete</span>' +
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
    formTitle.textContent = 'Add New Saree';
    form.reset();
    document.getElementById('admin-sale-preview').style.display = 'none';
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
    formTitle.textContent = 'Edit Saree — ' + id;
    seriesSelect.value = product.series;
    seriesSelect.disabled = true; // locked while editing — changing series after creation could orphan the existing ID scheme
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
    refreshMaterialOptions(product.material || '');
    document.getElementById('admin-f-shade').value = product.shade || 'Others';
    document.getElementById('admin-f-price').value = product.price || '';
    document.getElementById('admin-f-sale-price').value = product.salePrice || '';
    updateSalePreview();
    document.getElementById('admin-f-sold').checked = !!product.sold;
    var savedOccasions = product.occasions || [];
    document.querySelectorAll('#admin-f-occasions input').forEach(function (cb) {
      cb.checked = savedOccasions.indexOf(cb.value) !== -1;
    });
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
  var CSV_COLUMNS = ['Unique ID', 'Series', 'Category', 'Type', 'Saree Type', 'Pattern', 'Design', 'Cost AED', 'Sale Price AED', 'Sold',
    'Image_1', 'Image_2', 'Image_3', 'Image_4', 'Image_5', 'Image_6', 'Image_7', 'Video', 'Material', 'Shade', 'Occasions'];

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
        p.salePrice || '',
        p.sold ? 'TRUE' : 'FALSE',
        images[0] || '', images[1] || '', images[2] || '', images[3] || '', images[4] || '', images[5] || '', images[6] || '',
        '', p.material || '', p.shade || 'Others',
        (p.occasions || []).join('|')
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
    return {
      id: (row['Unique ID'] || '').trim().toUpperCase(),
      series: row['Series'] || '',
      category: row['Category'] || '',
      type: row['Type'] || '',
      sareeType: row['Saree Type'] || '',
      pattern: row['Pattern'] || '',
      design: row['Design'] || '',
      material: row['Material'] || '',
      shade: row['Shade'] || 'Others',
      price: price,
      salePrice: salePrice,
      sold: soldRaw === 'true' || soldRaw === '1' || soldRaw === 'yes',
      occasions: occ.valid,
      _unknownOccasions: occ.unknown,
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
        var fields = ['series', 'category', 'type', 'sareeType', 'pattern', 'design', 'price', 'sold', 'salePrice'];
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
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var saveBtn = document.getElementById('admin-save-btn');
    var images = currentImages.slice();

    if (materialSelect.value === ADD_NEW_MATERIAL_VALUE && !materialNewInput.value.trim()) {
      showStatus('error', 'Please type the new material, or pick an existing one instead.');
      return;
    }

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

    var materialValue = materialSelect.value === ADD_NEW_MATERIAL_VALUE
      ? materialNewInput.value.trim()
      : materialSelect.value;

    var productData = {
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
      occasions: Array.from(document.querySelectorAll('#admin-f-occasions input:checked')).map(function (cb) { return cb.value; }),
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

  // Shared "show 5, then Show More" pattern — used for Most Viewed,
  // Recent Orders, and Recent Logins, so all three behave identically
  // instead of each having its own limit/scroll logic.
  function renderExpandable(container, items, rowBuilder, emptyMessage) {
    if (!items.length) {
      container.innerHTML = '<p style="font-size:0.82rem; opacity:0.6;">' + emptyMessage + '</p>';
      return;
    }
    var collapsedCount = 5;
    var expanded = false;
    function draw() {
      var visible = expanded ? items : items.slice(0, collapsedCount);
      var rowsHtml = visible.map(rowBuilder).join('');
      var toggleHtml = items.length > collapsedCount
        ? '<p class="admin-view-all-link" style="margin-top:8px; text-align:center;" id="' + container.id + '-toggle">' +
            (expanded ? 'Show less' : 'Show ' + (items.length - collapsedCount) + ' more') +
          '</p>'
        : '';
      container.innerHTML = rowsHtml + toggleHtml;
      var toggleEl = document.getElementById(container.id + '-toggle');
      if (toggleEl) {
        toggleEl.addEventListener('click', function () {
          expanded = !expanded;
          draw();
        });
      }
    }
    draw();
  }

  function renderStats(data, orderStats) {
    latestStats = data;
    var inStock = (window.PRODUCTS || []).filter(function (p) { return !p.sold; }).length;
    var soldOut = (window.PRODUCTS || []).filter(function (p) { return p.sold; }).length;

    if (data.filtered) {
      showStatus('success', 'Showing results for the selected date range.');
    } else {
      statusMsg.style.display = 'none';
    }

    function deltaHtml(pct) {
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

    var orderCard = orderStats
      ? buildStatCardHtml('Orders', orderStats.orderCount, 'box', 'gold', deltaHtml(orderStats.orderCountDelta))
      : '';
    var revenueCard = orderStats
      ? buildStatCardHtml('Revenue (AED)', orderStats.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 }), 'wallet', 'gold', deltaHtml(orderStats.revenueDelta))
      : '';

    metricGrid.innerHTML =
      buildStatCardHtml('In stock', inStock, 'hanger', 'green', stockDelta) +
      buildStatCardHtml('Sold out', soldOut, 'hangerX', 'red', soldDelta) +
      orderCard + revenueCard +
      buildStatCardHtml('Verified visitors', data.totalVisitors, 'users', 'gold') +
      buildStatCardHtml('Saree views logged', data.totalViews, 'eye', 'gold');

    if (orderStats) {
      renderRevenueChart(orderStats.dailyPoints);
      renderRecentOrders(orderStats.recentOrders);
    }

    function findProductImage(id) {
      var p = (window.PRODUCTS || []).find(function (x) { return x.id === id; });
      return p ? p.image : '';
    }
    renderExpandable(
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
      'No views logged yet.'
    );

    var totalRegionCount = data.regions.reduce(function (sum, r) { return sum + r.count; }, 0);
    var pieColors = ['var(--green)', 'var(--gold)', 'var(--stone)', '#946B4A', '#8a6f63', '#c9b8a8'];
    if (data.regions.length && totalRegionCount > 0) {
      var cumulative = 0;
      var gradientStops = data.regions.map(function (r, i) {
        var start = (cumulative / totalRegionCount) * 100;
        cumulative += r.count;
        var end = (cumulative / totalRegionCount) * 100;
        var color = pieColors[i % pieColors.length];
        return color + ' ' + start + '% ' + end + '%';
      }).join(', ');
      var legend = data.regions.map(function (r, i) {
        var color = pieColors[i % pieColors.length];
        return '<div style="display:flex; align-items:center; gap:6px; font-size:0.78rem; padding:3px 0;">' +
          '<span style="width:9px; height:9px; border-radius:50%; background:' + color + '; flex-shrink:0;"></span>' +
          '<span style="flex:1;">' + r.country + '</span><span style="font-weight:600; color:var(--green-deep);">' + r.count + '</span>' +
        '</div>';
      }).join('');
      regionsRows.innerHTML =
        '<div style="width:110px; height:110px; border-radius:50%; background:conic-gradient(' + gradientStops + '); margin:0 auto 14px;"></div>' +
        legend;
    } else {
      regionsRows.innerHTML = '<p style="font-size:0.82rem; opacity:0.6;">No data yet.</p>';
    }

    renderLoginsList();
  }

  function renderLoginsList() {
    if (!latestStats) return;
    var showFull = document.getElementById('admin-show-emails-toggle').checked;
    renderExpandable(
      loginsRows,
      latestStats.recentLogins,
      function (v) {
        var emailDisplay = showFull ? (v.email || '') : maskEmail(v.email);
        var location = v.country ? (v.region ? v.region + ', ' + v.country : v.country) : 'Unknown';
        return '<div class="admin-rank-row"><span>' + emailDisplay + '<br><span style="font-size:0.7rem; opacity:0.6;">' + location + '</span></span><span style="color:var(--ink); opacity:0.6; font-weight:400;">' + timeAgo(v.verified_at) + '</span></div>';
      },
      'No logins yet.'
    );
  }

  document.getElementById('admin-show-emails-toggle').addEventListener('change', renderLoginsList);

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

  function dayKey(iso) {
    var d = new Date(iso);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function computeOrderStats(allOrders, fromDate, toDate) {
    var now = new Date();
    var rangeEnd = toDate ? new Date(toDate + 'T23:59:59') : now;
    var rangeStart = fromDate ? new Date(fromDate + 'T00:00:00') : new Date(rangeEnd.getTime() - 6 * 86400000); // default: last 7 days
    var rangeLengthMs = rangeEnd.getTime() - rangeStart.getTime();
    var prevEnd = new Date(rangeStart.getTime() - 1);
    var prevStart = new Date(prevEnd.getTime() - rangeLengthMs);

    var revenueOrders = allOrders.filter(function (o) { return REVENUE_STATUSES.indexOf(o.status) !== -1; });

    function withinRange(o, start, end) {
      var t = new Date(o.created_at).getTime();
      return t >= start.getTime() && t <= end.getTime();
    }

    var current = revenueOrders.filter(function (o) { return withinRange(o, rangeStart, rangeEnd); });
    var previous = revenueOrders.filter(function (o) { return withinRange(o, prevStart, prevEnd); });

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
    var dailyPoints = [];
    var cursor = new Date(rangeStart);
    while (cursor <= rangeEnd) {
      var key = dayKey(cursor.toISOString());
      dailyPoints.push({ date: cursor.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), revenue: dailyMap[key] || 0 });
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
      orderCountDelta: pctChange(current.length, previous.length),
      revenueDelta: pctChange(currentRevenue, previousRevenue),
      newlySoldCount: newlySoldCount,
      isDefaultWeek: !fromDate && !toDate,
      dailyPoints: dailyPoints,
      recentOrders: allOrders.slice(0, 20) // "recent" is always just the newest, independent of the date filter — renderExpandable shows 5 at a time
    };
  }

  function renderRevenueChart(points) {
    var chartEl = document.getElementById('admin-revenue-chart');
    if (!chartEl) return;
    if (!points.length || points.every(function (p) { return p.revenue === 0; })) {
      chartEl.innerHTML = '<p style="font-size:0.82rem; opacity:0.6;">No revenue in this range yet.</p>';
      return;
    }
    var max = Math.max.apply(null, points.map(function (p) { return p.revenue; })) || 1;
    var w = 100, h = 40;
    var stepX = points.length > 1 ? w / (points.length - 1) : 0;
    var coords = points.map(function (p, i) {
      var x = points.length > 1 ? i * stepX : w / 2;
      var y = h - (p.revenue / max) * (h - 4) - 2;
      return x + ',' + y;
    });
    var svg =
      '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="width:100%; height:90px;">' +
        '<polyline points="' + coords.join(' ') + '" fill="none" stroke="#B68A69" stroke-width="1.4" vector-effect="non-scaling-stroke"/>' +
      '</svg>';
    var labels =
      '<div style="display:flex; justify-content:space-between; font-size:0.62rem; color:#8a7266; margin-top:4px;">' +
        '<span>' + points[0].date + '</span><span>' + points[points.length - 1].date + '</span>' +
      '</div>';
    chartEl.innerHTML = svg + labels;
  }

  function recentOrderStatusLabel(s) {
    if (s === 'delivered_direct_pay') return 'Delivered (Direct Pay)';
    if (s === 'partially_refunded') return 'Partially Refunded';
    return (s || 'pending').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function renderRecentOrders(orders) {
    var el = document.getElementById('admin-recent-orders-rows');
    if (!el) return;
    renderExpandable(
      el,
      orders,
      function (o) {
        var dateLabel = o.created_at ? new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
        return '<div class="admin-rank-row admin-recent-order-row">' +
          '<span>#' + (o.order_number || o.id) + ' — ' + (o.customer_name || 'Customer') +
            '<br><span style="font-size:0.7rem; opacity:0.6;">' + recentOrderStatusLabel(o.status) + ' &middot; ' + dateLabel + '</span>' +
          '</span>' +
          '<span class="rank-value">AED ' + Number(o.total || 0).toFixed(2) + '</span>' +
        '</div>';
      },
      'No orders yet.'
    );
  }


  function loadStats() {
    metricGrid.innerHTML = '<p style="font-size:0.85rem; opacity:0.6;">Loading stats...</p>';
    var fromDate = statsPresetFromISO || document.getElementById('admin-stats-from').value || null;
    var toDate = statsPresetFromISO ? null : (document.getElementById('admin-stats-till').value || null);

    Promise.all([
      fetch('/.netlify/functions/admin-get-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminToken: token, fromDate: fromDate, toDate: toDate })
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
        var orderStats = ordersResult.ok ? computeOrderStats(ordersResult.data.orders || [], fromDate, toDate) : null;
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
    statsPresetFromISO = null;
    document.querySelectorAll('[data-stats-preset]').forEach(function (b) { b.classList.remove('active'); });
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
        statsPresetFromISO = null;
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
        '<td><input type="checkbox" data-toggle-admin="' + u.id + '"' + (u.is_admin ? ' checked' : '') + '></td>' +
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
  var activeChannel = 'online';
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
    if (s === 'delivered_direct_pay') return 'Delivered (Direct Pay)';
    if (s === 'refunded_giftcard') return 'Refunded (To Gift Card)';
    if (s === 'cod_pending') return 'Cash on Delivery (Pending)';
    if (s === 'partially_refunded') return 'Partially Refunded';
    return (s || 'pending').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function renderSummary() {
    var pendingDispatch = allOrders.filter(function (o) { return o.status === 'paid'; });

    // Overall
    var allOrdersCount = allOrders.length + allShopOrders.length;
    var onlineRevenue = allOrders.filter(function (o) { return ['pending', 'cod_pending', 'cancelled', 'payment_error', 'refunded'].indexOf(o.status) === -1; })
      .reduce(function (sum, o) { return sum + netOrderRevenue(o); }, 0);
    var shopRevenue = allShopOrders.filter(function (o) { return o.status !== 'Returned'; })
      .reduce(function (sum, o) { return sum + (Number(o.total) || 0); }, 0);
    document.getElementById('admin-orders-summary-overall').innerHTML =
      buildStatCardHtml('All Orders', allOrdersCount, 'box', 'gold') +
      buildStatCardHtml('Total Revenue (AED)', Math.round(onlineRevenue + shopRevenue).toLocaleString(), 'wallet', 'red');

    // Online
    var processing = allOrders.filter(function (o) { return o.status === 'paid' || o.status === 'shipped'; }).length;
    var completed = allOrders.filter(function (o) { return o.status === 'delivered' || o.status === 'delivered_direct_pay'; }).length;
    var cancelled = allOrders.filter(function (o) { return ['cancelled', 'refunded', 'refunded_giftcard', 'payment_error'].indexOf(o.status) !== -1; }).length;
    document.getElementById('admin-orders-summary-online').innerHTML =
      buildStatCardHtml('Orders', allOrders.length, 'box', 'gold') +
      buildStatCardHtml('Processing', processing, 'clock', 'orange') +
      buildStatCardHtml('Completed', completed, 'check', 'green') +
      buildStatCardHtml('Cancelled', cancelled, 'cross', 'red') +
      buildStatCardHtml('Revenue (AED)', Math.round(onlineRevenue).toLocaleString(), 'wallet', 'orange');

    // Shop
    var shopReturned = allShopOrders.filter(function (o) { return o.status !== 'Completed'; }).length;
    document.getElementById('admin-orders-summary-shop').innerHTML =
      buildStatCardHtml('Orders', allShopOrders.length, 'box', 'gold') +
      buildStatCardHtml('Returned / Exchanged', shopReturned, 'cross', 'red') +
      buildStatCardHtml('Revenue (AED)', Math.round(shopRevenue).toLocaleString(), 'wallet', 'green');

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
    rowsEl.innerHTML = filtered.length ? filtered.map(function (o) {
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
    mobileListEl.innerHTML = filtered.length ? filtered.map(function (o) {
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
            '<p class="omt">AED ' + Number(o.total || 0).toFixed(2) + '</p>' +
            '<p class="omp">' + (o.payment_method || '—') + '</p>' +
            '<span class="admin-order-mobile-badge status-' + (o.status || 'pending') + '">' + statusLabel(o.status) + '</span>' +
          '</div>' +
          '<span class="admin-order-mobile-chevron">&rsaquo;</span>' +
        '</div>'
      );
    }).join('') : '<p style="font-size:0.85rem; opacity:0.6; padding:16px;">No orders match.</p>';
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
      '<p style="margin:0 0 12px; opacity:0.75;">Total: AED ' + Number(order.total || 0).toFixed(2) + '</p>';

    if (order.gift_card_credit > 0) {
      html +=
        '<div style="background:#FBEAEA; border-radius:8px; padding:12px; margin-bottom:8px;">' +
          '<p style="margin:0 0 6px; font-weight:700; color:#B8142A;">This sale has an exchange/return on record</p>' +
          '<p style="margin:0 0 6px;">It credited AED ' + Number(order.gift_card_credit).toFixed(2) + ' to this customer\u2019s gift card. Deleting this sale will also delete that return record (cascading automatically).</p>' +
          '<p style="margin:0; font-weight:700;">Important: the customer\u2019s actual gift card balance will NOT be reversed. They keep the credit \u2014 only the record explaining where it came from will be gone.</p>' +
        '</div>';
    } else {
      html += '<p style="margin:0; opacity:0.75; font-size:0.8rem;">No associated return/exchange record on this sale.</p>';
    }

    html += '<p style="margin:12px 0 0; font-weight:700;">This cannot be undone.</p>';

    document.getElementById('admin-delete-sale-details').innerHTML = html;
    document.getElementById('admin-delete-sale-overlay').classList.add('is-open');
    pendingDeleteSale = order;
  }

  document.getElementById('admin-delete-sale-cancel-btn').addEventListener('click', function () {
    document.getElementById('admin-delete-sale-overlay').classList.remove('is-open');
    pendingDeleteSale = null;
  });
  document.getElementById('admin-delete-sale-confirm-btn').addEventListener('click', function () {
    if (!pendingDeleteSale) return;
    var btn = document.getElementById('admin-delete-sale-confirm-btn');
    btn.disabled = true;
    btn.textContent = 'Deleting...';

    fetch('/.netlify/functions/admin-delete-pos-sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: token, saleId: pendingDeleteSale.id })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        btn.disabled = false;
        btn.textContent = 'Delete Permanently';
        if (!result.ok) { showStatus('error', result.data.error || 'Could not delete this sale.'); return; }

        allShopOrders = allShopOrders.filter(function (o) { return o.id !== pendingDeleteSale.id; });
        renderSummary();
        renderShopTable();
        document.getElementById('admin-delete-sale-overlay').classList.remove('is-open');
        drawerOverlay.classList.remove('is-open');
        pendingDeleteSale = null;
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = 'Delete Permanently';
        showStatus('error', 'Network error deleting this sale.');
      });
  });

  function renderShopTable() {
    var filtered = getFilteredSortedShop();
    var shopRowsEl = document.getElementById('admin-shop-orders-rows');
    shopRowsEl.innerHTML = filtered.length ? filtered.map(function (o) {
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
    mobileListEl.innerHTML = filtered.length ? filtered.map(function (o) {
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
            '<p class="omt">AED ' + Number(o.total || 0).toFixed(2) + '</p>' +
            '<span class="admin-order-mobile-badge" style="' + shopStatusBadgeColor(o.status) + '">' + o.status + '</span>' +
          '</div>' +
          '<span class="admin-order-mobile-chevron">&rsaquo;</span>' +
        '</div>'
      );
    }).join('') : '<p style="font-size:0.85rem; opacity:0.6; padding:16px;">No shop orders match.</p>';
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

  function buildStatusSelect(o) {
    var statuses = ['pending', 'paid', 'shipped', 'delivered', 'delivered_direct_pay', 'cod_pending', 'payment_error', 'cancelled', 'refunded', 'refunded_giftcard', 'partially_refunded'];
    var options = statuses.map(function (s) {
      return '<option value="' + s + '"' + (o.status === s ? ' selected' : '') + '>' + statusLabel(s) + '</option>';
    }).join('');
    return '<select class="admin-order-status-select" data-id="' + o.id + '">' + options + '</select>';
  }

  rowsEl.addEventListener('change', function (e) {
    var statusSelectEl = e.target.closest('.admin-order-status-select');
    if (statusSelectEl) {
      var orderId = statusSelectEl.getAttribute('data-id');
      var newStatus = statusSelectEl.value;

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
      return '<label style="display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid #EADFD6; font-size:0.82rem; cursor:pointer;">' +
        '<input type="checkbox" class="admin-return-item-checkbox" data-item-id="' + it.id + '" data-item-price="' + (Number(it.price) || 0) + '">' +
        '<span style="flex:1;">' + (it.id || '') + ' \u2014 ' + (it.name || it.id || 'Item') + '</span>' +
        '<span style="font-weight:600;">AED ' + Number(it.price || 0).toFixed(2) + '</span>' +
      '</label>';
    }).join('');

    var historyHtml = '';
    if ((order.returns || []).length) {
      historyHtml = '<p style="font-size:0.72rem; opacity:0.6; margin:12px 0 4px;">Return history</p>' +
        order.returns.map(function (r) {
          var names = (r.items_returned || []).map(function (it) { return it.id || it.name; }).join(', ');
          return '<div style="font-size:0.72rem; opacity:0.75; padding:4px 0;">' +
            new Date(r.created_at).toLocaleDateString() + ' \u2014 ' + names + ' \u2014 AED ' + Number(r.refund_amount || 0).toFixed(2) +
            ' via ' + (RETURN_METHOD_LABEL[r.refund_method] || r.refund_method) +
            (r.processed_by ? ' (' + r.processed_by + ')' : '') +
          '</div>';
        }).join('');
    }

    if (!returnableItems.length) {
      return '<h4 style="margin-top:20px;">Process Return</h4>' +
        '<p style="font-size:0.82rem; opacity:0.6;">Every item on this order has already been returned.</p>' + historyHtml;
    }

    return '<h4 style="margin-top:20px;">Process Return</h4>' +
      '<div id="admin-return-items">' + itemsHtml + '</div>' +
      '<div style="margin-top:10px;">' +
        '<label style="font-size:0.76rem; opacity:0.7; display:block; margin-bottom:4px;">Refund via</label>' +
        '<select id="admin-return-method" style="width:100%;">' +
          '<option value="cash">Cash</option>' +
          '<option value="bank_transfer">Bank transfer</option>' +
          '<option value="gift_card">Store credit (Gift Card)</option>' +
        '</select>' +
      '</div>' +
      '<p id="admin-return-estimate" style="font-size:0.82rem; font-weight:600; margin:10px 0 0;">Select at least one item</p>' +
      '<button type="button" class="btn btn-primary" id="admin-return-submit-btn" style="width:100%; margin-top:10px;" disabled>Process Return</button>' +
      '<p id="admin-return-msg" class="admin-status-msg" style="display:none; margin-top:8px;"></p>' +
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
    estimateEl.textContent = 'Estimated refund: AED ' + estimate.toFixed(2) + (ratio !== 1 ? ' (after order discount)' : '');
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
        '<span style="font-weight:600;">AED ' + Number(it.price || 0).toFixed(2) + '</span>' +
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
      '<div class="admin-order-drawer-totals-row"><span>Subtotal</span><span>AED ' + subtotal.toFixed(2) + '</span></div>' +
      (discount > 0 ? '<div class="admin-order-drawer-totals-row"><span>Discount' + (order.promo_code ? ' (' + order.promo_code + ')' : '') + '</span><span>-AED ' + discount.toFixed(2) + '</span></div>' : '') +
      '<div class="admin-order-drawer-totals-row total"><span>Total</span><span>AED ' + Number(order.total || 0).toFixed(2) + '</span></div>' +

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
        '<h4>Danger Zone</h4>' +
        '<button type="button" class="btn btn-ghost" id="admin-shop-delete-btn" style="width:100%; color:#B8142A; border-color:#B8142A;">Delete This Sale</button>';
    } else {
      html +=
        '<h4>Billing Address</h4>' + addressBlock(order.billing_address) +
        '<h4>Shipping Address' + (order.billing_address === order.shipping_address ? ' (same as billing)' : '') + '</h4>' + addressBlock(order.shipping_address) +
        '<h4>Update Status</h4>' +
        buildStatusSelect(order);

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

    var returnSubmitBtn = document.getElementById('admin-return-submit-btn');
    if (returnSubmitBtn) {
      returnSubmitBtn.addEventListener('click', function () {
        var checked = Array.prototype.slice.call(drawerBody.querySelectorAll('.admin-return-item-checkbox:checked'));
        if (!checked.length) return;
        var itemIds = checked.map(function (cb) { return cb.getAttribute('data-item-id'); });
        var method = document.getElementById('admin-return-method').value;
        var returnMsgEl = document.getElementById('admin-return-msg');

        if (!confirm('Process a return for ' + itemIds.length + ' item(s) via ' + RETURN_METHOD_LABEL[method] + '? This cannot be undone here.')) return;

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
            showDrawerStatus('success', 'Return processed \u2014 AED ' + Number(result.data.refundAmount || 0).toFixed(2) + ' refunded via ' + RETURN_METHOD_LABEL[method] + '.');
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
      showDrawerStatus('success', 'Saving...');

      fetch('/.netlify/functions/admin-update-order-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminToken: token, orderId: orderId, status: newStatus })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok) { showDrawerStatus('error', result.data.error || 'Could not update status.'); return; }
          var order = allOrders.find(function (o) { return String(o.id) === String(orderId); });
          if (order) order.status = newStatus;
          drawerStatusBadge.textContent = statusLabel(newStatus);
          showDrawerStatus('success', 'Updated to ' + statusLabel(newStatus) + '.');
          renderSummary();
          renderTable();
        })
        .catch(function () { showDrawerStatus('error', 'Network error — status was not updated.'); });
      return;
    }

    var paymentSelect = e.target.closest('.admin-order-payment-select');
    if (paymentSelect) {
      var payOrderId = paymentSelect.getAttribute('data-id');
      var newPaymentMethod = paymentSelect.value;
      if (!newPaymentMethod) return; // the disabled "Not recorded" placeholder — nothing to save
      showDrawerStatus('success', 'Saving...');

      fetch('/.netlify/functions/admin-update-order-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminToken: token, orderId: payOrderId, paymentMethod: newPaymentMethod })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok) { showDrawerStatus('error', result.data.error || 'Could not update payment method.'); return; }
          var order = allOrders.find(function (o) { return String(o.id) === String(payOrderId); });
          if (order) order.payment_method = newPaymentMethod;
          showDrawerStatus('success', 'Payment method set to ' + newPaymentMethod + '.');
          renderTable();
        })
        .catch(function () { showDrawerStatus('error', 'Network error — payment method was not updated.'); });
    }
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
      document.getElementById('admin-orders-status-filter').style.display = isOnline ? '' : 'none';
      document.getElementById('admin-shop-status-filter').style.display = isOnline ? 'none' : '';
    });
  });

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
    document.getElementById('admin-mo-phone').value = c.phone || '';

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
  });

  document.addEventListener('click', function (e) {
    if (!customerResultsEl.contains(e.target) && e.target !== customerSearchInput) {
      customerResultsEl.classList.remove('is-open');
    }
  });

  var pickedItems = []; // [{id, name, price, qty}]
  var discountType = 'percent';

  var sareeResultsEl = document.getElementById('admin-mo-saree-results');

  function sareeResultLabel(p) {
    return (p.material || p.design) + ' — ' + p.id + ' — AED ' + effectivePrice(p).toFixed(2);
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
        (p.design && p.design.toLowerCase().indexOf(q) !== -1);
    }).slice(0, 20);

    if (!matches.length) {
      sareeResultsEl.innerHTML = '<div class="admin-mo-saree-result-item" style="cursor:default; opacity:0.6;">No matching sarees found.</div>';
    } else {
      sareeResultsEl.innerHTML = matches.map(function (p, i) {
        var label = sareeResultLabel(p);
        return '<div class="admin-mo-saree-result-item" data-i="' + i + '">' +
          (p.image ? '<img src="' + p.image + '" loading="lazy" alt="">' : '') +
          '<div class="sinfo">' +
            '<div class="sname">' + (p.material || p.design) + '</div>' +
            '<div class="smeta">' + p.id + (p.pattern ? ' · ' + p.pattern : '') + '</div>' +
          '</div>' +
          '<span class="sprice">AED ' + effectivePrice(p).toFixed(2) + '</span>' +
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
    var total = subtotal - discountAmount;
    return { subtotal: subtotal, discountAmount: discountAmount, total: total };
  }

  function renderTotals() {
    var t = computeTotals();
    totalPreview.innerHTML =
      '<div style="display:flex; justify-content:space-between; padding:2px 0;"><span>Subtotal</span><span>AED ' + t.subtotal.toFixed(2) + '</span></div>' +
      (t.discountAmount > 0 ? '<div style="display:flex; justify-content:space-between; padding:2px 0; color:var(--green);"><span>Discount</span><span>-AED ' + t.discountAmount.toFixed(2) + '</span></div>' : '') +
      '<div style="display:flex; justify-content:space-between; padding:6px 0 0; margin-top:4px; border-top:1px solid var(--stone); font-weight:700; color:var(--green-deep);"><span>Total</span><span>AED ' + t.total.toFixed(2) + '</span></div>';
  }

  function renderPickedItems() {
    if (!pickedItems.length) {
      pickedWrap.innerHTML = '<p style="font-size:0.82rem; opacity:0.6; margin:0;">No sarees added yet.</p>';
    } else {
      pickedWrap.innerHTML = pickedItems.map(function (it, i) {
        return '<div style="display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--stone); border-radius:6px; margin-bottom:6px; font-size:0.82rem;">' +
          (it.image ? '<img src="' + it.image + '" style="width:34px; height:44px; object-fit:cover; border-radius:3px; flex-shrink:0;">' : '') +
          '<span style="flex:1; font-weight:600; color:var(--green-deep);">' + it.name + ' — ' + it.id + '</span>' +
          '<div class="admin-mo-qty-stepper">' +
            '<button type="button" class="admin-mo-qty-minus" data-i="' + i + '">&#8722;</button>' +
            '<span>' + it.qty + '</span>' +
            '<button type="button" class="admin-mo-qty-plus" data-i="' + i + '">+</button>' +
          '</div>' +
          '<span style="color:var(--gold); font-weight:700; min-width:80px; text-align:right;">AED ' + Number(it.price).toFixed(2) + '</span>' +
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
      pickedItems[Number(plusBtn.getAttribute('data-i'))].qty += 1;
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

  addBtn.addEventListener('click', function () {
    var typed = searchInput.value.trim();
    if (!typed) return;
    var product = (window.PRODUCTS || []).find(function (p) { return typed.indexOf(p.id) !== -1; });
    if (!product) {
      showStatus('error', 'Could not match that to a saree — pick one from the suggestions list.');
      return;
    }
    var qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    var existing = pickedItems.find(function (it) { return it.id === product.id; });
    if (existing) {
      existing.qty += qty;
    } else {
      pickedItems.push({
        id: product.id,
        name: product.material || product.design,
        price: effectivePrice(product),
        qty: qty,
        series: product.series,
        type: product.type,
        sareeType: product.sareeType,
        pattern: product.pattern,
        image: product.image
      });
    }
    searchInput.value = '';
    qtyInput.value = '1';
    showStatus('', '');
    renderPickedItems();
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
      paymentMode: document.getElementById('admin-mo-payment-mode').value
    };

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
        showStatus('success', 'Order #' + result.data.orderNumber + ' created and confirmation email sent to ' + email + '.');
        pickedItems = [];
        renderPickedItems();
        document.getElementById('admin-mo-first-name').value = '';
        document.getElementById('admin-mo-last-name').value = '';
        document.getElementById('admin-mo-email').value = '';
        document.getElementById('admin-mo-phone').value = '';
        discountValueInput.value = '0';
        renderTotals();
        refreshSareeList(); // the sold saree(s) should drop out of the picker
        if (window.__refreshOrders) window.__refreshOrders();
      })
      .catch(function () {
        showStatus('error', 'Network error. Please try again.');
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Order & Send Confirmation Email';
      });
  });
}

// ---------------------------------------------------------------
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
  var TAGS_PER_SHEET = 9;

  function showStatus(type, msg) {
    statusMsg.className = 'admin-status-msg admin-status-' + type;
    statusMsg.textContent = msg;
  }

  function getVisibleProducts() {
    var q = searchInput.value.trim().toLowerCase();
    return (window.PRODUCTS || []).filter(function (p) {
      if (hideSoldBox.checked && p.sold) return false;
      if (!q) return true;
      return (p.id || '').toLowerCase().indexOf(q) !== -1 ||
             (p.material || '').toLowerCase().indexOf(q) !== -1 ||
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
      listEl.innerHTML = '<p style="padding:20px; font-size:0.85rem; opacity:0.6;">No sarees match.</p>';
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
            '<div class="tag-meta">' + (p.material || p.design || '') + ' &middot; ' + seriesTitle(p.series) + '</div>' +
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

  function updateCount() {
    countEl.textContent = selectedIds.length + ' selected';
    if (selectedIds.length) {
      var sheets = Math.ceil(selectedIds.length / TAGS_PER_SHEET);
      sheetsEl.textContent = '\u2192 ' + sheets + ' A4 sheet' + (sheets > 1 ? 's' : '') +
        (selectedIds.length % TAGS_PER_SHEET !== 0 ? ' (last sheet partly empty)' : '');
    } else {
      sheetsEl.textContent = '';
    }
    generateBtn.disabled = selectedIds.length === 0;
  }

  searchInput.addEventListener('input', renderList);
  hideSoldBox.addEventListener('change', renderList);

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
    if (typeof JsBarcode === 'undefined') {
      showStatus('error', 'Barcode library did not load — please refresh the page and try again.');
      return;
    }
    var items = selectedIds.map(function (id) {
      return (window.PRODUCTS || []).find(function (p) { return p.id === id; });
    }).filter(Boolean);

    var win = window.open('', '_blank');
    if (!win) {
      showStatus('error', 'Could not open the print window — please allow pop-ups for this site and try again.');
      return;
    }
    win.document.write(buildTagSheetHtml(items));
    win.document.close();
    showStatus('success', 'Print sheet opened in a new tab for ' + items.length + ' tag' + (items.length > 1 ? 's' : '') + '.');
  });

  renderList();
  updateCount();
}

// Builds the standalone printable tag sheet. Barcodes are rendered
// inside the new window itself (JsBarcode is loaded there too), since
// SVG generated in this document can't be reliably transplanted.
// The logo is referenced by URL rather than inlined as base64 — the
// sheet opens from this same site, so the path resolves, and it keeps
// admin.js from carrying a 110KB embedded image.
function buildTagSheetHtml(items) {
  var phoneIcon = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
  var igIcon = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>';
  var siteIcon = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

  function seriesTitle(s) {
    return (s || '').toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Chunk into pages of 6 so each A4 sheet breaks cleanly
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
          '</div>' +
          '<div class="fold-line"></div>' +
          '<div class="panel-inner">' +
            '<p class="series-text">' + esc(seriesTitle(item.series)) + '</p>' +
            '<svg class="barcode" id="bc-' + globalIdx + '"></svg>' +
            '<p class="code-text">' + esc(item.id) + '</p>' +
            '<div class="contact-footer">' +
              '<span class="phone-line">' + phoneIcon + ' +971 52 66 30307</span>' +
              '<span class="contact-divider">|</span>' +
              '<span class="ig-line">' + igIcon + ' pavnika_by_saranya</span>' +
            '</div>' +
            '<div class="contact-footer site-footer">' +
              '<span class="site-line">' + siteIcon + ' www.pavnika.com</span>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
    return '<div class="sheet">' + tags + '</div>';
  }).join('');

  var barcodeData = items.map(function (it) { return it.id; });

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
    '.panel-inner{justify-content:flex-start;padding-top:0.22in}' +
    '.panel-outer img{width:1.55in;height:auto}' +
    '.panel-outer .tagline{font-size:8px;color:#B68A69;letter-spacing:0.8px;text-transform:uppercase;margin-top:8px;white-space:nowrap}' +
    '.panel-inner svg.barcode{width:1.7in;margin-top:4px}' +
    '.panel-inner .code-text{font-family:"Courier New",monospace;font-size:13px;font-weight:bold;color:#2B0D1A;letter-spacing:1px;margin-top:2px}' +
    '.panel-inner .series-text{font-size:9px;color:#8a7266;margin:0 0 2px;text-align:center;font-weight:600}' +
    '.contact-footer{font-size:5.6px;color:#B68A69;margin-top:6px;display:flex;align-items:center;gap:3px;flex-wrap:nowrap;white-space:nowrap;justify-content:center}' +
    '.contact-footer.site-footer{margin-top:3px}' +
    '.contact-divider{opacity:0.5}' +
    '.ig-line,.phone-line,.site-line{display:inline-flex;align-items:center;gap:3px}' +
    '@media print{@page{size:A4;margin:0}body{background:#fff;padding:0}.screen-note{display:none}.sheet{box-shadow:none;margin:0;page-break-after:always}.sheet:last-child{page-break-after:auto}}' +
    '</style></head><body>' +
    '<div class="screen-note"><b>Print instructions for the shop:</b><br>' +
    'Paper: 250&ndash;300 GSM white cardstock &middot; A4 &middot; <b>Laser print</b> (not inkjet) &middot; Optional matte lamination<br>' +
    'Print at <b>100% scale / "Actual size"</b> &mdash; do <b>not</b> use "Fit to page", or the tags will come out the wrong size and the barcodes may not scan reliably.<br>' +
    'Cut along the light dashed lines, then fold each tag in half along the dotted centre line (printed sides face outward).<br>' +
    '<button class="print-btn" onclick="window.print()">Print / Save as PDF</button></div>' +
    pagesHtml +
    '<script src="jsbarcode.min.js"><\/script>' +
    '<script>var CODES=' + JSON.stringify(barcodeData) + ';' +
    'CODES.forEach(function(code,i){try{JsBarcode("#bc-"+i,code,{format:"CODE128",width:1.6,height:40,displayValue:false,margin:0});}catch(e){' +
    'var el=document.getElementById("bc-"+i);if(el)el.outerHTML=\'<div style="font-size:10px;color:#B8142A;">Barcode failed: \'+code+\'</div>\';}});<\/script>' +
    '</body></html>';
}
