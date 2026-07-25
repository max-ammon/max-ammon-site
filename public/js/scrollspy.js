(function () {
  'use strict';

  // Scrollspy: glow the header link for the section currently in view — the same
  // text-shadow the links get on hover — so a visitor can tell where they are.
  // Only the in-page sections have a matching nav link; "Gallery" is a separate
  // page and is simply not in this list.
  var ids = ['demo', 'skills', 'about', 'contact'];
  var items = [];
  ids.forEach(function (id) {
    var section = document.getElementById(id);
    var link = document.querySelector('nav a[href="#' + id + '"]');
    if (section && link) items.push({ id: id, section: section, link: link });
  });
  if (!items.length) return;

  var current = null;
  function setCurrent(id) {
    if (id === current) return;
    current = id;
    for (var i = 0; i < items.length; i++) {
      items[i].link.classList.toggle('nav-current', items[i].id === id);
    }
  }

  function pick() {
    // Reference line, measured down from the top of the viewport: the current
    // section is the last one whose top has scrolled above it. Normally it sits
    // ~40% down (below the sticky header). Over the final stretch of the page it
    // slides on down toward the viewport bottom, so a short last section (e.g.
    // Contact on a tall screen) — which the page can't scroll far enough to lift
    // all the way to the 40% line before hitting the end — still lights up as it
    // enters the lower viewport. Earlier sections cross the 40% line well before
    // that stretch, so their behaviour is unchanged on every screen. Default to
    // the first section so a link always glows.
    var innerH = window.innerHeight;
    var distToBottom = document.documentElement.scrollHeight - (window.pageYOffset + innerH);
    var ref = Math.min(innerH, Math.max(innerH * 0.4, innerH - distToBottom));
    var id = items[0].id;
    for (var i = 0; i < items.length; i++) {
      if (items[i].section.getBoundingClientRect().top <= ref) id = items[i].id;
    }
    setCurrent(id);
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { ticking = false; pick(); });
  }

  pick();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  window.addEventListener('load', pick);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) pick(); });
})();
