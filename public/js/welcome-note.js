(function () {
  'use strict';

  /*
   * The floating welcome note on the main page. It starts visible, tucks itself
   * under the header, and fades away the moment the visitor moves the page — or
   * after a few seconds if they don't. The fade is deliberately unhurried so it
   * reads as the note stepping aside rather than blinking out.
   */
  var note = document.getElementById('welcomeNote');
  if (!note) return;

  var HOLD_MS = 10000; // fade anyway after this long
  var FADE_MS = 1700; // must cover the CSS transition before the node is removed

  // Sit just below the header, whatever height it currently is (it differs
  // between desktop, the narrow-desktop band and the stacked mobile layout).
  var nav = document.querySelector('nav');
  function place() {
    if (!nav) return;
    var h = nav.getBoundingClientRect().height;
    if (h) note.style.top = Math.round(h + 14) + 'px';
  }
  place();
  // The header settles once its font has loaded, so measure again shortly after.
  window.addEventListener('resize', place);
  setTimeout(place, 250);
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(place).catch(function () {});
  }

  var dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(holdTimer);
    note.classList.add('is-out');
    // Take it out of the document once it's invisible.
    setTimeout(function () {
      if (note.parentNode) note.parentNode.removeChild(note);
    }, FADE_MS);
  }

  var holdTimer = setTimeout(dismiss, HOLD_MS);

  // "The page is moved" — any of these means the visitor has started looking
  // around. Passive listeners so they never delay the scroll itself.
  ['scroll', 'wheel', 'touchmove', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, dismiss, { passive: true, once: true });
  });
})();
