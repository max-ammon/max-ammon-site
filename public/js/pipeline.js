(function () {
  'use strict';

  var line = document.querySelector('.pipeline-line');
  var dot = document.querySelector('.pipeline-dot');
  if (!line) return;

  // --- Scroll dot -----------------------------------------------------------
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
    if (!dot || !lineHeight) return;
    // 0 when the top of the rail reaches the middle of the screen, 1 at the end.
    var p = (window.pageYOffset + window.innerHeight / 2 - lineTop) / lineHeight;
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    if (Math.abs(p - lastP) < 0.0005) return; // nothing meaningful changed
    lastP = p;
    dot.style.transform = 'translate(-50%, -50%) translateY(' + (p * lineHeight).toFixed(1) + 'px)';
  }

  // --- Software markers -----------------------------------------------------
  // Each marker is anchored at top:<data-pos>%. On a short (scaled-down) bar the
  // tall icon/label boxes would overlap, so nudge overlapping neighbours apart —
  // minimally, keeping each as close to its intended spot as possible.
  var markers = [].slice.call(line.querySelectorAll('.pipeline-marker'));
  var GAP = 6; // px of breathing room between neighbours

  function relayoutMarkers() {
    if (markers.length < 2) return;
    // Reset to the intended anchors first, so the pass is idempotent on resize.
    markers.forEach(function (m) { m.style.top = (parseFloat(m.getAttribute('data-pos')) || 0) + '%'; });

    var lr = line.getBoundingClientRect();
    var barTop = lr.top;
    var barH = lr.height;
    if (!barH) return; // rail hidden (small screens) — nothing to place

    // Measure each marker's visual span as the union of its children, so a
    // rotated logo that overflows its box is counted at its true height.
    var items = markers.map(function (m) {
      var pos = parseFloat(m.getAttribute('data-pos')) || 0;
      var top = Infinity;
      var bottom = -Infinity;
      var kids = m.getElementsByTagName('*');
      for (var i = 0; i < kids.length; i++) {
        var r = kids[i].getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (r.top < top) top = r.top;
        if (r.bottom > bottom) bottom = r.bottom;
      }
      if (top === Infinity) {
        var mr = m.getBoundingClientRect();
        top = mr.top;
        bottom = mr.bottom;
      }
      var c = (top + bottom) / 2 - barTop; // centre, px from the bar top
      return { el: m, idealTopPx: (pos / 100) * barH, measured: c, center: c, half: (bottom - top) / 2 + GAP / 2 };
    });

    items.sort(function (a, b) { return a.center - b.center; });

    // Iteratively separate overlapping neighbours with symmetric pushes.
    for (var iter = 0; iter < 100; iter++) {
      var moved = false;
      for (var i = 0; i < items.length - 1; i++) {
        var a = items[i];
        var b = items[i + 1];
        var need = a.half + b.half;
        var gap = b.center - a.center;
        if (gap < need - 0.5) {
          var push = (need - gap) / 2;
          a.center -= push;
          b.center += push;
          moved = true;
        }
      }
      // Keep the cluster within the bar.
      for (var j = 0; j < items.length; j++) {
        var hh = items[j].half - GAP / 2;
        if (items[j].center < hh) items[j].center = hh;
        else if (items[j].center > barH - hh) items[j].center = barH - hh;
      }
      if (!moved) break;
    }

    // Apply: translate each marker by (new centre - measured centre). Markers
    // that didn't need to move keep their % anchor (stays responsive).
    items.forEach(function (it) {
      var delta = it.center - it.measured;
      if (Math.abs(delta) < 0.5) return;
      it.el.style.top = (it.idealTopPx + delta) + 'px';
    });
  }

  // --- Wiring ---------------------------------------------------------------
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
    relayoutMarkers();
    measure();
    lastP = -1;
    update();
  }

  relayoutMarkers();
  measure();
  update();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  // Fonts/images settling can shift the rail — re-run once everything loads.
  window.addEventListener('load', onResize);
  // Browsers pause requestAnimationFrame while a tab is hidden, so a queued
  // frame can be dropped and the dot left stale. Re-sync on the way back.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      ticking = false;
      onResize();
    }
  });
  // Marker logos load lazily; their height only settles then, so re-place each
  // once its image finishes loading.
  markers.forEach(function (m) {
    var img = m.querySelector('img');
    if (img && !img.complete) img.addEventListener('load', relayoutMarkers);
  });
})();
