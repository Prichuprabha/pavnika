// If the browser restores this page from its back-forward cache (e.g. the
// customer hits "back" after visiting Nomod's payment page), force a real
// reload — otherwise things like a "Starting payment..." button label or a
// consumed promo code field can be stuck showing stale, frozen state.
window.addEventListener('pageshow', function (e) {
  if (e.persisted) window.location.reload();
});

(function initFrostedHeader() {
  var header = document.querySelector('header.site-header');
  if (!header) return;
  function onScroll() {
    if (window.scrollY > 24) {
      header.classList.add('is-scrolled');
    } else {
      header.classList.remove('is-scrolled');
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

document.addEventListener('DOMContentLoaded', function () {
  initLoginPage();
  initReviewsMarquee();
  initCuratedShowcase();
  initFaqAccordion();
  buildLightbox();
  initAccountMenu();
  initSearchPanel();
  initCartDrawer();
  initWishlistDrawer();
  initMobileBottomBar();
  initRevealAnimations();
  initCheckoutPage();
  initOrderSuccessPage();

  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.main-nav');

  if (toggle && nav) {
    toggle.addEventListener('click', function (e) {
      e.stopPropagation(); // don't let this same click immediately re-trigger the outside-click handler below
      var isOpen = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    function closeMobileNav() {
      if (!nav.classList.contains('open')) return;
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }

    document.addEventListener('click', function (e) {
      if (nav.classList.contains('open') && !nav.contains(e.target)) closeMobileNav();
    });
    window.addEventListener('scroll', closeMobileNav, { passive: true });
  }

  // Shared submit handling for every Netlify form on the site (the
  // contact page enquiry form AND the Book Appointment popup). Each form
  // declares data-subject-prefix; the hidden "subject" field is filled
  // with "<prefix> <customer name>" so notification emails arrive with a
  // meaningful subject line, e.g. "Appointment Request by Saranya".
  // Builds the two "quick action" links appended to an appointment
  // request's message field (calendar invite + WhatsApp), so both are
  // already clickable in the notification email without any manual
  // find-and-replace. Returns null for any other form (this only
  // applies to the appointment popup, not the general contact form,
  // even though both share wireNetlifyForm).
  function buildAppointmentQuickLinks(form) {
    if (form.getAttribute('name') !== 'appointment') return null;

    var name = (form.querySelector('[name="name"]') || {}).value || '';
    var email = (form.querySelector('[name="email"]') || {}).value || '';
    var codeInput = form.querySelector('[name="phone_country_code"]');
    var numberInput = form.querySelector('[name="phone_number"]');
    if (!name.trim() || !email.trim() || !codeInput || !numberInput) return null;

    var fullPhone = codeInput.value + numberInput.value.replace(/[^\d]/g, '');

    var calTitle = 'Viewing Confirmation \u2014 Pavnika by Saranya \u2014 ' + name.trim();
    var calDetails = 'Your saree viewing appointment with Pavnika by Saranya has been booked for this time slot.\n\n' +
      'If you need to change the date or time, simply reply to this email with your preferred alternative and we will be happy to accommodate you.\n\n' +
      'Location: https://maps.app.goo.gl/ZQyP6srGwxG7M6pbA';
    var calParams = new URLSearchParams({
      action: 'TEMPLATE',
      text: calTitle,
      details: calDetails,
      location: 'Al Barsha South 4, Dubai, UAE',
      add: email.trim()
    });
    var calLink = 'https://calendar.google.com/calendar/render?' + calParams.toString();

    var firstName = name.trim().split(' ')[0] || 'there';
    var waMsg = 'Hi ' + firstName + ', this is Pavnika by Saranya. Your saree viewing appointment has been booked. ' +
      'You should also see a calendar invite from us by email \u2014 if you need to change the date or time, ' +
      'just reply here on WhatsApp and we will sort out a time that works.';
    var waLink = 'https://wa.me/' + fullPhone + '?text=' + encodeURIComponent(waMsg);

    return '\n\n---\nQuick actions for this booking:\n' +
      'Add to Calendar & invite: ' + calLink + '\n' +
      'Message on WhatsApp: ' + waLink;
  }

  function wireNetlifyForm(form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var note = form.querySelector('.form-status');
      var submitBtn = form.querySelector('button[type="submit"]');

      var subjectInput = form.querySelector('input[name="subject"]');
      var nameInput = form.querySelector('input[name="name"]');
      if (subjectInput) {
        var prefix = form.getAttribute('data-subject-prefix') || 'Enquiry by';
        subjectInput.value = prefix + ' ' + ((nameInput && nameInput.value.trim()) || 'website visitor');
      }

      var messageInput = form.querySelector('[name="message"]');
      var quickLinks = buildAppointmentQuickLinks(form);
      if (messageInput && quickLinks) messageInput.value = messageInput.value + quickLinks;

      if (submitBtn) submitBtn.disabled = true;

      var data = new FormData(form);
      fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(data).toString()
      })
        .then(function () {
          if (note) {
            note.textContent = 'Thank you \u2014 your message has been received. We will reach out on WhatsApp or email within one business day.';
            note.style.color = '#73302E';
          }
          form.reset();
        })
        .catch(function () {
          if (note) {
            note.textContent = 'Something went wrong \u2014 please message us directly on WhatsApp instead.';
            note.style.color = '#B8142A';
          }
        })
        .finally(function () {
          if (submitBtn) submitBtn.disabled = false;
        });
    });
  }
  document.querySelectorAll('.contact-form').forEach(wireNetlifyForm);

  initAppointmentPopup(wireNetlifyForm);

  initSidebarAdRotator();

  initCollectionsPage();
  initHomeSeriesMarquee();
  initHeroBannerCarousel();
  initHomeVideoShowcase();
  initPinnedHero();
});

var WHATSAPP_NUMBER = '971526630307';

var SERIES_ORDER = [
  'VALUE WEAVES', 'SANSKRITI', 'SUMANGALI', 'FESTIVE VIBES', 'PASTEL POETRY',
  'BRIDAL BLISS', 'GOLDEN GLOW', 'SOFT SILK', 'SHIMMER STORIES',
  'PAVNIKA SIGNATURE', 'DEVATHA AURA'
];
var SERIES_DESCRIPTIONS = {
  'VALUE WEAVES': 'Everyday semi silk weaves, priced honestly for regular wear.',
  'SANSKRITI': 'Vintage-inspired weaves bridging bridal richness and everyday ease.',
  'SUMANGALI': 'Pure Kanchipuram silk in bridal weight, woven for the wedding day.',
  'FESTIVE VIBES': 'Lighter festive weaves — Mysore silk, organza and Banarasi.',
  'PASTEL POETRY': 'Soft pastel tones in modern silver-zari weaves.',
  'BRIDAL BLISS': 'Rich brocade semi silk, styled for the bridal season.',
  'GOLDEN GLOW': 'Gold-forward weaves that catch the light at every fold.',
  'SOFT SILK': 'Softer drape, lighter weight — silk for long, easy evenings.',
  'SHIMMER STORIES': 'Shimmering tissue weaves for a little extra sparkle.',
  'PAVNIKA SIGNATURE': 'Our own jacquard designs, exclusive to Pavnika by Saranya.',
  'DEVATHA AURA': 'Rare vintage-inspired pieces with a divine, timeless aura.'
};
var SERIES_HOVER_TEXT = {
  'VALUE WEAVES': 'View more from our Value Weaves collection',
  'SANSKRITI': 'Explore the Sanskriti collection',
  'SUMANGALI': 'Discover our Sumangali bridal collection',
  'FESTIVE VIBES': 'See more Festive Vibes sarees',
  'PASTEL POETRY': 'Browse the Pastel Poetry collection',
  'BRIDAL BLISS': 'Explore the Bridal Bliss collection',
  'GOLDEN GLOW': 'See more from Golden Glow',
  'SOFT SILK': 'Browse our Soft Silk collection',
  'SHIMMER STORIES': 'Discover Shimmer Stories',
  'PAVNIKA SIGNATURE': 'Explore our Signature collection',
  'DEVATHA AURA': 'See the Devatha Aura collection'
};

// Safe fallback: any series not listed above (e.g. a brand new one added
// later to products-data.js) still gets a sensible generic phrase here —
// this can never throw, since a missing key just falls through to it.
function seriesHoverText(series) {
  return SERIES_HOVER_TEXT[series] || ('View more from our ' + seriesTitleCase(series) + ' collection');
}

var COUNTRY_LIST = [
  'United Arab Emirates', 'India', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Bahrain', 'Oman',
  'United Kingdom', 'United States', 'Canada', 'Australia', 'Singapore', 'Pakistan',
  'Sri Lanka', 'Bangladesh', 'Malaysia', 'Egypt', 'Jordan', 'Lebanon', 'South Africa',
  'Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'Other'
];

// Dial codes for the appointment form's phone field. UAE first/default —
// most bookings are local. "leadingZero" flags codes where the local
// mobile format conventionally starts with 0 that must be dropped once
// the country code is added (true for UAE at minimum; left off for
// others here since it isn't needed for validation beyond UAE today).
var PHONE_COUNTRY_CODES = [
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

function formatAED(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function seriesTitleCase(s) {
  return String(s).toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

function whatsappLink(product) {
  var msg = 'Hi Pavnika by Saranya, I am interested in the ' + seriesTitleCase(product.series) +
    ' saree (' + product.id + ') — ' + (product.material || product.design) + '. Is it available?';
  return 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(msg);
}

function productCardHTML(p) {
  var soldClass = p.sold ? ' is-sold' : '';
  var soldRibbon = p.sold ? '<div class="sold-ribbon"><span>Sold Out</span></div>' : '';
  return (
    '<div class="product-card" data-category="' + p.category + '" data-series="' + p.series + '" data-id="' + p.id + '">' +
      '<div class="product-photo' + soldClass + '">' +
        '<span class="series-badge">' + seriesTitleCase(p.series) + '</span>' +
        '<span class="id-badge">' + p.id + '</span>' +
        '<img src="' + p.image + '" alt="' + (p.material || p.design) + ' — ' + seriesTitleCase(p.series) + ' saree" loading="lazy" decoding="async">' +
        soldRibbon +
      '</div>' +
      '<div class="product-info">' +
        '<span class="p-design">' + (p.material || p.design) + '</span>' +
        '<span class="p-meta">' + p.type + (p.pattern ? ' · ' + p.pattern : '') + '</span>' +
        '<span class="p-price">AED ' + formatAED(p.price) + '</span>' +
        '<a class="p-enquire" href="' + whatsappLink(p) + '" target="_blank" rel="noopener">Enquire on WhatsApp &rarr;</a>' +
      '</div>' +
    '</div>'
  );
}

/* ---------- Hover image cycling: fade through all of a saree's images on mouseover ---------- */
function initHoverCycle(grid) {
  if (typeof window.PRODUCTS === 'undefined') return;

  grid.querySelectorAll('.product-photo').forEach(function (photoEl) {
    var card = photoEl.closest('.product-card');
    var id = card && card.getAttribute('data-id');
    var product = window.PRODUCTS.find(function (p) { return p.id === id; });
    if (!product || !product.images || product.images.length < 2) return;

    var cycleTimer = null;

    function stopCycle() {
      if (cycleTimer) {
        clearTimeout(cycleTimer);
        cycleTimer = null;
      }
      var imgs = photoEl.querySelectorAll('img');
      imgs.forEach(function (im, i) { im.classList.toggle('is-active', i === 0); });
    }

    photoEl.addEventListener('mouseenter', function () {
      if (!photoEl.classList.contains('hover-cycle')) {
        photoEl.classList.add('hover-cycle');
        var baseImg = photoEl.querySelector('img');
        if (baseImg) baseImg.classList.add('is-active');
        for (var i = 1; i < product.images.length; i++) {
          var extraImg = document.createElement('img');
          extraImg.src = product.images[i];
          extraImg.alt = (product.material || product.design) + ' — view ' + (i + 1);
          extraImg.loading = 'eager';
          extraImg.decoding = 'async';
          photoEl.appendChild(extraImg);
        }
      }

      var imgs = photoEl.querySelectorAll('img');
      var idx = 0;
      imgs.forEach(function (im, i) { if (im.classList.contains('is-active')) idx = i; });

      function advance(delay) {
        cycleTimer = setTimeout(function () {
          imgs[idx].classList.remove('is-active');
          idx = (idx + 1) % imgs.length;
          imgs[idx].classList.add('is-active');
          advance(1800);
        }, delay);
      }

      // First switch is quick, so hovering immediately signals there's more
      // than one photo. Later switches slow down to give each one time.
      advance(650);
    });

    photoEl.addEventListener('mouseleave', stopCycle);
  });
}

/* ---------- Mobile "tap to reveal, tap again to open" ----------
   Touch devices have no hover state, so tapping a curated/signature
   tile would previously navigate away immediately without ever
   showing the overlay text. This intercepts the FIRST tap to reveal
   it (matching the desktop :hover look via .is-revealed), and lets a
   second tap on the same, already-revealed tile follow the link. */
function initTouchRevealTiles() {
  if (!window.matchMedia('(hover: none)').matches) return; // desktop: hover works natively

  function wire(selector) {
    document.querySelectorAll(selector).forEach(function (tile) {
      tile.addEventListener('click', function (e) {
        if (!tile.classList.contains('is-revealed')) {
          e.preventDefault();
          document.querySelectorAll(selector + '.is-revealed').forEach(function (t) {
            if (t !== tile) t.classList.remove('is-revealed');
          });
          tile.classList.add('is-revealed');
        }
        // else: already revealed — let the tap navigate normally.
      });
    });
  }

  wire('.curated-tile');
  wire('.category-tile');
}

function initCollectionsPage() {
  var grid = document.getElementById('product-grid');
  if (!grid || typeof window.PRODUCTS === 'undefined') return;

  var DEFAULT_PAGE_SIZE = 16;
  var PAGE_SIZE = DEFAULT_PAGE_SIZE;
  var state = { category: 'all', series: 'all', shade: 'all', showSold: false, page: 1, query: '', priceMin: null, priceMax: null, sort: 'default' };

  // No filter applied = the plain "browse everything" view (default
  // category/series/shade, no search text, no price range, default
  // sort). Only in that view do we flex the page size to guarantee a
  // full last row — see updatePageSize() below. The moment any filter
  // narrows the results, we fall back to a plain fixed 16 per page;
  // with a filtered (often much smaller, unpredictable) result count,
  // stretching or shrinking the page size to chase a "full row" isn't
  // worth the inconsistency it'd introduce.
  function isUnfiltered() {
    // priceMin/priceMax are never actually null — the slider pre-fills
    // to the full catalogue's min/max on load (see dataMin/dataMax
    // below), so "no price filter" means the slider is still sitting
    // at that full span, not that these are unset.
    var priceIsFullRange = (typeof dataMin === 'undefined') ||
      (state.priceMin === dataMin && state.priceMax === dataMax);
    return state.category === 'all' && state.series === 'all' && state.shade === 'all' &&
      !state.showSold && !state.query.trim() && priceIsFullRange;
  }

  // Measures how many saree cards actually fit per row right now (the
  // grid is a responsive auto-fill layout, so this changes continuously
  // as the window is resized — there's no fixed set of breakpoints to
  // hook), then picks a page size that's a whole multiple of that
  // column count, as close to DEFAULT_PAGE_SIZE as possible:
  //   - if capping at DEFAULT_PAGE_SIZE would leave 1 or 2 sarees alone
  //     on a weak last row, drop them (page size rounds down)
  //   - if it would leave 3 or 4 (closer to a full row), pull enough
  //     forward to complete it instead (page size rounds up)
  // This only ever changes which fixed number of items we page by; it
  // never hides real inventory except for the single unavoidable case
  // explained where render() is called — the true last page of the
  // whole result set, where there just aren't more sarees to show.
  function currentColumnCount() {
    var cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    return cols || 1;
  }
  function updatePageSize() {
    if (!isUnfiltered()) {
      var changed = PAGE_SIZE !== DEFAULT_PAGE_SIZE;
      PAGE_SIZE = DEFAULT_PAGE_SIZE;
      return changed;
    }
    var cols = currentColumnCount();
    var rows = Math.max(1, Math.round(DEFAULT_PAGE_SIZE / cols));
    var next = cols * rows;
    if (next !== PAGE_SIZE) {
      PAGE_SIZE = next;
      return true;
    }
    return false;
  }
  var countEl = document.getElementById('results-count');
  var noResults = document.getElementById('no-results');
  var paginationEl = document.getElementById('pagination');
  var hideSoldToggle = document.getElementById('hide-sold-toggle');
  var categoryGroup = document.getElementById('category-filter');
  var seriesGroup = document.getElementById('series-filter');
  var shadeGroup = document.getElementById('shade-filter');
  var searchInput = document.getElementById('collections-search-input');
  var SEARCH_FIELDS = ['id', 'material', 'design', 'type', 'sareeType', 'pattern', 'series', 'category'];

  function getFiltered() {
    var q = state.query.trim().toLowerCase();
    return window.PRODUCTS.filter(function (p) {
      // NOTE: the first sidebar group is labeled Material and filters on
      // p.material — internal state/ids kept as 'category' to avoid churn.
      var okCat = state.category === 'all' || p.material === state.category;
      var okSeries = state.series === 'all' || p.series === state.series;
      var okShade = state.shade === 'all' || p.shade === state.shade;
      var okSold = state.showSold || !p.sold;
      var okQuery = !q || SEARCH_FIELDS.some(function (f) {
        return p[f] && String(p[f]).toLowerCase().indexOf(q) !== -1;
      });
      var price = Number(p.price) || 0;
      var okMinPrice = state.priceMin === null || price >= state.priceMin;
      var okMaxPrice = state.priceMax === null || price <= state.priceMax;
      return okCat && okSeries && okShade && okSold && okQuery && okMinPrice && okMaxPrice;
    });
  }

  // Which series actually have sarees in the given category (or all, if 'all').
  function seriesAvailableFor(category) {
    var set = {};
    window.PRODUCTS.forEach(function (p) {
      if (category === 'all' || p.material === category) set[p.series] = true;
    });
    return set;
  }

  // Which categories actually have sarees in the given series (or all, if 'all').
  function categoriesAvailableFor(series) {
    var set = {};
    window.PRODUCTS.forEach(function (p) {
      if (series === 'all' || p.series === series) set[p.material] = true;
    });
    return set;
  }

  // Disables/fades out filter buttons that would produce zero results given
  // the other filter's current selection. Works for any series or category
  // value found in the data — new ones added later need no code changes.
  function updateFilterAvailability() {
    if (seriesGroup) {
      var availableSeries = seriesAvailableFor(state.category);
      seriesGroup.querySelectorAll('.filter-btn').forEach(function (btn) {
        var val = btn.getAttribute('data-value');
        var ok = val === 'all' || !!availableSeries[val];
        btn.disabled = !ok;
        btn.classList.toggle('is-unavailable', !ok);
      });
    }
    if (categoryGroup) {
      var availableCategories = categoriesAvailableFor(state.series);
      categoryGroup.querySelectorAll('.filter-btn').forEach(function (btn) {
        var val = btn.getAttribute('data-value');
        var ok = val === 'all' || !!availableCategories[val];
        btn.disabled = !ok;
        btn.classList.toggle('is-unavailable', !ok);
      });
    }
  }

  function setActiveButton(groupEl, value) {
    if (!groupEl) return;
    groupEl.querySelectorAll('.filter-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-value') === value);
    });
  }

  function renderPagination(totalItems) {
    var totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;

    if (totalPages <= 1) {
      paginationEl.innerHTML = '';
      return;
    }

    var buttons = [];
    buttons.push('<button type="button" class="page-btn" data-page="' + (state.page - 1) + '"' + (state.page === 1 ? ' disabled' : '') + ' aria-label="Previous page">&#8249;</button>');

    for (var i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || Math.abs(i - state.page) <= 1) {
        buttons.push('<button type="button" class="page-btn' + (i === state.page ? ' active' : '') + '" data-page="' + i + '">' + i + '</button>');
      } else if (Math.abs(i - state.page) === 2) {
        buttons.push('<span class="page-btn page-ellipsis">&hellip;</span>');
      }
    }

    buttons.push('<button type="button" class="page-btn" data-page="' + (state.page + 1) + '"' + (state.page === totalPages ? ' disabled' : '') + ' aria-label="Next page">&#8250;</button>');
    paginationEl.innerHTML = buttons.join('');
  }

  function render() {
    updateFilterAvailability();
    updatePageSize();
    var filtered = getFiltered();

    if (state.sort === 'price-asc') {
      filtered = filtered.slice().sort(function (a, b) { return (Number(a.price) || 0) - (Number(b.price) || 0); });
    } else if (state.sort === 'price-desc') {
      filtered = filtered.slice().sort(function (a, b) { return (Number(b.price) || 0) - (Number(a.price) || 0); });
    } else if (state.sort === 'newest') {
      // No "date added" field exists — "newest" is approximated as
      // reverse catalogue order, so whatever was appended last in
      // products-data.js (last row in the admin CSV / editor) surfaces
      // first, on the assumption new sarees are added to the end.
      filtered = filtered.slice().reverse();
    }

    var start = (state.page - 1) * PAGE_SIZE;
    var pageItems = filtered.slice(start, start + PAGE_SIZE);

    grid.innerHTML = pageItems.map(productCardHTML).join('');
    if (countEl) countEl.textContent = filtered.length + (filtered.length === 1 ? ' saree' : ' sarees') + ' found';

    // Active-filter indicator: without it, arriving from header search
    // gives no visual clue that the grid is already narrowed down.
    var noteEl = document.getElementById('active-filter-note');
    if (noteEl) {
      var parts = [];
      if (state.category !== 'all') parts.push(state.category);
      if (state.series !== 'all') parts.push(seriesTitleCase(state.series));
      if (state.shade !== 'all') parts.push(state.shade);
      if (state.query.trim()) parts.push('\u201C' + state.query.trim() + '\u201D');
      if (state.priceMin !== null || state.priceMax !== null) parts.push('price range');
      noteEl.textContent = parts.length ? 'Filtered by: ' + parts.join(' \u00B7 ') : '';
    }
    noResults.style.display = filtered.length === 0 ? 'block' : 'none';
    renderPagination(filtered.length);
    initHoverCycle(grid);
    if (window.__revealElements) window.__revealElements(grid, '.product-card');
  }

  if (categoryGroup) {
    categoryGroup.addEventListener('click', function (e) {
      var btn = e.target.closest('.filter-btn');
      if (!btn || btn.disabled) return;
      state.category = btn.getAttribute('data-value');
      setActiveButton(categoryGroup, state.category);

      // If the currently selected series has no sarees in this category,
      // fall back to "All Series" rather than showing an empty grid.
      var available = seriesAvailableFor(state.category);
      if (state.series !== 'all' && !available[state.series]) {
        state.series = 'all';
        setActiveButton(seriesGroup, 'all');
      }

      state.page = 1;
      render();
    });
  }

  if (shadeGroup) {
    shadeGroup.addEventListener('click', function (e) {
      var btn = e.target.closest('.swatch-btn');
      if (!btn) return;
      state.shade = btn.getAttribute('data-value');
      shadeGroup.querySelectorAll('.swatch-btn').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      state.page = 1;
      render();
    });
  }

  if (seriesGroup) {
    seriesGroup.addEventListener('click', function (e) {
      var btn = e.target.closest('.filter-btn');
      if (!btn || btn.disabled) return;
      state.series = btn.getAttribute('data-value');
      setActiveButton(seriesGroup, state.series);

      // Same reconciliation in the other direction.
      var available = categoriesAvailableFor(state.series);
      if (state.category !== 'all' && !available[state.category]) {
        state.category = 'all';
        setActiveButton(categoryGroup, 'all');
      }

      state.page = 1;
      render();
    });
  }

  if (hideSoldToggle) {
    hideSoldToggle.addEventListener('change', function () {
      state.showSold = hideSoldToggle.checked;
      state.page = 1;
      render();
    });
  }

  var mobileFiltersBtn = document.getElementById('mobile-filters-btn');
  var closeFiltersBtn = document.getElementById('close-filters-btn');
  var applyFiltersBtn = document.getElementById('apply-filters-btn');
  var sidebarEl = document.querySelector('.collections-sidebar');
  if (mobileFiltersBtn && sidebarEl) {
    mobileFiltersBtn.addEventListener('click', function () {
      sidebarEl.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    });
  }
  function closeMobileFilters() {
    if (sidebarEl) sidebarEl.classList.remove('is-open');
    document.body.style.overflow = '';
  }
  if (closeFiltersBtn) closeFiltersBtn.addEventListener('click', closeMobileFilters);
  if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', closeMobileFilters);

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      state.query = searchInput.value;
      state.page = 1;
      render();
    });
  }

  // Price range dual-handle slider — bounds computed from actual saree
  // prices rather than a hardcoded guess.
  var priceMinInput = document.getElementById('price-min-input');
  var priceMaxInput = document.getElementById('price-max-input');
  var priceMinLabel = document.getElementById('price-min-label');
  var priceMaxLabel = document.getElementById('price-max-label');
  var priceTrackFill = document.getElementById('price-track-fill');
  var updatePriceUI = function () {};

  if (priceMinInput && priceMaxInput && window.PRODUCTS && window.PRODUCTS.length) {
    var allPrices = window.PRODUCTS.map(function (p) { return Number(p.price) || 0; });
    var dataMin = Math.floor(Math.min.apply(null, allPrices) / 50) * 50;
    var dataMax = Math.ceil(Math.max.apply(null, allPrices) / 50) * 50;

    [priceMinInput, priceMaxInput].forEach(function (input) {
      input.min = dataMin;
      input.max = dataMax;
    });
    priceMinInput.value = dataMin;
    priceMaxInput.value = dataMax;
    state.priceMin = dataMin;
    state.priceMax = dataMax;

    updatePriceUI = function () {
      var lo = Math.min(Number(priceMinInput.value), Number(priceMaxInput.value));
      var hi = Math.max(Number(priceMinInput.value), Number(priceMaxInput.value));
      priceMinLabel.textContent = lo.toLocaleString();
      priceMaxLabel.textContent = hi.toLocaleString();
      if (priceTrackFill) {
        var pctLo = ((lo - dataMin) / (dataMax - dataMin)) * 100;
        var pctHi = ((hi - dataMin) / (dataMax - dataMin)) * 100;
        priceTrackFill.style.left = pctLo + '%';
        priceTrackFill.style.width = (pctHi - pctLo) + '%';
      }
    };
    updatePriceUI();

    function onPriceChange() {
      state.priceMin = Math.min(Number(priceMinInput.value), Number(priceMaxInput.value));
      state.priceMax = Math.max(Number(priceMinInput.value), Number(priceMaxInput.value));
      state.page = 1;
      updatePriceUI();
      render();
    }
    priceMinInput.addEventListener('input', onPriceChange);
    priceMaxInput.addEventListener('input', onPriceChange);
  }

  var sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', function () {
      state.sort = sortSelect.value;
      state.page = 1;
      render();
    });
  }

  var clearFiltersBtn = document.getElementById('clear-all-filters');
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', function () {
      state.category = 'all';
      state.series = 'all';
      state.shade = 'all';
      if (shadeGroup) shadeGroup.querySelectorAll('.swatch-btn').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-value') === 'all');
      });
      state.showSold = false;
      state.query = '';
      state.sort = 'default';
      state.page = 1;
      if (categoryGroup) setActiveButton(categoryGroup, 'all');
      if (seriesGroup) setActiveButton(seriesGroup, 'all');
      if (hideSoldToggle) hideSoldToggle.checked = false;
      if (searchInput) searchInput.value = '';
      if (sortSelect) sortSelect.value = 'default';
      if (priceMinInput && priceMaxInput) {
        priceMinInput.value = priceMinInput.min;
        priceMaxInput.value = priceMaxInput.max;
        state.priceMin = Number(priceMinInput.min);
        state.priceMax = Number(priceMaxInput.max);
        updatePriceUI();
      }
      render();
    });
  }

  if (paginationEl) {
    paginationEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.page-btn');
      if (!btn || btn.disabled) return;
      var target = parseInt(btn.getAttribute('data-page'), 10);
      if (!target || target === state.page) return;
      state.page = target;
      render();
      grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Pre-set the category/series/search filter if arriving from a link
  // elsewhere on the site, e.g. collections.html?series=SUMANGALI or
  // collections.html?q=floral&open=SU003
  var params = new URLSearchParams(window.location.search);
  var catParam = params.get('category');
  var seriesParam = params.get('series');
  var queryParam = params.get('q');
  var openParam = params.get('open');

  if (catParam && categoryGroup && categoryGroup.querySelector('.filter-btn[data-value="' + catParam.replace(/"/g, '') + '"]')) {
    state.category = catParam;
    setActiveButton(categoryGroup, catParam);
  }

  if (seriesParam && seriesGroup && seriesGroup.querySelector('.filter-btn[data-value="' + seriesParam.replace(/"/g, '') + '"]')) {
    // Only honor it if it's actually compatible with the category above.
    var availableWithCat = seriesAvailableFor(state.category);
    if (state.category === 'all' || availableWithCat[seriesParam]) {
      state.series = seriesParam;
      setActiveButton(seriesGroup, seriesParam);
    }
  }

  if (queryParam && searchInput) {
    state.query = queryParam;
    searchInput.value = queryParam;
  }

  render();
  buildLightbox();

  // Re-check page size on resize (debounced) — only actually re-renders
  // if the number of columns that fit has genuinely changed, not on
  // every pixel of dragging.
  var resizeDebounce = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(function () {
      if (updatePageSize()) render();
    }, 200);
  });

  if (openParam) {
    var openProduct = window.PRODUCTS.find(function (p) { return p.id === openParam; });
    if (openProduct) window.openLightbox(openProduct);
  }

  // Open the lightbox when a saree card is clicked, but not when the
  // WhatsApp enquiry link itself is clicked.
  grid.addEventListener('click', function (e) {
    if (e.target.closest('.p-enquire')) return;
    var card = e.target.closest('.product-card');
    if (!card) return;
    var id = card.getAttribute('data-id');
    var product = window.PRODUCTS.find(function (p) { return p.id === id; });
    if (product) window.openLightbox(product);
  });
}

