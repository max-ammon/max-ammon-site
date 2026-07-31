(function () {
  'use strict';

  /*
   * The two floating hints on the main page: one whose arrow points up at the
   * Project Gallery button in the header, one whose arrow points down into the
   * page. They stay put for as long as the visitor is still reading — there is
   * no timer — and fade away the moment the page is moved. The fade is
   * deliberately unhurried so it reads as the hints stepping aside rather than
   * blinking out.
   *
   * Everything positional is measured rather than assumed: the header is a
   * different height on desktop, in the narrow-desktop band and in the stacked
   * mobile layout, and the Gallery button moves with it (at some widths it wraps
   * onto a second row), so the arrow is aimed at wherever the button actually is.
   */
  var gallery = document.getElementById('hintGallery');
  var welcome = document.getElementById('hintWelcome');
  var hints = [gallery, welcome].filter(Boolean);
  if (!hints.length) return;

  var FADE_MS = 1700; // must cover the CSS transition before the nodes are removed
  var GAP = 14; // breathing room under the header

  var nav = document.querySelector('nav');
  // The header link the gallery hint points at.
  var target = null;
  var links = document.querySelectorAll('nav ul li a');
  for (var i = 0; i < links.length; i++) {
    if ((links[i].getAttribute('href') || '').indexOf('/gallery') === 0) target = links[i];
  }

  function place() {
    var navBottom = nav ? nav.getBoundingClientRect().bottom : 74;

    if (gallery) {
      // Tuck the arrow's tip just under the header, then slide the arrow
      // sideways until it sits under the button itself.
      gallery.style.top = Math.round(navBottom + 2) + 'px';
      var arrow = gallery.querySelector('.site-hint-arrow');
      if (arrow && target) {
        var g = gallery.getBoundingClientRect();
        var t = target.getBoundingClientRect();
        var w = arrow.getBoundingClientRect().width;
        var x = t.left + t.width / 2 - g.left - w / 2;
        // Never let it wander off the box it grows out of.
        arrow.style.left = Math.round(Math.max(14, Math.min(g.width - w - 14, x))) + 'px';
      }
    }

    if (welcome) {
      var top = navBottom + GAP;
      if (gallery) {
        // On narrow layouts both hints span the width, so drop this one below
        // the other rather than letting them overlap.
        var gr = gallery.getBoundingClientRect();
        var wr = welcome.getBoundingClientRect();
        if (gr.left < wr.right && wr.left < gr.right) top = Math.max(top, gr.bottom + GAP);
      }
      welcome.style.top = Math.round(top) + 'px';
    }
  }

  place();
  window.addEventListener('resize', place);
  // The header settles once its font has loaded, so measure again shortly after.
  setTimeout(place, 250);
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(place).catch(function () {});
  }

  var dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    hints.forEach(function (h) {
      h.classList.add('is-out');
    });
    // Take them out of the document once they're invisible.
    setTimeout(function () {
      hints.forEach(function (h) {
        if (h.parentNode) h.parentNode.removeChild(h);
      });
    }, FADE_MS);
  }

  // "The page is moved" — any of these means the visitor has started looking
  // around. Passive listeners so they never delay the scroll itself.
  ['scroll', 'wheel', 'touchmove', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, dismiss, { passive: true, once: true });
  });
})();
