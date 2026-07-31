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
  var ARROW_GAP = 4; // clearance between the down arrow's tip and what follows

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
      fitDownArrow();
    }
  }

  /*
   * Keep the down arrow out of the demo where there's room to, so its tip stops
   * cleanly at the poster's edge rather than trailing across the image. Where
   * there isn't room — on a phone the box already sits over the poster — it
   * keeps a minimum length and relies on the dark halo the stylesheet gives it
   * to stay legible. A hint without its arrow is worse than a short one.
   */
  var MIN_ARROW = 14;
  function fitDownArrow() {
    var arrow = welcome && welcome.querySelector('.site-hint-arrow');
    var below = document.querySelector('.demo-embed') || document.querySelector('.demobox');
    if (!arrow || !below) return;
    var box = welcome.querySelector('.site-hint-box');
    if (!box) return;
    arrow.style.height = ''; // measure the stylesheet's length, not the last fit
    var full = arrow.getBoundingClientRect().height;
    var room = below.getBoundingClientRect().top - box.getBoundingClientRect().bottom - ARROW_GAP;
    arrow.style.height = Math.max(MIN_ARROW, Math.min(full, Math.floor(room))) + 'px';
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

  /*
   * Anything that means the visitor has started using the page. pointerdown
   * matters as much as scrolling: someone who lands here and goes straight for
   * the demo's play button never moves the page at all, and used to be left
   * watching the video with the hints still sitting over it.
   *
   * Capture phase, because the play button stops the event from bubbling any
   * further, and passive so none of this can delay the scroll or the tap.
   */
  ['scroll', 'wheel', 'touchmove', 'keydown', 'pointerdown'].forEach(function (ev) {
    window.addEventListener(ev, dismiss, { capture: true, passive: true, once: true });
  });
})();