/* ---------- Collections sidebar ad rotator ----------
   Rotates up to 3 admin-managed media items (assets/ads/) inside the
   filter sidebar. Images hold for 6 seconds; videos play through to the
   end before advancing; the sequence loops continuously. Desktop only —
   the slot is hidden on mobile and media is never loaded there. */
function initSidebarAdRotator() {
  var slot = document.getElementById('sidebar-ad-slot');
  if (!slot) return;
  if (!window.matchMedia('(min-width: 881px)').matches) return;

  var IMAGE_SECONDS = 6;
  var VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

  fetch('assets/ads/collections-ads.json?t=' + Date.now())
    .then(function (res) { return res.json(); })
    .then(function (list) {
      var items = (Array.isArray(list) ? list : [])
        .map(function (x) { return (x && x.file ? String(x.file) : '').trim(); })
        .filter(Boolean)
        .slice(0, 3);
      if (!items.length) return; // nothing configured — slot stays hidden

      slot.style.display = 'block';
      var idx = -1;
      var timer = null;

      function next() {
        if (timer) { clearTimeout(timer); timer = null; }
        idx = (idx + 1) % items.length;
        var file = items[idx];
        slot.innerHTML = '';
        if (VIDEO_EXT.test(file)) {
          var v = document.createElement('video');
          v.src = 'assets/ads/' + file;
          v.muted = true;
          v.playsInline = true;
          v.autoplay = true;
          v.preload = 'auto';
          v.addEventListener('ended', next);
          v.addEventListener('error', next); // bad file: skip on
          slot.appendChild(v);
          var p = v.play();
          if (p && p.catch) p.catch(function () { timer = setTimeout(next, IMAGE_SECONDS * 1000); });
        } else {
          var img = document.createElement('img');
          img.src = 'assets/ads/' + file;
          img.alt = '';
          img.addEventListener('error', next);
          slot.appendChild(img);
          timer = setTimeout(next, IMAGE_SECONDS * 1000);
        }
      }
      next();
    })
    .catch(function () { /* no ads file — slot stays hidden */ });
}

