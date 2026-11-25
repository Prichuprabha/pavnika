/* "Chat with us" floating WhatsApp widget (public pages only) */
(function () {
  var page = (location.pathname.split('/').pop() || 'home.html').toLowerCase();
  var skip = ['checkout.html', 'payment.html', 'order-success.html', 'index.html', 'admin.html', 'pos.html', 'scan.html'];
  if (skip.indexOf(page) !== -1) return;
  var PHONE = '971526630307';
  function wa(msg) { return 'https://wa.me/' + PHONE + (msg ? '?text=' + encodeURIComponent(msg) : ''); }

  function build() {
    if (document.getElementById('chat-fab') || document.querySelector('link[href^="chat-widget.css"]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'chat-widget.css?v=3';
    link.onload = function () { mount(); };
    link.onerror = function () { /* no styles -> don't show an unstyled widget */ };
    document.head.appendChild(link);
  }

  function mount() {
    if (document.getElementById('chat-fab')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="chat-panel" id="chat-panel" role="dialog" aria-label="Chat with Pavnika">' +
        '<div class="chat-head"><div class="chat-head-text"><b>Chat with Pavnika</b><span>Typically replies within a few hours</span></div><img class="chat-head-logo" src="assets/circle-logo.png" alt="Pavnika by Saranya"></div>' +
        '<div class="chat-body"><p>Hi! 👋 How can we help you today?</p>' +
          '<a class="chat-opt" target="_blank" rel="noopener" href="' + wa("Hi Pavnika, I'd like to know more about a saree.") + '">🧿 Ask about a saree</a>' +
          '<a class="chat-opt" target="_blank" rel="noopener" href="' + wa('Hi Pavnika, I have a question about my order.') + '">📦 Track or ask about my order</a>' +
          '<a class="chat-opt chat-appt" href="contact.html">📅 Book an appointment</a>' +
          '<a class="chat-opt" target="_blank" rel="noopener" href="' + wa('Hi Pavnika, I have a question.') + '">💬 Something else</a>' +
          '<div class="chat-cta"><a href="collections.html" class="chat-btn chat-btn-fill">View Collections</a>' +
          '<a href="' + wa('') + '" target="_blank" rel="noopener" class="chat-btn chat-btn-line">Connect with us</a></div>' +
        '</div></div>' +
      '<button type="button" class="chat-fab" id="chat-fab" aria-label="Chat with us" aria-expanded="false">' +
        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.2 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.8-.1 1.4z"/></svg>' +
        '<span class="chat-label">Chat with us</span></button>';
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

    var fab = document.getElementById('chat-fab');
    var apptOpt = document.querySelector('.chat-appt');
    var panel = document.getElementById('chat-panel');
    function setOpen(o) {
      panel.classList.toggle('is-open', o);
      fab.classList.toggle('is-open', o);
      fab.setAttribute('aria-expanded', o ? 'true' : 'false');
    }
    // "Book an appointment" opens the site's own booking popup (same one as
    // the header's Book Appointment button); falls back to contact.html.
    if (apptOpt) apptOpt.addEventListener('click', function (e) {
      var cta = document.querySelector('.nav-cta');
      if (!cta) return; // no popup on this page -> normal link to contact.html
      e.preventDefault();
      setOpen(false);
      setTimeout(function () { cta.click(); }, 150);
    });
    fab.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!panel.classList.contains('is-open')); });
    document.addEventListener('click', function (e) {
      if (panel.classList.contains('is-open') && !panel.contains(e.target) && e.target !== fab && !fab.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    window.addEventListener('scroll', function () { setOpen(false); }, { passive: true });
    window.addEventListener('pageshow', function () { setOpen(false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
