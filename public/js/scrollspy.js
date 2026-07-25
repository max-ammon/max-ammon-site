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
    // A reference line ~40% down the viewport, below the sticky header. The
    // current section is the last one whose top has scrolled above that line;
    // default to the first so a link always glows, even at the very top.
    var line = window.innerHeight * 0.4;
    var id = items[0].id;
    for (var i = 0; i < items.length; i++) {
      if (items[i].section.getBoundingClientRect().top <= line) id = items[i].id;
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