/* ---------- Book Appointment popup ----------
   The header's "Book Appointment" button opens this popup on every page
   (falling back to contact.html if JS is unavailable). It mirrors the
   contact enquiry form and posts to the SAME Netlify form ("contact"),
   but with the subject "Appointment Request by <name>". */
function initAppointmentPopup(wireNetlifyForm) {
  var ctas = document.querySelectorAll('.nav-cta, .open-appointment');
  if (!ctas.length) return;

  var overlay = null;

  function buildPopup() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'appt-overlay';
    overlay.innerHTML =
      '<div class="appt-modal" role="dialog" aria-modal="true" aria-label="Book a private viewing">' +
        '<button type="button" class="appt-close" aria-label="Close">&times;</button>' +
        '<h2>Book a private viewing</h2>' +
        '<form class="contact-form" name="appointment" method="POST" data-netlify="true" data-subject-prefix="Appointment Request by">' +
          '<input type="hidden" name="form-name" value="appointment">' +
          '<input type="hidden" name="subject" value="">' +
          '<p style="display:none;"><label>Leave this field blank: <input name="bot-field"></label></p>' +
          '<div class="field"><label for="appt-name">Full name</label><input type="text" id="appt-name" name="name" required></div>' +
          '<div class="field"><label for="appt-phone-number">Phone / WhatsApp</label>' +
            '<div class="appt-phone-row">' +
              '<select id="appt-phone-code" name="phone_country_code">' +
                PHONE_COUNTRY_CODES.map(function (c, i) {
                  return '<option value="' + c.code + '"' + (i === 0 ? ' selected' : '') + '>' + c.label + '</option>';
                }).join('') +
              '</select>' +
              '<input type="tel" id="appt-phone-number" name="phone_number" placeholder="50 123 4567" required>' +
            '</div>' +
            '<span class="appt-phone-hint" id="appt-phone-hint"></span>' +
          '</div>' +
          '<div class="field"><label for="appt-email">Email</label><input type="email" id="appt-email" name="email" required></div>' +
          '<div class="field"><label for="appt-occasion">Occasion</label>' +
            '<select id="appt-occasion" name="occasion">' +
              '<option>Bridal / Wedding</option>' +
              '<option>Festival / Function</option>' +
              '<option>Everyday Soft Silk</option>' +
              '<option>Gifting / Corporate</option>' +
              '<option>Not sure yet</option>' +
            '</select></div>' +
          '<div class="field"><label for="appt-message">Tell us what you\'re looking for</label>' +
            '<textarea id="appt-message" name="message" placeholder="Saree ID (if any), colours, date needed by..."></textarea></div>' +
          '<button type="submit" class="btn btn-primary" style="align-self:flex-start;">Request Appointment</button>' +
          '<p class="form-status form-note"></p>' +
        '</form>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('.appt-close').addEventListener('click', closePopup);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closePopup(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('is-open')) closePopup();
    });

    var form = overlay.querySelector('form');
    var codeSelect = form.querySelector('#appt-phone-code');
    var numberInput = form.querySelector('#appt-phone-number');
    var phoneRow = form.querySelector('.appt-phone-row');
    var phoneHint = form.querySelector('#appt-phone-hint');
    var submitBtn = form.querySelector('button[type="submit"]');

    function validatePhone() {
      var codeEntry = PHONE_COUNTRY_CODES.find(function (c) { return c.code === codeSelect.value; });
      var digits = numberInput.value.replace(/[^\d]/g, '');
      var startsWithZero = digits.charAt(0) === '0';

      if (codeEntry && codeEntry.leadingZero && startsWithZero) {
        phoneRow.classList.add('has-error');
        phoneHint.textContent = 'Don\u2019t include the leading 0 \u2014 with +' + codeEntry.code + ' already selected, just enter e.g. "50 123 4567".';
        phoneHint.classList.add('is-error');
        submitBtn.disabled = true;
        return null;
      }
      phoneRow.classList.remove('has-error');
      phoneHint.textContent = digits ? ('Full number: +' + codeSelect.value + ' ' + digits) : '';
      phoneHint.classList.remove('is-error');
      submitBtn.disabled = false;
      return codeSelect.value + digits;
    }
    codeSelect.addEventListener('change', validatePhone);
    numberInput.addEventListener('input', validatePhone);
    validatePhone();

    wireNetlifyForm(form);
  }

  function openPopup() {
    buildPopup();
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function closePopup() {
    if (!overlay) return;
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  ctas.forEach(function (cta) {
    cta.addEventListener('click', function (e) {
      e.preventDefault();
      openPopup();
    });
  });
}

/* ---------- Cart interest indicator (shown in the saree detail popup) ---------- */
function loadInterestBadge(productId, targetEl) {
  if (!targetEl) return;
  fetch('/.netlify/functions/get-cart-interest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productIds: [productId] })
  })
    .then(function (res) { return res.json(); })
    .then(function (counts) {
      var n = counts[productId];
      if (!n) { targetEl.style.display = 'none'; return; }
      targetEl.style.display = 'block';
      targetEl.textContent = '🛍 ' + n + ' ' + (n === 1 ? 'person has' : 'people have') + ' this in their cart';
      targetEl.title = n + ' ' + (n === 1 ? 'person' : 'people') + ' added this in the last hour';
    })
    .catch(function () { /* silently skip if this fails */ });
}

