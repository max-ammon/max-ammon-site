(function () {
  'use strict';

  // Scroll-position dot for the gallery "my cg journey" rail — the same mechanism
  // as the Skills production-pipeline dot (public/js/pipeline.js). Geometry is
  // measured once (and on resize / observed size changes), never on every scroll,
  // so scrolling stays cheap.
  var line = document.querySelector('.journey-line');
  var dot = document.querySelector('.journey-dot');
  if (!line || !dot) return;

  var titles = line.querySelector('.journey-titles');
  var lineTop = 0;
  var lineHeight = 0;
  var lastP = -1;

  function measure() {
    var r = line.getBoundingClientRect();
    lineTop = r.top + window.pageYOffset;
    lineHeight = r.height;
  }

  // Keep the repeated label at a roughly constant density however tall the
  // gallery grows (about one copy per 520px), so it never looks sparse or
  // crowded. The copies are flex items of a flex:1 / fit-content bar, so adding
  // or removing them changes neither the bar's height nor its width — it can't
  // feed back into the ResizeObserver below.
  function fitLabels() {
    if (!titles || !titles.firstElementChild) return;
    var want = Math.max(1, Math.min(12, Math.round(lineHeight / 520)));
    while (titles.children.length < want) titles.appendChild(titles.firstElementChild.cloneNode(true));
    while (titles.children.length > want) titles.removeChild(titles.lastElementChild);
  }

  function update() {
    if (!lineHeight) return;
    // 0 when the top of the rail reaches the middle of the screen, 1 at the end.
    var p = (window.pageYOffset + window.innerHeight / 2 - lineTop) / lineHeight;
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    if (Math.abs(p - lastP) < 0.0005) return;
    lastP = p;
    dot.style.transform = 'translate(-50%, -50%) translateY(' + (p * lineHeight).toFixed(1) + 'px)';
  }

  function refresh() {
    measure();
    fitLabels();
    lastP = -1;
    update();
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { ticking = false; update(); });
  }
  function onResize() {
    refresh();
    // Jumping straight to a maximised window can settle its layout a frame later
    // without a second resize event — re-measure once more so the dot's travel
    // isn't left using the pre-maximise bar height.
    requestAnimationFrame(refresh);
  }

  refresh();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  window.addEventListener('load', onResize);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { ticking = false; onResize(); }
  });
  // The rail spans the projects, whose height changes as lazy thumbnails load and
  // on resize. Observing the bar refreshes the geometry whenever it actually
  // changes size, from any cause. No feedback loop: the dot is absolutely
  // positioned and the labels don't change the bar's box (see fitLabels).
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { refresh(); });
    ro.observe(line);
  }
  // Lazy gallery images only settle their height once loaded — refresh then too.
  var imgs = document.querySelectorAll('#projects img');
  for (var i = 0; i < imgs.length; i++) {
    if (!imgs[i].complete) imgs[i].addEventListener('load', onResize, { passive: true });
  }
})();
