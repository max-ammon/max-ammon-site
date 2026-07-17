(function () {
  'use strict';

  var line = document.querySelector('.pipeline-line');
  var dot = document.querySelector('.pipeline-dot');
  if (!line || !dot) return;

  // Geometry is measured once (and on resize) rather than on every scroll, so
  // scrolling never forces the browser to re-calculate layout.
  var lineTop = 0;
  var lineHeight = 0;
  var lastP = -1;

  function measure() {
    var r = line.getBoundingClientRect();
    lineTop = r.top + window.pageYOffset;
    lineHeight = r.height;
  }

  function update() {
    if (!lineHeight) return;
    // 0 when the top of the rail reaches the middle of the screen, 1 at the end.
    var p = (window.pageYOffset + window.innerHeight / 2 - lineTop) / lineHeight;
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    if (Math.abs(p - lastP) < 0.0005) return; // nothing meaningful changed
    lastP = p;
    dot.style.transform = 'translate(-50%, -50%) translateY(' + (p * lineHeight).toFixed(1) + 'px)';
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      update();
    });
  }

  function onResize() {
    measure();
    lastP = -1;
    update();
  }

  measure();
  update();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  // Fonts/images settling can shift the rail — re-measure once everything loads.
  window.addEventListener('load', onResize);
  // Browsers pause requestAnimationFrame while a tab is hidden, so a queued
  // frame can be dropped and the dot left stale. Re-sync on the way back.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      ticking = false;
      onResize();
    }
  });
})();