/* ---------- Lightbox: swipeable image gallery per saree ---------- */
function buildLightbox() {
  if (document.querySelector('.lightbox-overlay')) return;

  var overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML =
    '<div class="lightbox-body">' +
      '<button type="button" class="lightbox-close-x" id="lightbox-close" aria-label="Close">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>' +
      '</button>' +
      '<button type="button" class="lightbox-close-mobile" id="lightbox-close-mobile" aria-label="Close">&larr; Back</button>' +
      '<div class="lightbox-main-grid">' +
        '<div class="lightbox-thumb-rail" id="lightbox-thumb-rail">' +
          '<button type="button" class="thumb-nav up" id="lightbox-thumb-up" aria-label="Previous image">&#9650;</button>' +
          '<div class="thumb-rail-track" id="lightbox-thumb-track"></div>' +
          '<button type="button" class="thumb-nav down" id="lightbox-thumb-down" aria-label="Next image">&#9660;</button>' +
        '</div>' +
        '<div class="lightbox-stage-wrap">' +
          '<div class="lightbox-stage" id="lightbox-stage">' +
            '<span class="zoom-hint" id="lightbox-zoom-hint">Click to zoom</span>' +
          '</div>' +
        '</div>' +
        '<div class="lightbox-side">' +
          '<div class="lightbox-details">' +
            '<span class="p-title" id="lightbox-design"></span>' +
            '<span class="p-subtitle" id="lightbox-meta"></span>' +
          '</div>' +
          '<div class="lightbox-tags" id="lightbox-tags"></div>' +
          '<p class="lightbox-description" id="lightbox-description"></p>' +
          '<div class="lightbox-price-row">' +
            '<p class="lightbox-price" id="lightbox-price"></p>' +
            '<span class="lightbox-heart-wrap">' +
              '<span class="lightbox-heart-tooltip" id="lightbox-heart-tooltip">Add to Wishlist</span>' +
              '<button type="button" class="lightbox-wishlist-heart" id="lightbox-wishlist-heart" aria-label="Add to wishlist">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0 5.4 5.4 0 0 0 0 7.65l8.42 8.42 8.42-8.42a5.4 5.4 0 0 0 0-7.65z"/></svg>' +
              '</button>' +
            '</span>' +
            '<button type="button" class="lightbox-wishlist-pill" id="lightbox-wishlist-pill" aria-label="Add to wishlist">' +
              '<span class="lightbox-wishlist-pill-icon">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0 5.4 5.4 0 0 0 0 7.65l8.42 8.42 8.42-8.42a5.4 5.4 0 0 0 0-7.65z"/></svg>' +
              '</span>' +
              '<span class="lightbox-wishlist-pill-label" id="lightbox-wishlist-pill-label">Add to Wishlist</span>' +
            '</button>' +
          '</div>' +
          '<div class="lightbox-cart-actions" id="lightbox-cart-actions">' +
            '<button type="button" class="btn-add-cart" id="lightbox-add-cart">Add to Cart</button>' +
            '<button type="button" class="btn-buy-now" id="lightbox-buy-now">Buy Now</button>' +
          '</div>' +
          '<p class="interest-badge" id="lightbox-interest" style="display:none;"></p>' +
          '<div class="care-accordion">' +
            '<button type="button" class="care-accordion-toggle" id="care-accordion-toggle" aria-expanded="false">' +
              '<span>Saree Care &amp; Storage</span>' +
              '<span class="care-accordion-icon" aria-hidden="true">+</span>' +
            '</button>' +
            '<div class="care-accordion-panel" id="care-accordion-panel" hidden>' +
              '<ul>' +
                '<li>Dry clean recommended for the first few washes, especially for zari borders and heavily woven pallus.</li>' +
                '<li>If hand-washing later, use a mild, pH-neutral detergent in cool water, and wash the saree alone the first two or three times to check for colour bleeding.</li>' +
                '<li>Dry flat or on a padded hanger in the shade — direct sunlight can fade silk and dull the zari over time.</li>' +
                '<li>Iron on a low, silk-safe setting, ideally with a thin cotton cloth between the iron and the fabric, and avoid pressing directly over zari work.</li>' +
                '<li>Store folded in a breathable cotton or muslin cloth rather than plastic, and refold along different lines every few months to prevent permanent crease lines.</li>' +
                '<li>Keep away from direct moisture and humidity; a few neem leaves or silica packets in storage help deter pests without staining the fabric.</li>' +
              '</ul>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var stage = document.getElementById('lightbox-stage');
  var thumbTrack = document.getElementById('lightbox-thumb-track');
  var thumbRail = document.getElementById('lightbox-thumb-rail');
  var state = { images: [], index: 0 };

  function renderStage() {
    stage.classList.remove('is-zoomed');
    stage.querySelectorAll('img').forEach(function (img) { img.remove(); });
    state.images.forEach(function (src, i) {
      var img = document.createElement('img');
      img.src = src;
      img.alt = 'Saree view ' + (i + 1);
      if (i === state.index) img.classList.add('is-active');
      stage.appendChild(img);
    });

    thumbTrack.innerHTML = state.images.map(function (src, i) {
      return '<button type="button" class="thumb-item' + (i === state.index ? ' is-active' : '') +
        '" data-index="' + i + '"><img src="' + src + '" alt="View ' + (i + 1) + ' thumbnail"></button>';
    }).join('');

    var multi = state.images.length > 1;
    thumbRail.style.display = multi ? 'flex' : 'none';

    var activeThumb = thumbTrack.querySelector('.thumb-item.is-active');
    if (activeThumb) activeThumb.scrollIntoView({ block: 'nearest' });
  }

  function goTo(delta) {
    if (!state.images.length) return;
    state.index = (state.index + delta + state.images.length) % state.images.length;
    renderStage();
  }

  function goToIndex(i) {
    if (i < 0 || i >= state.images.length) return;
    state.index = i;
    renderStage();
  }

  // Builds a short set of highlight tags from whatever fields this saree
  // actually has. Works for any product, present or future — fields that
  // are missing/empty are simply skipped, nothing hardcoded per-saree.
  function buildTags(p) {
    var tags = [];
    if (p.series) tags.push(seriesTitleCase(p.series) + ' Series');
    if (p.category) tags.push(p.category);
    if (p.type) tags.push(p.type);
    if (p.pattern) tags.push(p.pattern);
    return tags;
  }

  // Builds a one-sentence description from the product's own fields.
  // New sarees automatically get a sensible sentence with no extra work.
  function buildDescription(p) {
    var bits = [];
    var opening = 'A';
    if (p.design) opening += ' ' + p.design + ' design';
    if (p.type) opening += ' ' + p.type;
    else opening += ' saree';
    bits.push(opening.trim());
    if (p.sareeType) bits.push('in ' + p.sareeType);
    if (p.pattern) bits.push('featuring a ' + p.pattern);
    var sentence = bits.join(', ');
    if (p.series) sentence += ' — part of our ' + seriesTitleCase(p.series) + ' series';
    return sentence + '.';
  }

  window.openLightbox = function (product) {
    state.images = (product.images && product.images.length) ? product.images : [product.image];
    state.index = 0;
    document.getElementById('lightbox-design').textContent = (product.material || product.design) || '';
    document.getElementById('lightbox-meta').textContent =
      (product.design || '') + (product.sareeType ? ' · ' + product.sareeType : '') + (product.sold ? ' · Sold Out' : '');

    fetch('/.netlify/functions/log-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id })
    }).catch(function () { /* view logging is best-effort, never blocks the popup */ });

    var tags = buildTags(product);
    document.getElementById('lightbox-tags').innerHTML = tags.map(function (t) {
      return '<span>' + t + '</span>';
    }).join('');

    document.getElementById('lightbox-description').textContent = buildDescription(product);
    document.getElementById('lightbox-price').textContent = 'AED ' + formatAED(product.price);

    var addCartBtn = document.getElementById('lightbox-add-cart');
    var buyNowBtn = document.getElementById('lightbox-buy-now');
    var actionsWrap = document.getElementById('lightbox-cart-actions');

    var careToggle = document.getElementById('care-accordion-toggle');
    var carePanel = document.getElementById('care-accordion-panel');
    if (careToggle && carePanel) {
      // The popup's DOM is built once and reused for every saree, so
      // without this reset the accordion would stay open/closed from
      // whatever it was left at on the PREVIOUS saree viewed — it must
      // always start collapsed on every open, per saree, every time.
      careToggle.setAttribute('aria-expanded', 'false');
      careToggle.querySelector('.care-accordion-icon').textContent = '+';
      carePanel.hidden = false; // must stay unhidden so max-height can animate
      carePanel.classList.remove('is-open');

      if (!careToggle._wired) {
        careToggle._wired = true;
        careToggle.addEventListener('click', function () {
          var open = careToggle.getAttribute('aria-expanded') === 'true';
          careToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
          careToggle.querySelector('.care-accordion-icon').textContent = open ? '+' : '\u2212';
          carePanel.classList.toggle('is-open', !open);
        });
      }
    }

    function renderCartActions() {
      var inCart = cartGetItems().indexOf(product.id) !== -1;
      actionsWrap.innerHTML =
        (inCart
          ? '<button type="button" class="btn-add-cart" id="lightbox-add-cart">View Cart</button>'
          : '<button type="button" class="btn-add-cart" id="lightbox-add-cart">Add to Cart</button>') +
        '<button type="button" class="btn-buy-now" id="lightbox-buy-now">Buy Now</button>';

      document.getElementById('lightbox-add-cart').addEventListener('click', function () {
        if (inCart) {
          closeLightbox();
          openCartDrawer();
          return;
        }
        cartAddItem(product);
        renderCartActions();
      });
      document.getElementById('lightbox-buy-now').addEventListener('click', function () {
        cartAddItem(product);
        closeLightbox();
        openCartDrawer();
      });
    }

    if (product.sold) {
      actionsWrap.innerHTML = '<button type="button" disabled>Sold Out</button>';
    } else {
      renderCartActions();
    }

    loadInterestBadge(product.id, document.getElementById('lightbox-interest'));

    var wishlistHeart = document.getElementById('lightbox-wishlist-heart');
    var wishlistTooltip = document.getElementById('lightbox-heart-tooltip');
    var wishlistPill = document.getElementById('lightbox-wishlist-pill');
    var wishlistPillLabel = document.getElementById('lightbox-wishlist-pill-label');
    function refreshHeartState() {
      var inWishlist = wishlistGetItems().indexOf(product.id) !== -1;
      wishlistHeart.classList.toggle('is-active', inWishlist);
      var label = inWishlist ? 'Remove from wishlist' : 'Add to wishlist';
      wishlistHeart.setAttribute('aria-label', label);
      if (wishlistTooltip) wishlistTooltip.textContent = inWishlist ? 'Remove from Wishlist' : 'Add to Wishlist';
      if (wishlistPill) wishlistPill.classList.toggle('is-active', inWishlist);
      if (wishlistPillLabel) wishlistPillLabel.textContent = inWishlist ? 'Remove' : 'Add to Wishlist';
    }
    refreshHeartState();
    wishlistHeart.onclick = function () {
      if (wishlistGetItems().indexOf(product.id) !== -1) {
        wishlistRemoveItem(product.id);
      } else {
        wishlistAddItem(product);
      }
      refreshHeartState();
    };
    if (wishlistPill) {
      wishlistPill.onclick = function () {
        if (wishlistGetItems().indexOf(product.id) !== -1) {
          wishlistRemoveItem(product.id);
        } else {
          wishlistAddItem(product);
        }
        refreshHeartState();
      };
    }

    zoomEnabled = false;
    stage.classList.remove('is-zoomed', 'show-zoom-hint');
    renderStage();
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    // Fade in rather than appearing instantly — same reflow-forcing
    // trick as the cart drawer fix below: display must actually be
    // applied and painted once before adding the class that animates
    // opacity, or there's no "before" state for the transition to run
    // from and it just snaps straight to visible.
    overlay.classList.remove('is-visible');
    void overlay.offsetWidth;
    overlay.classList.add('is-visible');
  };

  function closeLightbox() {
    overlay.style.display = 'none';
    overlay.classList.remove('is-visible');
    document.body.style.overflow = '';
  }

  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-close-mobile').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-thumb-up').addEventListener('click', function () { goTo(-1); });
  document.getElementById('lightbox-thumb-down').addEventListener('click', function () { goTo(1); });
  thumbTrack.addEventListener('click', function (e) {
    var btn = e.target.closest('.thumb-item');
    if (btn) goToIndex(Number(btn.getAttribute('data-index')));
  });
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeLightbox(); });

  // Hover-zoom: the first time the mouse hovers the image for this
  // saree, nothing zooms yet — a small "Click to zoom" label follows
  // the cursor instead. One click unlocks it: zooms in immediately at
  // that spot, and from then on (for as long as this saree stays
  // open, including swiping between its other photos) hovering zooms
  // normally with no more clicking. This avoids the image appearing
  // to zoom in unprompted right as the popup opens, since the cursor
  // is often already sitting over where the image renders at that
  // moment. zoomEnabled is reset to false each time openLightbox runs
  // (see below). Guarded by hasTouch — touch devices get a dedicated
  // tap-to-toggle version further down instead, since mobile browsers
  // fire a synthetic mouseenter (but not a following mouseleave)
  // after a real tap, which doesn't suit this same approach.
  var hasTouch = false;
  var zoomEnabled = false;
  var zoomHint = document.getElementById('lightbox-zoom-hint');

  function positionHint(e) {
    var r = stage.getBoundingClientRect();
    zoomHint.style.transform = 'translate(' + (e.clientX - r.left + 14) + 'px,' + (e.clientY - r.top + 14) + 'px)';
  }

  stage.addEventListener('mousemove', function (e) {
    if (hasTouch) return;
    if (!zoomEnabled) { positionHint(e); return; }
    var activeImg = stage.querySelector('img.is-active');
    if (!activeImg) return;
    var r = stage.getBoundingClientRect();
    var x = ((e.clientX - r.left) / r.width) * 100;
    var y = ((e.clientY - r.top) / r.height) * 100;
    activeImg.style.transformOrigin = x + '% ' + y + '%';
  });
  stage.addEventListener('mouseenter', function () {
    if (hasTouch) return;
    if (zoomEnabled) stage.classList.add('is-zoomed');
    else stage.classList.add('show-zoom-hint');
  });
  stage.addEventListener('mouseleave', function () {
    if (hasTouch) return;
    stage.classList.remove('is-zoomed');
    stage.classList.remove('show-zoom-hint');
  });
  stage.addEventListener('click', function (e) {
    if (hasTouch || zoomEnabled) return;
    zoomEnabled = true;
    stage.classList.remove('show-zoom-hint');
    stage.classList.add('is-zoomed');
    var activeImg = stage.querySelector('img.is-active');
    if (activeImg) {
      var r = stage.getBoundingClientRect();
      var x = ((e.clientX - r.left) / r.width) * 100;
      var y = ((e.clientY - r.top) / r.height) * 100;
      activeImg.style.transformOrigin = x + '% ' + y + '%';
    }
  });
  document.addEventListener('keydown', function (e) {
    if (overlay.style.display !== 'flex') return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') goTo(-1);
    if (e.key === 'ArrowRight') goTo(1);
  });

  // Touch swipe support for mobile — a genuine swipe (>40px) still
  // navigates between images; a tap that barely moves toggles the
  // zoom on/off instead, centred on where it was tapped.
  var touchStartX = null;
  var touchStartY = null;
  stage.addEventListener('touchstart', function (e) {
    if (!hasTouch) {
      hasTouch = true;
      stage.classList.remove('is-zoomed'); // clear any stale mouse-hover zoom, once only
    }
    touchStartX = e.changedTouches[0].clientX;
    touchStartY = e.changedTouches[0].clientY;
  }, { passive: true });
  stage.addEventListener('touchend', function (e) {
    if (touchStartX === null) return;
    var touch = e.changedTouches[0];
    var dx = touch.clientX - touchStartX;
    var dy = touch.clientY - touchStartY;
    if (Math.abs(dx) > 40) {
      goTo(dx < 0 ? 1 : -1);
    } else if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      var activeImg = stage.querySelector('img.is-active');
      if (activeImg) {
        var r = stage.getBoundingClientRect();
        var x = ((touch.clientX - r.left) / r.width) * 100;
        var y = ((touch.clientY - r.top) / r.height) * 100;
        activeImg.style.transformOrigin = x + '% ' + y + '%';
      }
      stage.classList.toggle('is-zoomed');
    }
    touchStartX = null;
    touchStartY = null;
  }, { passive: true });

  // Mouse-drag swipe support for desktop (no touchscreen)
  var mouseStartX = null;
  var isDragging = false;
  stage.addEventListener('mousedown', function (e) {
    if (hasTouch) return;
    mouseStartX = e.clientX;
    isDragging = true;
    e.preventDefault();
  });
  window.addEventListener('mouseup', function (e) {
    if (!isDragging || mouseStartX === null) return;
    isDragging = false;
    if (overlay.style.display !== 'flex') { mouseStartX = null; return; }
    var dx = e.clientX - mouseStartX;
    if (Math.abs(dx) > 40) goTo(dx < 0 ? 1 : -1);
    mouseStartX = null;
  });
}

/* ---------- Homepage: auto-scrolling series marquee ---------- */
function initHomeSeriesMarquee() {
  var track = document.getElementById('home-category-marquee');
  if (!track || typeof window.PRODUCTS === 'undefined') return;

  var tiles = SERIES_ORDER.map(function (series) {
    var items = window.PRODUCTS.filter(function (p) { return p.series === series && !p.sold; });
    if (!items.length) return null;
    var images = items.map(function (p) { return p.image; }).filter(Boolean);
    var shuffled = images.slice().sort(function () { return Math.random() - 0.5; });
    var picks = shuffled.slice(0, Math.min(5, shuffled.length));
    var desc = SERIES_DESCRIPTIONS[series] || '';
    var label = seriesTitleCase(series);
    var hoverText = seriesHoverText(series);
    var imgsHTML = picks.map(function (src, i) {
      return '<img src="' + src + '" alt="' + label + ' saree" loading="lazy" class="' + (i === 0 ? 'is-active' : '') + '">';
    }).join('');
    return (
      '<a class="category-tile" href="collections.html?series=' + encodeURIComponent(series) + '">' +
        '<div class="category-tile-media">' +
          imgsHTML +
          '<div class="tile-hover-overlay"><div><p>' + hoverText + '</p><span class="tile-explore-more">Explore more.</span></div></div>' +
        '</div>' +
        '<div class="category-tile-info">' +
          '<h3>' + label + '</h3>' +
          '<p>' + desc + '</p>' +
        '</div>' +
      '</a>'
    );
  }).filter(Boolean);

  if (!tiles.length) return;

  // Duplicate the set so the marquee track can loop seamlessly.
  track.innerHTML = tiles.join('') + tiles.join('');
  initTouchRevealTiles();

  // Cycle each tile's images independently.
  track.querySelectorAll('.category-tile-media').forEach(function (media, mediaIndex) {
    var imgs = media.querySelectorAll('img');
    if (imgs.length < 2) return;
    var idx = 0;
    var offset = (mediaIndex % 5) * 500;
    setTimeout(function () {
      setInterval(function () {
        imgs[idx].classList.remove('is-active');
        idx = (idx + 1) % imgs.length;
        imgs[idx].classList.add('is-active');
      }, 2600);
    }, offset);
  });

  var marqueeEl = document.querySelector('.category-marquee');
  if (marqueeEl) initDraggableMarquee(marqueeEl, track, { speed: 0.45 });
}

/* ---------- Homepage: 4-video showcase grid ----------
   Reads assets/videos/home-video-slots.json, an array of exactly 4
   entries. Each entry is { file, link } — or a plain filename string
   (the old format, still supported). Filled slots autoplay, muted and
   looping; a slot with a link becomes clickable and navigates there
   (new tab for external URLs). Empty slots show the Pavnika mark with
   a short authenticity note instead. Manage files AND links from the
   admin panel's videos section. */
function initHomeVideoShowcase() {
  var grid = document.getElementById('home-video-grid');
  if (!grid) return;

  var FOLDER = 'assets/videos/';
  var FALLBACK_TEXT = 'Handwoven authenticity, direct from the weaving families of Kancheepuram.';

  function normalizeSlot(s) {
    if (typeof s === 'string') return { file: s, link: '' };
    if (s && typeof s === 'object') return { file: s.file || '', link: s.link || '' };
    return { file: '', link: '' };
  }

  fetch(FOLDER + 'home-video-slots.json')
    .then(function (res) { return res.ok ? res.json() : []; })
    .then(function (slots) {
      if (!Array.isArray(slots)) slots = [];
      slots = slots.map(normalizeSlot);
      while (slots.length < 4) slots.push({ file: '', link: '' });

      grid.innerHTML = slots.slice(0, 4).map(function (slot) {
        if (slot.file) {
          var videoHTML =
            '<video src="' + FOLDER + slot.file + '" autoplay muted loop playsinline></video>';
          if (slot.link) {
            var isExternal = /^https?:\/\//i.test(slot.link);
            return (
              '<a class="home-video-tile home-video-tile-link" href="' + slot.link + '"' +
                (isExternal ? ' target="_blank" rel="noopener"' : '') +
                ' aria-label="Watch and explore">' +
                videoHTML +
              '</a>'
            );
          }
          return '<div class="home-video-tile">' + videoHTML + '</div>';
        }
        return (
          '<div class="home-video-tile">' +
            '<div class="home-video-tile-fallback">' +
              '<div class="mark">P</div>' +
              '<p>' + FALLBACK_TEXT + '</p>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    })
    .catch(function () {
      grid.innerHTML = '<div class="home-video-tile"><div class="home-video-tile-fallback"><div class="mark">P</div><p>' + FALLBACK_TEXT + '</p></div></div>'.repeat(4);
    });
}

/* ---------- Login page (index.html): email + mobile verification ---------- */
function gateGetCookie(name) {
  var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

function gateSetCookie(name, value, days) {
  var expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = name + '=' + value + '; expires=' + expires + '; path=/; SameSite=Lax';
}

function initLoginPage() {
  var root = document.getElementById('login-form-root');
  if (!root) return;

  if (gateGetCookie('pavnika_verified') === '1') {
    window.location.replace('home.html');
    return;
  }

  var sendBtn = document.getElementById('gate-send-btn');
  var verifyBtn = document.getElementById('gate-verify-btn');
  var resendBtn = document.getElementById('gate-resend-btn');
  var gateEmail = '';

  var consentBox = document.getElementById('gate-consent-checkbox');
  if (consentBox) {
    consentBox.addEventListener('change', function () {
      sendBtn.disabled = !consentBox.checked;
    });
  }
  initLegalPopup();

  function showStepCode() {
    document.getElementById('gate-step-details').style.display = 'none';
    document.getElementById('gate-step-code').style.display = 'block';
    var codeInput = document.getElementById('gate-code');
    if (codeInput) codeInput.focus();
  }

  function unlockSite() {
    gateSetCookie('pavnika_verified', '1', 90);
    gateSetCookie('pavnika_email', encodeURIComponent(gateEmail), 90);
    window.location.href = 'home.html';
  }

  function sendCode() {
    var email = document.getElementById('gate-email').value.trim();
    var errorEl = document.getElementById('gate-error-1');
    errorEl.textContent = '';

    var consentBox = document.getElementById('gate-consent-checkbox');
    if (consentBox && !consentBox.checked) {
      errorEl.textContent = 'Please agree to the Terms & Conditions and Privacy & Cookies Policy to continue.';
      return;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.textContent = 'Please enter a valid email address.';
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';

    fetch('/.netlify/functions/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok) {
          errorEl.textContent = result.data.error || 'Something went wrong. Please try again.';
          return;
        }
        gateEmail = email;
        if (result.data.alreadyVerified) {
          unlockSite();
          return;
        }
        showStepCode();
      })
      .catch(function () {
        errorEl.textContent = 'Network error. Please check your connection and try again.';
      })
      .finally(function () {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send Verification Code';
      });
  }

  function verifyCode() {
    var code = document.getElementById('gate-code').value.trim();
    var errorEl = document.getElementById('gate-error-2');
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
      body: JSON.stringify({ email: gateEmail, code: code })
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok) {
          errorEl.textContent = result.data.error || 'Incorrect code. Please try again.';
          return;
        }
        unlockSite();
      })
      .catch(function () {
        errorEl.textContent = 'Network error. Please check your connection and try again.';
      })
      .finally(function () {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify & Enter';
      });
  }

  sendBtn.addEventListener('click', sendCode);
  verifyBtn.addEventListener('click', verifyCode);
  document.getElementById('gate-code').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') verifyCode();
  });
  document.getElementById('gate-email').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendCode();
  });
  resendBtn.addEventListener('click', function () {
    resendBtn.disabled = true;
    resendBtn.textContent = 'Sending...';
    fetch('/.netlify/functions/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: gateEmail })
    })
      .finally(function () {
        setTimeout(function () {
          resendBtn.disabled = false;
          resendBtn.textContent = 'Resend code';
        }, 3000);
      });
  });
}

