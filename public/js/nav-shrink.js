(function () {
  'use strict';

  /*
   * The header's size, tied to where the page is rather than to a moment in
   * time. It starts at its full size and reaches its smallest exactly as the
   * top edge of the demo meets the bottom edge of the header; in between it is
   * a straight ratio of how far you have scrolled toward that point.
   *
   * The script only ever sets a number, --nav-shrink, running 0 (large) to 1
   * (small). The stylesheet decides what that means, which is what lets hover
   * keep working untouched: nav:hover sets the full size outright and outranks
   * this, so hovering lifts a shrunken header back up and does nothing at all
   * to one that is already up.
   */
  var nav = document.querySelector('nav');
  if (!nav) return;

  var FALLBACK_END = 160; // pages with no demo under the header
  var endScroll = FALLBACK_END;

  /*
   * Where the shrink finishes, measured with the header ALREADY small — for two
   * reasons. Small is its size at the moment the two edges meet, so that is the
   * height to compare against. And the header is in normal flow, so its height
   * is part of where the demo sits: measuring large would place the demo 34px
   * lower than it will be, and reading the demo's position live each frame
   * would feed the header's own size back into the sum and run away.
   */
  function measure() {
    var target = document.querySelector('.demo-embed');
    var had = nav.style.getPropertyValue('--nav-shrink');
    // Leave the transition exactly as it was found: this runs again on resize
    // and once the fonts land, and leaving it suppressed would quietly cost
    // hover the glide it is supposed to keep.
    var wasTracking = nav.classList.contains('nav-tracking');
    nav.classList.add('nav-tracking'); // measure the size, not an animation to it
    nav.style.setProperty('--nav-shrink', '1');
    var smallHeight = nav.getBoundingClientRect().height;
    endScroll = target
      ? Math.max(1, target.getBoundingClientRect().top + window.pageYOffset - smallHeight)
      : FALLBACK_END;
    if (had) nav.style.setProperty('--nav-shrink', had);
    else nav.style.removeProperty('--nav-shrink');
    /*
     * Settle the restored size while the transition is still suppressed. The
     * read above forces the browser to compute the small size; without this
     * flush it would only see the size again once this whole function had
     * finished — by which point the transition is back on, and it would animate
     * from small up to large. That is a visible grow-in on every page load,
     * from a measurement the visitor should never have seen at all.
     */
    void nav.offsetHeight;
    if (!wasTracking) nav.classList.remove('nav-tracking');
  }

  function apply() {
    var q = window.pageYOffset / endScroll;
    if (q < 0) q = 0;
    else if (q > 1) q = 1;
    nav.style.setProperty('--nav-shrink', q.toFixed(4));
    // The heavier weight the small header has always carried. Weight cannot
    // tween between separate font files, so it lands at the end of the trip
    // rather than snapping somewhere in the middle of it.
    nav.classList.toggle('nav-small', q >= 1);
  }

  var pending = 0;
  function schedule() {
    if (pending) window.cancelAnimationFrame(pending);
    pending = window.requestAnimationFrame(function () {
      pending = 0;
      apply();
    });
  }

  /*
   * While the scroll is driving the size there is no transition: the whole
   * point is that the header sits where the page is, not somewhere it is easing
   * towards. A moment after scrolling stops the transition comes back, so
   * hovering on and off still glides the way it always has.
   */
  var settle;
  window.addEventListener(
    'scroll',
    function () {
      nav.classList.add('nav-tracking');
      clearTimeout(settle);
      settle = setTimeout(function () {
        nav.classList.remove('nav-tracking');
      }, 150);
      schedule();
    },
    { passive: true }
  );

  function remeasure() {
    measure();
    schedule();
  }
  window.addEventListener('resize', remeasure);
  // Anything above the demo that loads late moves it, and with it the point the
  // shrink is aimed at.
  window.addEventListener('load', remeasure);
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(remeasure).catch(function () {});
  }

  measure();
  apply(); // no rAF here: the first paint should already be the right size
})();
