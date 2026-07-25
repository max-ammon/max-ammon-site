(function () {
  'use strict';

  // Robust in-page nav scrolling. The page scrolls smoothly (html { scroll-behavior }),
  // and a lazy image between the top and a target section can finish loading
  // mid-scroll — growing and nudging the target so the first (uncached) click
  // lands a few pixels off, and a second click corrects it. We let the browser do
  // its normal anchor scroll, then keep the target aligned for a short spell as
  // the layout settles, backing off the instant the visitor scrolls themselves.
  var links = [].slice.call(document.querySelectorAll('nav a[href^="#"]'));
  if (!links.length) return;

  var cancelPrev = null;

  function keepAligned(target) {
    if (cancelPrev) cancelPrev(); // a new click supersedes any in-flight alignment

    var timer;
    function stop() {
      clearInterval(timer);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchmove', stop);
      window.removeEventListener('keydown', stop);
      if (cancelPrev === stop) cancelPrev = null;
    }
    cancelPrev = stop;

    // Any real scroll input from the visitor cancels the re-alignment, so we
    // never fight them. Our own programmatic scrolls don't fire these events.
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchmove', stop, { passive: true });
    window.addEventListener('keydown', stop);

    // The target's position within the document only moves when content above it
    // changes height (an image finished loading) — never from the scroll
    // animation itself, which changes the viewport position, not the page one.
    function docTop() { return Math.round(target.getBoundingClientRect().top + window.pageYOffset); }
    var last = docTop();
    var startMs = Date.now();
    timer = setInterval(function () {
      if (Date.now() - startMs > 900) { stop(); return; }
      var now = docTop();
      if (Math.abs(now - last) > 1) {
        last = now;
        target.scrollIntoView({ behavior: 'smooth' }); // re-align to the shifted target
      }
    }, 100);
  }

  links.forEach(function (link) {
    link.addEventListener('click', function () {
      var id = link.getAttribute('href').slice(1);
      var target = id && document.getElementById(id);
      // Don't preventDefault — the native anchor still handles the hash and the
      // initial smooth scroll; we only keep it aligned afterwards.
      if (target) keepAligned(target);
    });
  });
})();