/* ---------- Reviews marquee (About page) ---------- */
function initReviewsMarquee() {
  var track = document.getElementById('reviews-track');
  if (!track) return;

  function starString(n) {
    var count = Math.max(0, Math.min(5, parseInt(n, 10) || 0));
    var filled = '';
    for (var i = 0; i < count; i++) filled += '\u2605';
    for (var i = count; i < 5; i++) filled += '\u2606';
    return filled;
  }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    var chars = parts.slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); });
    return chars.join('');
  }

  function buildFallbackAvatar(name) {
    var fallback = document.createElement('div');
    fallback.className = 'review-avatar-fallback';
    fallback.textContent = initials(name);
    return fallback;
  }

  function buildCard(r) {
    var card = document.createElement('div');
    card.className = 'review-card';

    var stars = document.createElement('div');
    stars.className = 'review-stars';
    stars.textContent = starString(r.stars);
    card.appendChild(stars);

    if (r.quote && r.quote.trim()) {
      var quote = document.createElement('p');
      quote.className = 'review-quote';
      quote.textContent = '\u201C' + r.quote.trim() + '\u201D';
      card.appendChild(quote);
    }

    var who = document.createElement('div');
    who.className = 'review-who';

    if (r.photo) {
      var img = document.createElement('img');
      img.className = 'review-avatar';
      img.src = r.photo;
      img.alt = r.name || '';
      img.loading = 'lazy';
      img.addEventListener('error', function () {
        who.replaceChild(buildFallbackAvatar(r.name), img);
      });
      who.appendChild(img);
    } else {
      who.appendChild(buildFallbackAvatar(r.name));
    }

    var name = document.createElement('span');
    name.className = 'review-name';
    name.textContent = r.name || '';
    who.appendChild(name);

    card.appendChild(who);
    return card;
  }

  fetch('assets/reviews/reviews.json')
    .then(function (res) { return res.ok ? res.json() : []; })
    .then(function (reviews) {
      if (!reviews || !reviews.length) return;
      var frag = document.createDocumentFragment();
      // Duplicate the list so the marquee track can loop seamlessly.
      reviews.concat(reviews).forEach(function (r) {
        frag.appendChild(buildCard(r));
      });
      track.innerHTML = '';
      track.appendChild(frag);

      // 4-line clamp + "read more" toggle for long reviews.
      track.querySelectorAll('.review-card').forEach(function (card) {
        var quoteEl = card.querySelector('.review-quote');
        if (!quoteEl) return;
        if (quoteEl.scrollHeight > quoteEl.clientHeight + 2) {
          card.classList.add('has-overflow');
          var moreBtn = document.createElement('button');
          moreBtn.type = 'button';
          moreBtn.className = 'review-read-more';
          moreBtn.textContent = 'Read more';
          moreBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var expanded = card.classList.toggle('is-expanded');
            moreBtn.textContent = expanded ? 'Show less' : 'Read more';
          });
          quoteEl.insertAdjacentElement('afterend', moreBtn);
        }
      });

      var marqueeEl = document.querySelector('.reviews-marquee');
      if (marqueeEl) initDraggableMarquee(marqueeEl, track, { speed: 0.35, reverse: true });
    })
    .catch(function () { /* silently do nothing if the manifest can't be read */ });
}

/* ---------- Homepage: hero banner carousel ----------
   Reads assets/banners/banners.json — a fixed array of 5 slots, each
   { image, mobileImage, link, hideText }. A slot with an empty "image"
   is unassigned and is skipped entirely (no blank banner is shown).
   Displays the assigned slides full-width at the top of the page,
   auto-rotating with a crossfade if there's more than one, and links
   each slide through to its "link" (or Collections by default).
   Slot assignment (which of the 5 has which image) is managed from
   the admin panel's Banners tab. */
function initHeroBannerCarousel() {
  var wrap = document.getElementById('hero-banner');
  if (!wrap) return;

  var FOLDER = 'assets/banners/';
  var DEFAULT_LINK = 'collections.html';

  fetch(FOLDER + 'banners.json')
    .then(function (res) { return res.ok ? res.json() : []; })
    .then(function (allSlots) {
      var banners = (allSlots || []).filter(function (b) { return b && b.image; });
      if (!banners.length) return;

      var slidesHTML = banners.map(function (b, i) {
        var loading = i === 0 ? 'eager' : 'lazy';
        var imgClass = b.mobileImage ? ' class="has-mobile-art"' : '';
        // <picture> lets the browser swap automatically: the portrait
        // mobile artwork below 880px, the wide desktop artwork above —
        // including live on window resize / rotation.
        var mobileSource = b.mobileImage
          ? '<source media="(max-width: 880px)" srcset="' + FOLDER + b.mobileImage + '">'
          : '';
        return (
          '<div class="hero-banner-slide' + (i === 0 ? ' is-active' : '') + '">' +
            '<picture>' + mobileSource +
              '<img src="' + FOLDER + b.image + '"' + imgClass + ' alt="Pavnika by Saranya featured banner" loading="' + loading + '">' +
            '</picture>' +
          '</div>'
        );
      }).join('');

      var dotsHTML = banners.length > 1
        ? '<div class="hero-banner-dots">' + banners.map(function (_, i) {
            return '<span class="' + (i === 0 ? 'is-active' : '') + '"></span>';
          }).join('') + '</div>'
        : '';

      var navHTML = banners.length > 1
        ? '<div class="hero-banner-nav">' +
            '<button type="button" class="hero-banner-nav-btn" data-dir="-1" aria-label="Previous banner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>' +
            '<button type="button" class="hero-banner-nav-btn" data-dir="1" aria-label="Next banner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>' +
          '</div>'
        : '';

      wrap.innerHTML = slidesHTML + dotsHTML + navHTML;

      // Desktop-only clickable layer over the right half of the banner
      // (the image area beyond the text column). Its href always points
      // to the ACTIVE slide's admin-configured link, falling back to
      // Collections. Hidden on mobile via CSS.
      var clickLink = document.createElement('a');
      clickLink.className = 'hero-banner-click';
      clickLink.setAttribute('aria-label', 'Open this banner\'s collection');
      var pinnedEl = document.getElementById('hero-banner-pinned');
      function syncClickHref(i) {
        clickLink.href = (banners[i] && banners[i].link) || DEFAULT_LINK;
        // Per-banner "hide text" mode (admin checkbox): fade the text +
        // buttons out with the same 1s ease the slides use, and let the
        // click layer cover the WHOLE banner instead of the right half.
        var hide = !!(banners[i] && banners[i].hideText);
        if (pinnedEl) pinnedEl.classList.toggle('text-hidden', hide);
      }
      syncClickHref(0);
      wrap.appendChild(clickLink);

      if (banners.length > 1) {
        var slides = wrap.querySelectorAll('.hero-banner-slide');
        var dots = wrap.querySelectorAll('.hero-banner-dots span');
        var idx = 0;
        var timer = null;

        // First banner shows for 3s, every banner after that for 5s.
        function durationFor(i) { return i === 0 ? 3000 : 5000; }

        function showSlide(newIdx) {
          slides[idx].classList.remove('is-active');
          dots[idx].classList.remove('is-active');
          idx = (newIdx + slides.length) % slides.length;
          slides[idx].classList.add('is-active');
          dots[idx].classList.add('is-active');
          syncClickHref(idx);
        }

        function scheduleNext() {
          clearTimeout(timer);
          timer = setTimeout(function () {
            showSlide(idx + 1);
            scheduleNext();
          }, durationFor(idx));
        }

        wrap.querySelectorAll('.hero-banner-nav-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            showSlide(idx + parseInt(btn.getAttribute('data-dir'), 10));
            scheduleNext(); // manual navigation resets the auto-advance timer
          });
        });

        scheduleNext();
      }
    })
    .catch(function () { /* silently do nothing if the manifest can't be read */ });
}

/* ---------- FAQ accordion ---------- */
function initFaqAccordion() {
  var items = document.querySelectorAll('.faq-item');
  if (!items.length) return;

  items.forEach(function (item) {
    var question = item.querySelector('.faq-question');
    var answer = item.querySelector('.faq-answer');
    question.addEventListener('click', function () {
      var isOpen = item.classList.contains('is-open');
      items.forEach(function (other) {
        other.classList.remove('is-open');
        other.querySelector('.faq-answer').style.maxHeight = null;
      });
      if (!isOpen) {
        item.classList.add('is-open');
        answer.style.maxHeight = answer.scrollHeight + 'px';
      }
    });
  });
}

/* ---------- Account menu (top-right dropdown) ---------- */
function initAccountMenu() {
  var accountBtn = document.getElementById('nav-account-btn');
  var dropdown = document.getElementById('account-dropdown');
  var emailEl = document.getElementById('account-email');
  var logoutBtn = document.getElementById('account-logout');
  if (!accountBtn || !dropdown) return;

  var email = gateGetCookie('pavnika_email');
  var decodedEmail = email ? decodeURIComponent(email) : '';
  if (emailEl) {
    emailEl.textContent = decodedEmail || 'Guest';
  }

  if (decodedEmail === 'pavnikabysaranya@gmail.com') {
    var adminLink = document.createElement('a');
    adminLink.href = 'admin.html';
    adminLink.className = 'account-admin-link';
    adminLink.textContent = 'Admin Panel';
    dropdown.insertBefore(adminLink, dropdown.querySelector('.account-divider'));
  }

  accountBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    dropdown.classList.toggle('is-open');
  });

  document.addEventListener('click', function (e) {
    if (!dropdown.contains(e.target) && e.target !== accountBtn) {
      dropdown.classList.remove('is-open');
    }
  });

  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      gateSetCookie('pavnika_verified', '', -1);
      gateSetCookie('pavnika_email', '', -1);
      window.location.href = 'index.html';
    });
  }

  // Mobile: the account icon is hidden, so Logout lives in the burger
  // dropdown instead (inserted before the Book Appointment pill).
  var mainNav = document.querySelector('nav.main-nav');
  if (mainNav && !document.getElementById('nav-logout-link')) {
    var lg = document.createElement('a');
    lg.href = '#';
    lg.id = 'nav-logout-link';
    lg.className = 'nav-logout-link';
    lg.textContent = 'Logout';
    lg.addEventListener('click', function (e) {
      e.preventDefault();
      gateSetCookie('pavnika_verified', '', -1);
      gateSetCookie('pavnika_email', '', -1);
      window.location.href = 'index.html';
    });
    var cta = mainNav.querySelector('.nav-cta');
    if (cta) mainNav.insertBefore(lg, cta);
    else mainNav.appendChild(lg);
  }
}

/* ---------- Site-wide saree search (frosted-glass panel) ---------- */
function initSearchPanel() {
  var searchBtn = document.getElementById('nav-search-btn');
  var panel = document.getElementById('search-panel');
  var closeBtn = document.getElementById('search-close');
  var input = document.getElementById('search-input');
  var resultsWrap = document.getElementById('search-results');
  var emptyMsg = document.getElementById('search-empty');
  if (!searchBtn || !panel) return;

  function openPanel() {
    var header = document.querySelector('.site-header');
    var top = header ? header.getBoundingClientRect().bottom : 0;
    panel.style.top = top + 'px';
    panel.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { input.focus(); }, 50);
  }

  function closePanel() {
    panel.classList.remove('is-open');
    document.body.style.overflow = '';
    input.value = '';
    resultsWrap.innerHTML = '';
    emptyMsg.style.display = 'none';
  }

  searchBtn.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.classList.contains('is-open')) closePanel();
  });

  function renderResults(query) {
    if (typeof window.PRODUCTS === 'undefined') return;
    var q = query.trim().toLowerCase();
    resultsWrap.innerHTML = '';
    if (!q) {
      emptyMsg.style.display = 'none';
      return;
    }

    var fields = ['id', 'design', 'type', 'sareeType', 'pattern', 'series', 'category'];
    var matches = window.PRODUCTS.filter(function (p) {
      if (p.sold) return false;
      return fields.some(function (f) {
        return p[f] && String(p[f]).toLowerCase().indexOf(q) !== -1;
      });
    }).slice(0, 30);

    emptyMsg.style.display = matches.length ? 'none' : 'block';

    matches.forEach(function (p) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'search-result-row';

      var img = document.createElement('img');
      img.src = p.image;
      img.alt = p.design;
      row.appendChild(img);

      var info = document.createElement('div');
      info.className = 'search-result-info';
      var title = document.createElement('span');
      title.className = 'r-design';
      title.textContent = p.design + ' — ' + p.id;
      var meta = document.createElement('span');
      meta.className = 'r-meta';
      meta.textContent = p.type + ' · ' + p.pattern + ' · ' + seriesTitleCase(p.series);
      info.appendChild(title);
      info.appendChild(meta);
      row.appendChild(info);

      row.addEventListener('click', function () {
        var query = input.value.trim();
        window.location.href = 'collections.html?q=' + encodeURIComponent(query) + '&open=' + encodeURIComponent(p.id);
      });

      resultsWrap.appendChild(row);
    });
  }

  input.addEventListener('input', function () { renderResults(input.value); });
}

