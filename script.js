document.addEventListener('DOMContentLoaded', function () {
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
        '<img src="' + p.image + '" alt="' + p.design + ' — ' + seriesTitleCase(p.series) + ' saree" loading="lazy">' +
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

function initCollectionsPage() {
  var grid = document.getElementById('product-grid');
  if (!grid || typeof window.PRODUCTS === 'undefined') return;

  var state = { category: 'all', series: 'all' };
  var countEl = document.getElementById('results-count');
  var noResults = document.getElementById('no-results');

  function render() {
    var filtered = window.PRODUCTS.filter(function (p) {
      var okCat = state.category === 'all' || p.category === state.category;
      var okSeries = state.series === 'all' || p.series === state.series;
      return okCat && okSeries;
    });

    grid.innerHTML = filtered.map(productCardHTML).join('');
    countEl.textContent = filtered.length + (filtered.length === 1 ? ' saree' : ' sarees') + ' found';
    noResults.style.display = filtered.length === 0 ? 'block' : 'none';
  }

  ['category-filter', 'series-filter'].forEach(function (groupId) {
    var groupEl = document.getElementById(groupId);
    if (!groupEl) return;
    var key = groupEl.getAttribute('data-filter-group');
    groupEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.filter-btn');
      if (!btn) return;
      groupEl.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state[key] = btn.getAttribute('data-value');
      render();
    });
  });

  // Pre-set the category/series filter if arriving from a homepage link,
  // e.g. collections.html?series=SUMANGALI or collections.html?category=Premium
  var params = new URLSearchParams(window.location.search);
  var catParam = params.get('category');
  var seriesParam = params.get('series');

  if (catParam) {
    var catGroup = document.getElementById('category-filter');
    if (catGroup) {
      var matchCatBtn = catGroup.querySelector('.filter-btn[data-value="' + catParam.replace(/"/g, '') + '"]');
      if (matchCatBtn) {
        catGroup.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
        matchCatBtn.classList.add('active');
        state.category = catParam;
      }
    }
  }

  if (seriesParam) {
    var seriesGroup = document.getElementById('series-filter');
    if (seriesGroup) {
      var matchSeriesBtn = seriesGroup.querySelector('.filter-btn[data-value="' + seriesParam.replace(/"/g, '') + '"]');
      if (matchSeriesBtn) {
        seriesGroup.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
        matchSeriesBtn.classList.add('active');
        state.series = seriesParam;
      }
    }
  }

  render();
  buildLightbox();

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
      '<div class="lightbox-info">' +
        '<span class="p-design" id="lightbox-design"></span>' +
        '<span class="p-meta" id="lightbox-meta"></span>' +
      '</div>' +
      '<div class="lightbox-stage" id="lightbox-stage">' +
        '<button type="button" class="lightbox-arrow prev" id="lightbox-prev" aria-label="Previous image">&#8249;</button>' +
        '<button type="button" class="lightbox-arrow next" id="lightbox-next" aria-label="Next image">&#8250;</button>' +
      '</div>' +
      '<div class="lightbox-dots" id="lightbox-dots"></div>' +
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

  window.openLightbox = function (product) {
    state.images = (product.images && product.images.length) ? product.images : [product.image];
    state.index = 0;
    document.getElementById('lightbox-design').textContent = product.design;
    document.getElementById('lightbox-meta').textContent =
      product.type + (product.pattern ? ' · ' + product.pattern : '') + (product.sold ? ' · Sold Out' : '');
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
    var imgsHTML = picks.map(function (src, i) {
      return '<img src="' + src + '" alt="' + label + ' saree" loading="lazy" class="' + (i === 0 ? 'is-active' : '') + '">';
    }).join('');
    return (
      '<a class="category-tile" href="collections.html?series=' + encodeURIComponent(series) + '">' +
        '<div class="category-tile-media">' + imgsHTML + '</div>' +
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
