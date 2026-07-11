document.addEventListener('DOMContentLoaded', function () {
  initLoginPage();
  initReviewsMarquee();
  initFaqAccordion();
  buildLightbox();
  initAccountMenu();
  initSearchPanel();

  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.main-nav');

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var isOpen = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  var form = document.querySelector('.contact-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var note = form.querySelector('.form-status');
      var submitBtn = form.querySelector('button[type="submit"]');

      if (submitBtn) submitBtn.disabled = true;

      var data = new FormData(form);
      fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(data).toString()
      })
        .then(function () {
          if (note) {
            note.textContent = 'Thank you — your enquiry has been noted. We will reach out on WhatsApp or email within one business day.';
            note.style.color = '#0B5D5A';
          }
          form.reset();
        })
        .catch(function () {
          if (note) {
            note.textContent = 'Something went wrong sending your enquiry — please message us directly on WhatsApp instead.';
            note.style.color = '#B8142A';
          }
        })
        .finally(function () {
          if (submitBtn) submitBtn.disabled = false;
        });
    });
  }

  initCollectionsPage();
  initHomeSeriesMarquee();
  initHeroBannerCarousel();
  initHeroVideoPlaylist();
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

function seriesTitleCase(s) {
  return String(s).toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

function whatsappLink(product) {
  var msg = 'Hi Pavnika by Saranya, I am interested in the ' + seriesTitleCase(product.series) +
    ' saree (' + product.id + ') — ' + product.design + '. Is it available?';
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
        '<img src="' + p.image + '" alt="' + p.design + ' — ' + seriesTitleCase(p.series) + ' saree" loading="lazy" decoding="async">' +
        soldRibbon +
      '</div>' +
      '<div class="product-info">' +
        '<span class="p-design">' + p.design + '</span>' +
        '<span class="p-meta">' + p.type + (p.pattern ? ' · ' + p.pattern : '') + '</span>' +
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
          extraImg.alt = product.design + ' — view ' + (i + 1);
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

function initCollectionsPage() {
  var grid = document.getElementById('product-grid');
  if (!grid || typeof window.PRODUCTS === 'undefined') return;

  var PAGE_SIZE = 16;
  var state = { category: 'all', series: 'all', showSold: false, page: 1, query: '' };
  var countEl = document.getElementById('results-count');
  var noResults = document.getElementById('no-results');
  var paginationEl = document.getElementById('pagination');
  var hideSoldToggle = document.getElementById('hide-sold-toggle');
  var categoryGroup = document.getElementById('category-filter');
  var seriesGroup = document.getElementById('series-filter');
  var searchInput = document.getElementById('collections-search-input');
  var SEARCH_FIELDS = ['id', 'design', 'type', 'sareeType', 'pattern', 'series', 'category'];

  function getFiltered() {
    var q = state.query.trim().toLowerCase();
    return window.PRODUCTS.filter(function (p) {
      var okCat = state.category === 'all' || p.category === state.category;
      var okSeries = state.series === 'all' || p.series === state.series;
      var okSold = state.showSold || !p.sold;
      var okQuery = !q || SEARCH_FIELDS.some(function (f) {
        return p[f] && String(p[f]).toLowerCase().indexOf(q) !== -1;
      });
      return okCat && okSeries && okSold && okQuery;
    });
  }

  // Which series actually have sarees in the given category (or all, if 'all').
  function seriesAvailableFor(category) {
    var set = {};
    window.PRODUCTS.forEach(function (p) {
      if (category === 'all' || p.category === category) set[p.series] = true;
    });
    return set;
  }

  // Which categories actually have sarees in the given series (or all, if 'all').
  function categoriesAvailableFor(series) {
    var set = {};
    window.PRODUCTS.forEach(function (p) {
      if (series === 'all' || p.series === series) set[p.category] = true;
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
    var filtered = getFiltered();
    var start = (state.page - 1) * PAGE_SIZE;
    var pageItems = filtered.slice(start, start + PAGE_SIZE);

    grid.innerHTML = pageItems.map(productCardHTML).join('');
    countEl.textContent = filtered.length + (filtered.length === 1 ? ' saree' : ' sarees') + ' found';
    noResults.style.display = filtered.length === 0 ? 'block' : 'none';
    renderPagination(filtered.length);
    initHoverCycle(grid);
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

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      state.query = searchInput.value;
      state.page = 1;
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

/* ---------- Lightbox: swipeable image gallery per saree ---------- */
function buildLightbox() {
  if (document.querySelector('.lightbox-overlay')) return;

  var overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML =
    '<button type="button" class="lightbox-close" id="lightbox-close">&larr; Back</button>' +
    '<div class="lightbox-body">' +
      '<div class="lightbox-stage" id="lightbox-stage">' +
        '<button type="button" class="lightbox-arrow prev" id="lightbox-prev" aria-label="Previous image">&#8249;</button>' +
        '<button type="button" class="lightbox-arrow next" id="lightbox-next" aria-label="Next image">&#8250;</button>' +
      '</div>' +
      '<div class="lightbox-side">' +
        '<div class="lightbox-details">' +
          '<span class="p-design" id="lightbox-design"></span>' +
          '<span class="p-meta" id="lightbox-meta"></span>' +
        '</div>' +
        '<div class="lightbox-tags" id="lightbox-tags"></div>' +
        '<p class="lightbox-description" id="lightbox-description"></p>' +
        '<div class="lightbox-dots" id="lightbox-dots"></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var stage = document.getElementById('lightbox-stage');
  var dotsWrap = document.getElementById('lightbox-dots');
  var state = { images: [], index: 0 };

  function renderStage() {
    stage.querySelectorAll('img').forEach(function (img) { img.remove(); });
    state.images.forEach(function (src, i) {
      var img = document.createElement('img');
      img.src = src;
      img.alt = 'Saree view ' + (i + 1);
      if (i === state.index) img.classList.add('is-active');
      stage.appendChild(img);
    });
    dotsWrap.innerHTML = state.images.map(function (_, i) {
      return '<span class="' + (i === state.index ? 'is-active' : '') + '"></span>';
    }).join('');
    dotsWrap.style.display = state.images.length > 1 ? 'flex' : 'none';
    var arrows = document.querySelectorAll('.lightbox-arrow');
    arrows.forEach(function (a) { a.style.display = state.images.length > 1 ? 'flex' : 'none'; });
  }

  function goTo(delta) {
    if (!state.images.length) return;
    state.index = (state.index + delta + state.images.length) % state.images.length;
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
    document.getElementById('lightbox-design').textContent = product.design || '';
    document.getElementById('lightbox-meta').textContent =
      (product.type || '') + (product.pattern ? ' · ' + product.pattern : '') + (product.sold ? ' · Sold Out' : '');

    var tags = buildTags(product);
    document.getElementById('lightbox-tags').innerHTML = tags.map(function (t) {
      return '<span>' + t + '</span>';
    }).join('');

    document.getElementById('lightbox-description').textContent = buildDescription(product);

    renderStage();
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  };

  function closeLightbox() {
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  }

  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-prev').addEventListener('click', function () { goTo(-1); });
  document.getElementById('lightbox-next').addEventListener('click', function () { goTo(1); });
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeLightbox(); });
  document.addEventListener('keydown', function (e) {
    if (overlay.style.display !== 'flex') return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') goTo(-1);
    if (e.key === 'ArrowRight') goTo(1);
  });

  // Touch swipe support for mobile
  var touchStartX = null;
  stage.addEventListener('touchstart', function (e) {
    touchStartX = e.changedTouches[0].clientX;
  }, { passive: true });
  stage.addEventListener('touchend', function (e) {
    if (touchStartX === null) return;
    var dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) goTo(dx < 0 ? 1 : -1);
    touchStartX = null;
  }, { passive: true });

  // Mouse-drag swipe support for desktop (no touchscreen)
  var mouseStartX = null;
  var isDragging = false;
  stage.addEventListener('mousedown', function (e) {
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
          '<div class="tile-hover-overlay"><p>' + hoverText + '</p></div>' +
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
}

/* ---------- Homepage: hero video playlist ----------
   Reads assets/videos/videos.json, an array of filenames living in
   assets/videos/, and plays them one after another on a continuous loop.
   To add a video: drop the file in assets/videos/ and add its filename
   to videos.json. To remove one: delete the file and its entry. */
function initHeroVideoPlaylist() {
  var videoEl = document.getElementById('hero-video');
  if (!videoEl) return;

  var FOLDER = 'assets/videos/';
  var FALLBACK_LIST = ['video-1.mp4'];

  function startPlaylist(list) {
    if (!list || !list.length) list = FALLBACK_LIST;
    var idx = 0;

    function playCurrent() {
      videoEl.src = FOLDER + list[idx];
      videoEl.load();
      var playPromise = videoEl.play();
      if (playPromise && playPromise.catch) playPromise.catch(function () {});
    }

    videoEl.addEventListener('ended', function () {
      idx = (idx + 1) % list.length;
      playCurrent();
    });

    playCurrent();
  }

  fetch(FOLDER + 'videos.json')
    .then(function (res) { return res.ok ? res.json() : FALLBACK_LIST; })
    .then(startPlaylist)
    .catch(function () { startPlaylist(FALLBACK_LIST); });
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
    var phone = document.getElementById('gate-phone').value.trim();
    var errorEl = document.getElementById('gate-error-1');
    errorEl.textContent = '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.textContent = 'Please enter a valid email address.';
      return;
    }
    if (!phone) {
      errorEl.textContent = 'Please enter your mobile number.';
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';

    fetch('/.netlify/functions/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, phone: phone })
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
  document.getElementById('gate-phone').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendCode();
  });
  resendBtn.addEventListener('click', function () {
    resendBtn.disabled = true;
    resendBtn.textContent = 'Sending...';
    fetch('/.netlify/functions/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: gateEmail, phone: document.getElementById('gate-phone').value.trim() })
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
    })
    .catch(function () { /* silently do nothing if the manifest can't be read */ });
}

/* ---------- Homepage: hero banner carousel ----------
   Reads assets/banners/banners.json, an array of { image, link }
   entries living in assets/banners/. Displays them full-width at the
   top of the page, auto-rotating with a crossfade if there's more than
   one, and links each slide through to its "link" (or Collections by
   default). To add a banner: drop the image in assets/banners/ and add
   an entry to banners.json. To remove one: delete both. */
function initHeroBannerCarousel() {
  var wrap = document.getElementById('hero-banner');
  if (!wrap) return;

  var FOLDER = 'assets/banners/';
  var DEFAULT_LINK = 'collections.html';

  fetch(FOLDER + 'banners.json')
    .then(function (res) { return res.ok ? res.json() : []; })
    .then(function (banners) {
      if (!banners || !banners.length) return;

      var slidesHTML = banners.map(function (b, i) {
        var link = b.link || DEFAULT_LINK;
        return (
          '<a class="hero-banner-slide' + (i === 0 ? ' is-active' : '') + '" href="' + link + '">' +
            '<img src="' + FOLDER + b.image + '" alt="Pavnika by Saranya featured banner" loading="' + (i === 0 ? 'eager' : 'lazy') + '">' +
          '</a>'
        );
      }).join('');

      var dotsHTML = banners.length > 1
        ? '<div class="hero-banner-dots">' + banners.map(function (_, i) {
            return '<span class="' + (i === 0 ? 'is-active' : '') + '"></span>';
          }).join('') + '</div>'
        : '';

      wrap.innerHTML = slidesHTML + dotsHTML;

      if (banners.length > 1) {
        var slides = wrap.querySelectorAll('.hero-banner-slide');
        var dots = wrap.querySelectorAll('.hero-banner-dots span');
        var idx = 0;

        // First banner shows for 3s, every banner after that for 5s.
        function durationFor(i) { return i === 0 ? 3000 : 5000; }

        function advance() {
          setTimeout(function () {
            slides[idx].classList.remove('is-active');
            dots[idx].classList.remove('is-active');
            idx = (idx + 1) % slides.length;
            slides[idx].classList.add('is-active');
            dots[idx].classList.add('is-active');
            advance();
          }, durationFor(idx));
        }

        advance();
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
  if (emailEl) {
    emailEl.textContent = email ? decodeURIComponent(email) : 'Guest';
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