/* ---------- Legal popup on the login page ----------
   Fetches the real Terms & Conditions / Privacy & Cookies Policy pages
   and shows just their content inline, in a frosted-glass popup, so a
   visitor can read them without leaving the login screen. Reads from
   the actual pages rather than duplicating their text, so there's only
   ever one place the content needs to be kept up to date. */
function initLegalPopup() {
  var popup = document.getElementById('legal-popup');
  var popupBody = document.getElementById('legal-popup-body');
  var closeBtn = document.getElementById('legal-popup-close');
  if (!popup) return;

  var cache = {};

  function openPopup(page) {
    popup.classList.add('is-open');
    popupBody.innerHTML = '<p style="text-align:center; opacity:0.7;">Loading…</p>';

    if (cache[page]) {
      popupBody.innerHTML = cache[page];
      return;
    }

    fetch(page)
      .then(function (res) { return res.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var content = doc.querySelector('.legal-content');
        var inner = content ? content.innerHTML : '<p>Sorry, this couldn\'t be loaded right now.</p>';
        cache[page] = inner;
        popupBody.innerHTML = inner;
      })
      .catch(function () {
        popupBody.innerHTML = '<p>Sorry, this couldn\'t be loaded right now. Please try again.</p>';
      });
  }

  function closePopup() {
    popup.classList.remove('is-open');
  }

  document.querySelectorAll('.gate-legal-link').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      openPopup(link.getAttribute('data-page'));
    });
  });

  closeBtn.addEventListener('click', closePopup);
  popup.addEventListener('click', function (e) { if (e.target === popup) closePopup(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && popup.classList.contains('is-open')) closePopup();
  });
}

/* ---------- Cart drawer (site-wide) ----------
   Cart contents live in localStorage as a simple list of saree IDs —
   since every saree is a one-off piece, quantity is always 1 per item,
   so the cart is really just a set of IDs, not a quantity-per-item cart.
   Actual checkout isn't wired to a payment provider yet, so the drawer's
   checkout button sends the cart as a WhatsApp message for now — this
   keeps the feature fully useful on its own before online payment
   (a future phase) is added. */
var CART_STORAGE_KEY = 'pavnika_cart';
var WISHLIST_STORAGE_KEY = 'pavnika_wishlist';

function cartGetItems() {
  try {
    var raw = localStorage.getItem(CART_STORAGE_KEY);
    var ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids : [];
  } catch (e) {
    return [];
  }
}

function cartSaveItems(ids) {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(ids));
  } catch (e) { /* ignore storage errors (e.g. private browsing) */ }
}

function cartAddItem(product) {
  var ids = cartGetItems();
  if (ids.indexOf(product.id) === -1) {
    ids.push(product.id);
    cartSaveItems(ids);
    fetch('/.netlify/functions/log-cart-activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id })
    }).catch(function () {});
  }
  renderCartDrawer();
  renderWishlistDrawer(); // keep wishlist "View Cart"/"Add to Cart" buttons in sync — the cart can change from several places (cart drawer, this wishlist itself, the saree detail popup), not just the wishlist's own button
}

function cartRemoveItem(id) {
  var ids = cartGetItems().filter(function (x) { return x !== id; });
  cartSaveItems(ids);
  renderCartDrawer();
  renderWishlistDrawer(); // same reasoning as cartAddItem above — this is exactly the path that was going stale (remove via the cart drawer left an already-open/already-rendered wishlist showing "View Cart" for an item no longer in the cart)
}

function openCartDrawer() {
  var overlay = document.getElementById('cart-drawer-overlay');
  if (overlay) overlay.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function closeCartDrawer() {
  var overlay = document.getElementById('cart-drawer-overlay');
  if (overlay) overlay.classList.remove('is-open');
  document.body.style.overflow = '';
}

// ---------- Wishlist ----------
// Same storage pattern as the cart — kept in the visitor's own browser
// (localStorage), not a database, so it's per-device, same trade-off
// the cart already has.
function wishlistGetItems() {
  try {
    var raw = localStorage.getItem(WISHLIST_STORAGE_KEY);
    var ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids : [];
  } catch (e) {
    return [];
  }
}

function wishlistSaveItems(ids) {
  try {
    localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(ids));
  } catch (e) { /* ignore storage errors (e.g. private browsing) */ }
}

function wishlistAddItem(product) {
  var ids = wishlistGetItems();
  if (ids.indexOf(product.id) === -1) {
    ids.push(product.id);
    wishlistSaveItems(ids);
  }
  renderWishlistDrawer();
}

function wishlistRemoveItem(id) {
  var ids = wishlistGetItems().filter(function (x) { return x !== id; });
  wishlistSaveItems(ids);
  renderWishlistDrawer();
}

function openWishlistDrawer() {
  var overlay = document.getElementById('wishlist-drawer-overlay');
  renderWishlistDrawer(); // always reflect current cart state the moment it's actually opened, not whatever it happened to show last time it rendered
  if (overlay) overlay.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function closeWishlistDrawer() {
  var overlay = document.getElementById('wishlist-drawer-overlay');
  if (overlay) overlay.classList.remove('is-open');
  document.body.style.overflow = '';
}

function initWishlistDrawer() {
  var wishlistBtn = document.getElementById('nav-wishlist-btn');
  if (document.getElementById('wishlist-drawer-overlay')) {
    renderWishlistDrawer();
    return;
  }

  var overlay = document.createElement('div');
  overlay.className = 'wishlist-drawer-overlay';
  overlay.id = 'wishlist-drawer-overlay';
  overlay.innerHTML =
    '<div class="wishlist-drawer">' +
      '<div class="wishlist-drawer-header">' +
        '<h3>Your Wishlist</h3>' +
        '<button type="button" class="cart-drawer-close" id="wishlist-drawer-close" aria-label="Close wishlist">&times;</button>' +
        '<button type="button" class="cart-drawer-close-mobile" id="wishlist-drawer-close-mobile" aria-label="Close wishlist">Close</button>' +
      '</div>' +
      '<div class="wishlist-drawer-items" id="wishlist-drawer-items-wrap"></div>' +
    '</div>';
  document.body.appendChild(overlay);

  if (wishlistBtn) wishlistBtn.addEventListener('click', openWishlistDrawer);
  document.getElementById('wishlist-drawer-close').addEventListener('click', closeWishlistDrawer);
  document.getElementById('wishlist-drawer-close-mobile').addEventListener('click', closeWishlistDrawer);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeWishlistDrawer(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeWishlistDrawer();
  });

  renderWishlistDrawer();
}

function renderWishlistDrawer() {
  var badge = document.getElementById('nav-wishlist-badge');
  var bbBadge = document.getElementById('bb-wishlist-badge');
  var itemsWrap = document.getElementById('wishlist-drawer-items-wrap');

  var ids = wishlistGetItems();
  if (badge) {
    badge.style.display = ids.length ? 'flex' : 'none';
    badge.textContent = ids.length;
  }
  if (bbBadge) {
    bbBadge.style.display = ids.length ? 'flex' : 'none';
    bbBadge.textContent = ids.length;
  }

  if (!itemsWrap) return;

  if (!ids.length) {
    itemsWrap.innerHTML = '<p class="cart-drawer-empty">Your wishlist is empty. Tap the heart on any saree to save it here.</p>';
    return;
  }

  var products = (window.PRODUCTS || []).filter(function (p) { return ids.indexOf(p.id) !== -1; });
  var cartIds = cartGetItems();

  itemsWrap.innerHTML = '<div class="wishlist-grid">' + products.map(function (p) {
    var soldRibbon = p.sold ? '<div class="wl-sold-ribbon"><span>Sold Out</span></div>' : '';
    var inCart = cartIds.indexOf(p.id) !== -1;
    var addCartBtn = p.sold
      ? '<button type="button" class="wl-add-btn" disabled>Sold Out</button>'
      : '<button type="button" class="wl-add-btn' + (inCart ? ' is-in-cart' : '') + '" data-id="' + p.id + '">' + (inCart ? 'View Cart' : 'Add to Cart') + '</button>';
    return (
      '<div class="wl-card">' +
        '<img src="' + p.image + '" alt="' + p.design + '" class="wl-item-img" data-id="' + p.id + '" role="button" tabindex="0" aria-label="View ' + (p.material || p.design) + '">' +
        soldRibbon +
        '<button type="button" class="wl-trash" data-id="' + p.id + '" aria-label="Remove from wishlist">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>' +
        '</button>' +
        '<div class="wl-info">' +
          '<span class="wl-name">' + (p.material || p.design) + ' — ' + p.id + '</span>' +
          '<span class="wl-price">AED ' + formatAED(p.price) + '</span>' +
          addCartBtn +
        '</div>' +
      '</div>'
    );
  }).join('') + '</div>';

  itemsWrap.querySelectorAll('.wl-trash').forEach(function (btn) {
    btn.addEventListener('click', function () { wishlistRemoveItem(btn.getAttribute('data-id')); });
  });

  // "Add to Cart" persists as "View Cart" once the saree is actually in
  // the cart, same as the saree detail popup already does — no more
  // flashing "Added" text that quietly reverts a second later, which
  // looked like a glitch since it didn't reflect the real state.
  itemsWrap.querySelectorAll('.wl-add-btn:not(:disabled)').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-id');
      if (cartGetItems().indexOf(id) !== -1) {
        closeWishlistDrawer();
        openCartDrawer();
        return;
      }
      var product = (window.PRODUCTS || []).find(function (p) { return p.id === id; });
      if (product) {
        cartAddItem(product);
        btn.textContent = 'View Cart';
        btn.classList.add('is-in-cart');
      }
    });
  });

  // Clicking a wishlist photo opens its full saree detail popup, same
  // as the cart's photo-click behavior — closing the drawer first.
  itemsWrap.querySelectorAll('.wl-item-img').forEach(function (img) {
    function openFromWishlist() {
      var product = (window.PRODUCTS || []).find(function (p) { return p.id === img.getAttribute('data-id'); });
      if (product) {
        closeWishlistDrawer();
        window.openLightbox(product);
      }
    }
    img.addEventListener('click', openFromWishlist);
    img.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFromWishlist(); } });
  });
}

// ---------- Mobile-only bottom navigation bar ----------
// Home / Shop / Search / Bag, fixed to the bottom of the screen on
// mobile widths only (see the max-width:880px rule in style.css — the
// same breakpoint the header's own hamburger menu switches on at).
// Built once, globally, on every page — same pattern as the cart
// drawer and lightbox popup.
function initMobileBottomBar() {
  if (document.getElementById('mobile-bottom-bar')) return;

  var path = window.location.pathname;
  var isHome = /(^|\/)(home\.html)?$/i.test(path) || /\/$/i.test(path);
  var isCollections = /collections\.html$/i.test(path);

  var bar = document.createElement('nav');
  bar.id = 'mobile-bottom-bar';
  bar.className = 'mobile-bottom-bar';
  bar.setAttribute('aria-label', 'Primary');
  bar.innerHTML =
    '<a href="home.html" class="bb-item' + (isHome ? ' is-active' : '') + '">' +
      '<span class="bb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"/></svg></span>' +
      '<span class="bb-label">Home</span>' +
    '</a>' +
    '<a href="collections.html" class="bb-item' + (isCollections ? ' is-active' : '') + '">' +
      '<span class="bb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span>' +
      '<span class="bb-label">Shop</span>' +
    '</a>' +
    '<button type="button" class="bb-item" id="bb-wishlist-btn">' +
      '<span class="bb-icon" style="position:relative;">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0 5.4 5.4 0 0 0 0 7.65l8.42 8.42 8.42-8.42a5.4 5.4 0 0 0 0-7.65z"/></svg>' +
        '<span class="bb-badge" id="bb-wishlist-badge" style="display:none;">0</span>' +
      '</span>' +
      '<span class="bb-label">Wishlist</span>' +
    '</button>' +
    '<button type="button" class="bb-item" id="bb-bag-btn">' +
      '<span class="bb-icon bb-icon-bag">' +
        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>' +
        '<span class="bb-badge" id="bb-bag-badge" style="display:none;">0</span>' +
      '</span>' +
      '<span class="bb-label">Cart</span>' +
    '</button>';
  document.body.appendChild(bar);

  document.getElementById('bb-wishlist-btn').addEventListener('click', function () {
    openWishlistDrawer();
  });

  document.getElementById('bb-bag-btn').addEventListener('click', function () {
    openCartDrawer();
  });

  renderCartDrawer(); // sync the Cart badge to the current cart immediately
  renderWishlistDrawer(); // sync the Wishlist badge to the current wishlist immediately
}

function renderCartDrawer() {
  var badge = document.getElementById('nav-cart-badge');
  var itemsWrap = document.getElementById('cart-drawer-items-wrap');
  var footer = document.getElementById('cart-drawer-footer');
  if (!badge) return;

  var ids = cartGetItems();
  badge.style.display = ids.length ? 'flex' : 'none';
  badge.textContent = ids.length;

  var bbBadge = document.getElementById('bb-bag-badge');
  if (bbBadge) {
    bbBadge.style.display = ids.length ? 'flex' : 'none';
    bbBadge.textContent = ids.length;
  }

  if (!itemsWrap) return;

  if (!ids.length) {
    itemsWrap.innerHTML =
      '<p class="cart-drawer-empty">Your cart is empty. Browse the collection to find something you love.</p>' +
      continueShoppingHTML();
    bindContinueShopping();
    if (footer) footer.style.display = 'none';
    return;
  }

  var products = (window.PRODUCTS || []).filter(function (p) { return ids.indexOf(p.id) !== -1; });
  var subtotal = products.reduce(function (sum, p) { return sum + (Number(p.price) || 0); }, 0);

  itemsWrap.innerHTML = products.map(function (p) {
    return (
      '<div class="cart-drawer-item">' +
        '<img src="' + p.image + '" alt="' + p.design + '" class="cart-item-img" data-id="' + p.id + '" role="button" tabindex="0" aria-label="View ' + (p.material || p.design) + '">' +
        '<div class="item-info">' +
          '<span class="item-design">' + (p.material || p.design) + ' — ' + p.id + '</span>' +
          '<span class="item-series">' + seriesTitleCase(p.series) + '</span>' +
          '<button type="button" class="item-remove" data-id="' + p.id + '">Remove</button>' +
        '</div>' +
        '<span class="item-price">AED ' + formatAED(p.price) + '</span>' +
      '</div>'
    );
  }).join('') +
    continueShoppingHTML() +
    '<div class="cart-order-summary">' +
      '<h4>Order Summary</h4>' +
      '<div class="os-row"><span>Subtotal (' + products.length + (products.length === 1 ? ' item' : ' items') + ')</span><span>AED ' + formatAED(subtotal) + '</span></div>' +
      '<div class="os-row"><span>Shipping</span><span class="os-free">Free</span></div>' +
      '<div class="os-row os-total"><span>Total</span><span>AED ' + formatAED(subtotal) + '</span></div>' +
    '</div>';
  bindContinueShopping();

  // Clicking (or tapping/Enter-ing) a cart item's photo opens its full
  // saree detail popup, same as clicking it from the Collections grid.
  itemsWrap.querySelectorAll('.cart-item-img').forEach(function (img) {
    function openFromCart() {
      var product = (window.PRODUCTS || []).find(function (p) { return p.id === img.getAttribute('data-id'); });
      if (product) {
        closeCartDrawer();
        window.openLightbox(product);
      }
    }
    img.addEventListener('click', openFromCart);
    img.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFromCart(); } });
  });

  if (footer) footer.style.display = 'block';
}

/* Continue Shopping lives inside the cart body (below the total when the
   cart has items, below the empty-state text otherwise), so it's rebuilt
   and re-bound on every render. Goes to Collections — or, if the user is
   already on the Collections page, simply closes the drawer. */
function continueShoppingHTML() {
  return '<a href="collections.html" class="cart-continue-sm" id="cart-continue-btn">&larr;&nbsp; Continue Shopping</a>';
}
function bindContinueShopping() {
  var btn = document.getElementById('cart-continue-btn');
  if (!btn) return;
  btn.addEventListener('click', function (e) {
    var path = window.location.pathname;
    if (/collections\.html$/i.test(path) || /\/collections\/?$/i.test(path)) {
      e.preventDefault();
      closeCartDrawer();
    }
  });
}

function initCartDrawer() {
  var cartBtn = document.getElementById('nav-cart-btn');
  if (!cartBtn || document.getElementById('cart-drawer-overlay')) {
    renderCartDrawer();
    return;
  }

  var overlay = document.createElement('div');
  overlay.className = 'cart-drawer-overlay';
  overlay.id = 'cart-drawer-overlay';
  overlay.innerHTML =
    '<div class="cart-drawer">' +
      '<div class="cart-drawer-header">' +
        '<h3>Your Cart</h3>' +
        '<button type="button" class="cart-drawer-close" id="cart-drawer-close" aria-label="Close cart">&times;</button>' +
        '<button type="button" class="cart-drawer-close-mobile" id="cart-drawer-close-mobile" aria-label="Close cart">Close</button>' +
      '</div>' +
      '<div class="cart-drawer-items" id="cart-drawer-items-wrap"></div>' +
      '<div class="cart-drawer-footer" id="cart-drawer-footer" style="display:none;">' +
        '<a href="checkout.html" class="btn btn-primary" id="cart-proceed-btn" style="display:block; text-align:center; margin-bottom:10px;">Proceed to Checkout</a>' +
        '<button type="button" class="btn btn-ghost" id="cart-checkout-btn" style="width:100%;">Checkout via WhatsApp</button>' +
        '<p>Proceed to Checkout for a full order review, or checkout directly via WhatsApp.</p>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  cartBtn.addEventListener('click', openCartDrawer);
  document.getElementById('cart-drawer-close').addEventListener('click', closeCartDrawer);
  document.getElementById('cart-drawer-close-mobile').addEventListener('click', closeCartDrawer);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeCartDrawer(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeCartDrawer();
  });

  overlay.addEventListener('click', function (e) {
    var removeBtn = e.target.closest('.item-remove');
    if (removeBtn) cartRemoveItem(removeBtn.getAttribute('data-id'));
  });

  document.getElementById('cart-checkout-btn').addEventListener('click', function () {
    var ids = cartGetItems();
    if (!ids.length) return;
    var products = (window.PRODUCTS || []).filter(function (p) { return ids.indexOf(p.id) !== -1; });
    var lines = products.map(function (p) { return '- ' + seriesTitleCase(p.series) + ' (' + p.id + ') — ' + (p.material || p.design); });
    var total = products.reduce(function (sum, p) { return sum + (Number(p.price) || 0); }, 0);
    var msg = 'Hi Pavnika by Saranya, I would like to purchase the following sarees from my cart:\n' + lines.join('\n');
    msg += '\n\nTotal: AED ' + formatAED(total);
    window.open('https://wa.me/971526630307?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  });

  renderCartDrawer();
}

/* ---------- Checkout page ---------- */
function initCheckoutPage() {
  var emptyEl = document.getElementById('checkout-empty');
  var contentEl = document.getElementById('checkout-content');
  var itemsEl = document.getElementById('checkout-items');
  var subtotalEl = document.getElementById('checkout-subtotal');
  var discountRow = document.getElementById('checkout-discount-row');
  var discountLabel = document.getElementById('checkout-discount-label');
  var discountAmountEl = document.getElementById('checkout-discount-amount');
  var totalEl = document.getElementById('checkout-total');
  if (!emptyEl || !contentEl) return;

  var ids = cartGetItems();
  var products = (window.PRODUCTS || []).filter(function (p) { return ids.indexOf(p.id) !== -1; });

  if (!products.length) {
    emptyEl.style.display = 'block';
    contentEl.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  contentEl.style.display = 'block';

  var subtotal = products.reduce(function (sum, p) { return sum + (Number(p.price) || 0); }, 0);

  itemsEl.innerHTML = products.map(function (p) {
    return (
      '<div class="checkout-item">' +
        '<img src="' + p.image + '" alt="' + p.design + '">' +
        '<div class="item-info">' +
          '<span class="item-design">' + (p.material || p.design) + ' — ' + p.id + '</span>' +
          '<span class="item-series">' + seriesTitleCase(p.series) + '</span>' +
        '</div>' +
        '<span class="item-price">AED ' + formatAED(p.price) + '</span>' +
      '</div>'
    );
  }).join('');

  subtotalEl.textContent = formatAED(subtotal);
  totalEl.textContent = formatAED(subtotal);

  // Populate both country dropdowns, UAE first (and selected by default).
  var billingCountrySelect = document.getElementById('billing-country');
  var shippingCountrySelect = document.getElementById('shipping-country');
  [billingCountrySelect, shippingCountrySelect].forEach(function (select) {
    select.innerHTML = COUNTRY_LIST.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
  });

  // Phone: the country code + number split is purely a UX convenience —
  // reuses the same PHONE_COUNTRY_CODES list as the appointment form.
  // Whatever the visitor picks/types, this reconstructs the exact same
  // "+971501234567" (E.164, no spaces) format into the hidden
  // #checkout-phone field, which is what the rest of this function
  // (validation, the Nomod payload) already reads — so nothing
  // downstream needed to change at all.
  var phoneCodeSelect = document.getElementById('checkout-phone-code');
  var phoneNumberInput = document.getElementById('checkout-phone-number');
  var phoneHiddenInput = document.getElementById('checkout-phone');
  phoneCodeSelect.innerHTML = PHONE_COUNTRY_CODES.map(function (c, i) {
    return '<option value="' + c.code + '"' + (i === 0 ? ' selected' : '') + '>' + c.label + '</option>';
  }).join('');

  var phoneNote = document.createElement('p');
  phoneNote.className = 'field-note';
  phoneNote.style.display = 'none';
  phoneNumberInput.insertAdjacentElement('afterend', phoneNote);

  function syncPhone() {
    var codeEntry = PHONE_COUNTRY_CODES.find(function (c) { return c.code === phoneCodeSelect.value; });
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
    phoneHiddenInput.value = full;

    if (!digits) { // empty: neutral until submit, same as every other field here
      phoneNote.style.display = 'none';
      phoneNumberInput.classList.remove('field-invalid');
      return true;
    }
    if (!PHONE_RE.test(full)) {
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
  phoneNumberInput._pavnikaCheck = syncPhone;
  phoneCodeSelect.addEventListener('change', syncPhone);
  phoneNumberInput.addEventListener('input', syncPhone);
  syncPhone();

  var sameAddressBox = document.getElementById('checkout-same-address');
  var shippingBlock = document.getElementById('checkout-shipping-block');
  sameAddressBox.addEventListener('change', function () {
    shippingBlock.style.display = sameAddressBox.checked ? 'none' : 'block';
  });

  // Live UAE-shipping check: online payment/direct shipping is UAE
  // only. Which country actually governs that depends on whether
  // "Ship to the same address" is checked — same rule the submit
  // handler below already used, just now applied live as the visitor
  // picks a country, instead of only being caught at the last moment
  // when they click Pay Online.
  var addressMsgLive = document.getElementById('checkout-address-msg');
  function checkUAEShipping() {
    var effectiveCountry = sameAddressBox.checked
      ? billingCountrySelect.value
      : shippingCountrySelect.value;
    var payOnlineBtn = document.getElementById('checkout-pay-online');

    // Only warn once a country has actually been chosen — an empty/
    // not-yet-selected value shouldn't show this prematurely.
    if (effectiveCountry && effectiveCountry !== 'United Arab Emirates') {
      addressMsgLive.className = 'checkout-promo-msg error';
      addressMsgLive.innerHTML = 'We currently offer online payment and direct shipping within the UAE only. For international orders, please <a href="' + buildOrderWhatsAppUrl() + '" target="_blank" rel="noopener" style="text-decoration:underline;">continue via WhatsApp</a> so we can arrange shipping and payment together.';
      payOnlineBtn.style.pointerEvents = 'none';
      payOnlineBtn.style.opacity = '0.5';
      payOnlineBtn.setAttribute('aria-disabled', 'true');
    } else {
      addressMsgLive.className = 'checkout-promo-msg';
      addressMsgLive.textContent = '';
      payOnlineBtn.style.pointerEvents = '';
      payOnlineBtn.style.opacity = '';
      payOnlineBtn.removeAttribute('aria-disabled');
    }
  }
  billingCountrySelect.addEventListener('change', checkUAEShipping);
  shippingCountrySelect.addEventListener('change', checkUAEShipping);
  sameAddressBox.addEventListener('change', checkUAEShipping);
  checkUAEShipping();

  var appliedDiscount = 0;
  var appliedCode = '';

  function currentTotal() {
    return Math.round(subtotal * (1 - appliedDiscount / 100));
  }

  function updateSummary() {
    if (appliedDiscount > 0) {
      var discountAmount = subtotal - currentTotal();
      discountLabel.textContent = appliedCode + ' (' + appliedDiscount + '% off)';
      discountAmountEl.textContent = '-AED ' + formatAED(discountAmount);
      discountRow.style.display = 'flex';
    } else {
      discountRow.style.display = 'none';
    }
    totalEl.textContent = formatAED(currentTotal());
  }

  document.getElementById('checkout-promo-apply').addEventListener('click', function () {
    var input = document.getElementById('checkout-promo-input');
    var msg = document.getElementById('checkout-promo-msg');
    var applyBtn = document.getElementById('checkout-promo-apply');
    var code = input.value.trim();

    if (!code) {
      msg.className = 'checkout-promo-msg error';
      msg.textContent = 'Please enter a code.';
      return;
    }
    if (appliedCode) {
      msg.className = 'checkout-promo-msg error';
      msg.textContent = 'A code has already been applied to this order.';
      return;
    }

    applyBtn.disabled = true;
    applyBtn.textContent = 'Checking...';

    fetch('/.netlify/functions/validate-promo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    })
      .then(function (res) { return res.json(); })
      .then(function (result) {
        if (!result.valid) {
          msg.className = 'checkout-promo-msg error';
          msg.textContent = result.error || 'That code is not valid.';
          return;
        }
        appliedDiscount = result.discountPercent;
        appliedCode = result.code;
        msg.className = 'checkout-promo-msg success';
        msg.textContent = appliedCode + ' applied — ' + appliedDiscount + '% off.';
        updateSummary();
        input.disabled = true;
        applyBtn.style.display = 'none';
      })
      .catch(function () {
        msg.className = 'checkout-promo-msg error';
        msg.textContent = 'Network error — please try again.';
      })
      .finally(function () {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply';
      });
  });

  function readAddress(prefix) {
    return {
      building: document.getElementById(prefix + '-building').value.trim(),
      street: document.getElementById(prefix + '-street').value.trim(),
      city: document.getElementById(prefix + '-city').value.trim(),
      state: document.getElementById(prefix + '-state').value.trim(),
      pincode: document.getElementById(prefix + '-pincode').value.trim(),
      country: document.getElementById(prefix + '-country').value
    };
  }

  function addressIsComplete(addr) {
    return addr.building && addr.street && addr.city && addr.state && addr.pincode && addr.country;
  }

  /* ---- Live validation for Nomod-bound customer fields ----
     Nomod's API rejects anything but letters in name fields (its own
     error: "Customer names can only include letters ... without numbers
     or special characters" — spaces included, verified empirically),
     and expects phones in international E.164 format. Validating live
     here means the customer sees a clear note under the field instead
     of a generic "Could not start payment" after the API rejects it. */
  var NAME_RE = /^[A-Za-z\u00C0-\u024F]+$/; // letters only (incl. accented), no spaces/digits/specials
  var PHONE_RE = /^\+[1-9][0-9]{6,14}$/;      // E.164: + then 7-15 digits

  function attachFieldNote(inputId, validate) {
    var input = document.getElementById(inputId);
    if (!input) return;
    var note = document.createElement('p');
    note.className = 'field-note';
    note.style.display = 'none';
    input.insertAdjacentElement('afterend', note);
    function check() {
      var v = input.value.trim();
      if (!v) { // empty: neutral until submit
        note.style.display = 'none';
        input.classList.remove('field-invalid');
        return true;
      }
      var msg = validate(v);
      if (msg) {
        note.textContent = msg;
        note.classList.remove('ok');
        note.style.display = 'block';
        input.classList.add('field-invalid');
        return false;
      }
      note.textContent = '\u2713 Looks good';
      note.classList.add('ok');
      note.style.display = 'block';
      input.classList.remove('field-invalid');
      return true;
    }
    input.addEventListener('input', check);
    input._pavnikaCheck = check;
    return input;
  }

  function validateName(v) {
    if (!NAME_RE.test(v)) {
      return 'Letters only \u2014 our payment provider does not accept spaces, numbers or special characters in this field.';
    }
    return '';
  }

  attachFieldNote('checkout-first-name', validateName);
  attachFieldNote('checkout-last-name', validateName);
  // Phone validation/feedback is handled by syncPhone() above, attached
  // to the visible #checkout-phone-number field rather than the hidden
  // reconstructed #checkout-phone value.

  function customerFieldsValid() {
    var ids = ['checkout-first-name', 'checkout-last-name', 'checkout-phone-number'];
    var allOk = true;
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el._pavnikaCheck && !el._pavnikaCheck()) allOk = false;
    });
    return allOk;
  }

  document.getElementById('checkout-pay-online').addEventListener('click', function (e) {
    e.preventDefault();
    var payBtn = document.getElementById('checkout-pay-online');
    var addressMsg = document.getElementById('checkout-address-msg');
    addressMsg.className = 'checkout-promo-msg';
    addressMsg.textContent = '';

    var firstName = document.getElementById('checkout-first-name').value.trim();
    var lastName = document.getElementById('checkout-last-name').value.trim();
    var phone = document.getElementById('checkout-phone').value.trim();
    var email = decodeURIComponent(gateGetCookie('pavnika_email') || '');

    if (!firstName || !lastName || !phone) {
      alert('Please enter your first name, last name, and mobile number before proceeding to payment.');
      return;
    }

    if (!customerFieldsValid()) {
      var firstInvalid = document.querySelector('#checkout-content input.field-invalid');
      if (firstInvalid) firstInvalid.focus();
      alert('Please fix the highlighted fields \u2014 our payment provider only accepts letters in names and international phone numbers (e.g. +971501234567).');
      return;
    }

    var billingAddress = readAddress('billing');
    if (!addressIsComplete(billingAddress)) {
      alert('Please complete all billing address fields before proceeding to payment.');
      return;
    }

    var sameAddress = document.getElementById('checkout-same-address').checked;
    var shippingAddress = sameAddress ? billingAddress : readAddress('shipping');
    if (!sameAddress && !addressIsComplete(shippingAddress)) {
      alert('Please complete all shipping address fields, or check "Ship to the same address".');
      return;
    }

    // Direct international orders to WhatsApp — online payment and direct
    // shipping is currently only available within the UAE.
    if (shippingAddress.country !== 'United Arab Emirates') {
      addressMsg.className = 'checkout-promo-msg error';
      addressMsg.innerHTML = 'We currently offer online payment and direct shipping within the UAE only. For international orders, please <a href="' + buildOrderWhatsAppUrl() + '" target="_blank" rel="noopener" style="text-decoration:underline;">continue via WhatsApp</a> so we can arrange shipping and payment together.';
      addressMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    payBtn.textContent = 'Starting payment...';
    payBtn.style.pointerEvents = 'none';

    var payload = {
      items: products.map(function (p) {
        return {
          id: p.id,
          name: p.design + ' — ' + p.id,
          price: p.price,
          series: p.series,
          type: p.type,
          sareeType: p.sareeType,
          pattern: p.pattern,
          image: p.image
        };
      }),
      customer: { firstName: firstName, lastName: lastName, phone: phone, email: email },
      billingAddress: billingAddress,
      shippingAddress: shippingAddress,
      discountPercent: appliedDiscount,
      promoCode: appliedCode
    };

    fetch('/.netlify/functions/create-nomod-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok || !result.data.url) {
          alert(result.data.error || 'Could not start payment. Please try WhatsApp checkout instead.');
          payBtn.textContent = 'Pay Online';
          payBtn.style.pointerEvents = '';
          return;
        }
        // Remember this checkout locally before leaving for Nomod. If the
        // server-side order record is ever missing when the customer comes
        // back, the success page sends this checkoutId along and
        // verify-nomod-order can recover the order directly from Nomod.
        try {
          localStorage.setItem('pavnika_last_checkout', JSON.stringify({
            referenceId: result.data.referenceId,
            checkoutId: result.data.id
          }));
        } catch (e) { /* storage unavailable — recovery fallback just won't apply */ }
        window.location.href = result.data.url;
      })
      .catch(function () {
        alert('Network error — could not start payment. Please try WhatsApp checkout instead.');
        payBtn.textContent = 'Pay Online';
        payBtn.style.pointerEvents = '';
      });
  });

  // Reusable builder (no dedicated button on this page anymore — that
  // lives only in the cart drawer now) so the international-order
  // message above can still offer a working WhatsApp link inline.
  function buildOrderWhatsAppUrl() {
    var lines = products.map(function (p) {
      return '- ' + seriesTitleCase(p.series) + ' (' + p.id + ') — ' + (p.material || p.design) + ' — AED ' + formatAED(p.price);
    });
    var msg = 'Hi Pavnika by Saranya, I would like to purchase the following sarees:\n' + lines.join('\n');
    if (appliedCode) {
      msg += '\n\nPromo code applied: ' + appliedCode + ' (' + appliedDiscount + '% off)';
    }
    msg += '\n\nTotal: AED ' + formatAED(currentTotal());
    return 'https://wa.me/971526630307?text=' + encodeURIComponent(msg);
  }
}

/* ---------- Order success page ---------- */
function initOrderSuccessPage() {
  var loadingEl = document.getElementById('order-loading');
  var successEl = document.getElementById('order-success');
  var pendingEl = document.getElementById('order-pending');
  var errorEl = document.getElementById('order-error');
  var headingEl = document.getElementById('order-status-heading');
  if (!loadingEl) return;

  var params = new URLSearchParams(window.location.search);
  var ref = params.get('ref');

  var MAX_AUTO_RETRIES = 6;   // check up to 6 times...
  var RETRY_DELAY_MS = 3000;  // ...every 3 seconds (18 seconds total) before giving up automatically
  var attempt = 0;

  function showState(state) {
    loadingEl.style.display = state === 'loading' ? 'block' : 'none';
    successEl.style.display = state === 'success' ? 'block' : 'none';
    pendingEl.style.display = state === 'pending' ? 'block' : 'none';
    errorEl.style.display = state === 'error' ? 'block' : 'none';
    headingEl.textContent =
      state === 'success' ? 'Order Confirmed' :
      state === 'pending' ? 'Payment Not Yet Confirmed' :
      state === 'error' ? 'We Need to Check This Manually' :
      'Confirming Your Payment...';
  }

  function checkOrder(isAutoRetry) {
    if (!ref) {
      showState('error');
      return;
    }
    showState('loading');

    // If this browser remembers the checkoutId for this exact reference
    // (saved just before the redirect to Nomod), pass it along — it lets
    // the server recover the order straight from Nomod even if the
    // pending order record failed to save at checkout time.
    var recoveryCheckoutId = null;
    try {
      var saved = JSON.parse(localStorage.getItem('pavnika_last_checkout') || 'null');
      if (saved && saved.referenceId === ref) recoveryCheckoutId = saved.checkoutId;
    } catch (e) { /* ignore bad stored data */ }

    fetch('/.netlify/functions/verify-nomod-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referenceId: ref, checkoutId: recoveryCheckoutId })
    })
      .then(function (res) { return res.json(); })
      .then(function (result) {
        if (result.paid) {
          cartSaveItems([]); // clear the cart now that payment is genuinely confirmed
          renderCartDrawer();
          showState('success');
          return;
        }

        // Not confirmed yet — if we haven't exhausted automatic retries,
        // quietly try again rather than immediately telling the customer
        // something's wrong. Nomod can take a few seconds to finalize.
        if (isAutoRetry !== false && attempt < MAX_AUTO_RETRIES) {
          attempt++;
          setTimeout(function () { checkOrder(true); }, RETRY_DELAY_MS);
          return;
        }

        showState(result.error ? 'error' : 'pending');
      })
      .catch(function () {
        if (isAutoRetry !== false && attempt < MAX_AUTO_RETRIES) {
          attempt++;
          setTimeout(function () { checkOrder(true); }, RETRY_DELAY_MS);
          return;
        }
        showState('error');
      });
  }

  var retryBtn = document.getElementById('order-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', function () {
      attempt = 0; // manual retry gets its own fresh round of auto-retries too
      checkOrder(true);
    });
  }

  checkOrder(true);
}

/* ---------- Site-wide fade + slide reveal animation ----------
   Automatically applies a subtle fade-up reveal to headings and
   section content as they scroll into view, and to product cards as
   they render — no per-page markup changes needed. Respects
   prefers-reduced-motion for accessibility. */
function initRevealAnimations() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  function observeAll(root) {
    (root || document).querySelectorAll('.reveal:not(.is-visible)').forEach(function (el) {
      observer.observe(el);
    });
  }

  // Tag common static structural elements that exist on page load.
  var staticSelectors = '.page-hero .eyebrow, .page-hero h1, .section-head, .hero-copy > *, .why-card, .journey-step, .category-tile';
  document.querySelectorAll(staticSelectors).forEach(function (el, i) {
    el.classList.add('reveal');
    el.style.transitionDelay = (Math.min(i % 5, 5) * 0.08) + 's';
  });

  observeAll();

  // Exposed so dynamically-rendered content (product grids, etc.) can
  // opt in after being inserted into the page.
  window.__revealElements = function (container, selector) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var items = container.querySelectorAll(selector || ':scope > *');
    items.forEach(function (el, i) {
      el.classList.add('reveal');
      el.style.transitionDelay = (Math.min(i % 8, 8) * 0.05) + 's';
    });
    observeAll(container);
  };
}

/* ---------- Reusable draggable, hover-pausing auto-scroll marquee ----------
   Used for the homepage reviews carousel and the series marquee. JS-driven
   (not CSS @keyframes) so it can pause exactly in place on hover, be
   click-and-dragged with the mouse, and resume smoothly from wherever it
   was left — a keyframe animation can't do the "resume from here" part. */
function initDraggableMarquee(container, track, options) {
  if (!container || !track) return;
  options = options || {};
  var speed = options.speed || 0.4;
  var dir = options.reverse ? 1 : -1;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var offset = 0;
  var halfWidth = 0;
  var isHovering = false;
  var isDragging = false;
  var dragStartX = 0;
  var dragStartOffset = 0;
  var dragDistance = 0;

  function measure() {
    halfWidth = track.scrollWidth / 2;
  }
  measure();
  window.addEventListener('resize', measure);

  // Wrap the offset into the seamless range every frame — including
  // while dragging. Previously wrapping only ran during auto-scroll, so
  // a click-and-drag could run straight past the duplicated content and
  // show blank space at either end.
  function normalize() {
    if (halfWidth <= 0) return;
    while (offset <= -halfWidth) offset += halfWidth;
    while (offset > 0) offset -= halfWidth;
  }

  function tick() {
    if (!reduced && !isHovering && !isDragging && halfWidth > 0) {
      offset += dir * speed;
    }
    normalize();
    track.style.transform = 'translateX(' + offset + 'px)';
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  container.addEventListener('mouseenter', function () { isHovering = true; });
  container.addEventListener('mouseleave', function () {
    isHovering = false;
    isDragging = false;
    track.style.cursor = 'grab';
  });

  function dragStart(clientX) {
    isDragging = true;
    dragStartX = clientX;
    dragStartOffset = offset;
    dragDistance = 0;
    track.style.cursor = 'grabbing';
  }
  function dragMove(clientX) {
    if (!isDragging) return;
    var delta = clientX - dragStartX;
    dragDistance = Math.abs(delta);
    offset = dragStartOffset + delta;
  }
  function dragEnd() {
    isDragging = false;
    track.style.cursor = 'grab';
  }

  container.addEventListener('mousedown', function (e) { dragStart(e.clientX); e.preventDefault(); });
  window.addEventListener('mousemove', function (e) { dragMove(e.clientX); });
  window.addEventListener('mouseup', dragEnd);

  container.addEventListener('touchstart', function (e) { dragStart(e.touches[0].clientX); }, { passive: true });
  container.addEventListener('touchmove', function (e) { dragMove(e.touches[0].clientX); }, { passive: true });
  container.addEventListener('touchend', dragEnd);

  // Suppress accidental navigation/clicks on inner links when the user was
  // actually dragging, not clicking.
  container.addEventListener('click', function (e) {
    if (dragDistance > 6) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

/* ---------- Homepage: Curated Excellence saree showcase ----------
   Shows 5 random, currently-available sarees — a different set on every
   page load. Clicking one goes to Collections with that saree's detail
   popup open, but the grid behind it stays fully unfiltered (the whole
   catalogue) — it's just the entry point, not a narrowed view. */
function initCuratedShowcase() {
  var grid = document.getElementById('curated-showcase');
  if (!grid || typeof window.PRODUCTS === 'undefined') return;

  var available = window.PRODUCTS.filter(function (p) { return !p.sold && p.image; });
  if (!available.length) return;

  var shuffled = available.slice().sort(function () { return Math.random() - 0.5; });
  var picks = shuffled.slice(0, Math.min(5, shuffled.length));

  grid.innerHTML = picks.map(function (p) {
    var seriesLabel = seriesTitleCase(p.series);
    // Open this saree's detail popup with the Collections grid behind
    // it showing the full, unfiltered catalogue.
    var href = 'collections.html?open=' + encodeURIComponent(p.id);
    var detail = 'A ' + (p.category || '') + ' Category Saree in ' + (p.sareeType || p.material || p.type || '');
    return (
      '<a class="curated-tile" href="' + href + '">' +
        '<div class="curated-tile-media"><img src="' + p.image + '" alt="' + (p.material || p.type) + ' — ' + seriesLabel + ' saree" loading="lazy"><span class="id-badge">' + p.id + '</span></div>' +
        '<div class="curated-tile-gradient"></div>' +
        '<div class="curated-tile-text">' +
          '<span class="curated-series">' + seriesLabel + '</span>' +
          '<h3 class="curated-type">' + (p.material || p.type || '') + '</h3>' +
          '<p class="curated-hover-detail">' + detail + '</p>' +
          '<span class="curated-explore">Explore More &rarr;</span>' +
        '</div>' +
      '</a>'
    );
  }).join('');
  initTouchRevealTiles();
}


/* ---------- Homepage: JS-driven static hero positioning ----------
   Deliberately not pure CSS position:sticky — sticky silently stops
   working if ANY ancestor has certain transform/filter/perspective
   properties, which is easy to trip on unintentionally as a site
   grows.

   Behavior (modelled on siahbyahadishika.com): the hero is FULLY
   STATIC. It is fixed permanently just below the sticky header and
   sized to fill the rest of the viewport, so it never moves at all —
   there is no absolute↔fixed handoff on scroll (that handoff was the
   source of the jitter where the banner slid under the header). The
   in-flow wrapper is a same-size spacer; all content after it scrolls
   up and over the banner, and since the banner stays fixed behind
   that opaque, higher-z content, it never reappears further down.
   No scroll listener needed — only re-layout on resize. */
function initPinnedHero() {
  var wrapper = document.querySelector('.hero-pin-wrapper');
  var hero = document.querySelector('.hero-banner-pinned');
  if (!wrapper || !hero) return;
  var header = document.querySelector('header.site-header');

  // The banner artwork is authored at 1900x540 (ratio 3.52:1). On
  // desktop the hero height follows that ratio at full viewport width,
  // so the images display essentially uncropped; it's floored at 460px
  // (so the overlay text always fits) and capped at the space below the
  // header. On mobile the hero fills the viewport below the header as
  // before — a 3.52:1 image on a portrait screen crops regardless, and
  // the gradient + text carry the layout there.
  var BANNER_RATIO = 1900 / 540;

  function layout() {
    var headerH = header ? header.offsetHeight : 0;
    hero.classList.add('is-fixed');
    hero.style.position = 'fixed';
    hero.style.top = headerH + 'px';
    hero.style.left = '0';
    hero.style.right = '0';

    if (window.innerWidth <= 880) {
      // 100svh = the SMALL viewport height, i.e. the size when the
      // browser's address bar is fully visible. Unlike
      // window.innerHeight (which grows as the address bar collapses
      // during scroll), this value never changes — so the hero can't
      // suddenly resize mid-scroll and jolt the page. Browsers without
      // svh support (very old) fall back to the plain vh value above it.
      var heightExpr = 'calc(100vh - ' + headerH + 'px)';
      var heightExprSvh = 'calc(100svh - ' + headerH + 'px)';
      hero.style.height = heightExpr;
      hero.style.height = heightExprSvh;
      wrapper.style.height = heightExpr;
      wrapper.style.height = heightExprSvh;
    } else {
      var maxH = window.innerHeight - headerH;
      var ratioH = Math.round(window.innerWidth / BANNER_RATIO);
      var heroH = Math.min(Math.max(ratioH, 460), maxH);
      hero.style.height = heroH + 'px';
      wrapper.style.height = heroH + 'px';
    }
  }

  layout();
  window.addEventListener('resize', layout);
  // Re-run once everything (fonts, images) has loaded, in case the
  // header height changed after first paint.
  window.addEventListener('load', layout);
}
