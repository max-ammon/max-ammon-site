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
   * Where the header's height jumps instead of gliding, and how far either side
   * of that point its size is held still.
   *
   * Narrow screens lay the header out as a column, and its row of links sits on
   * two lines at the full size but one line at the smallest — five links cannot
   * fit across a phone at full size, so the row has to change over somewhere.
   * Measured at 375px it changes over 96.6% of the way down the trip, and it is
   * decided by 0.9px of width: barely half a pixel of scrolling. With the size
   * tied to the scroll position that closely, the ordinary jitter at the end of
   * a flick re-wrapped the row over and over, and each re-wrap moves the header
   * by 14px. The header is sticky and in flow, so the page under it jumped with
   * it, which the browser then tried to correct by nudging the scroll position
   * — feeding the size straight back into its own input.
   *
   * So the changeover is held: the size stops a few pixels short of the jump and
   * only commits once you have clearly scrolled past it, not because the page
   * settled a pixel the wrong side of it. It then happens once, decisively. Wide
   * screens keep their links on one row at every size and have no jump at all;
   * there none of this arms and the size stays exactly continuous.
   */
  var STEP_MIN = 6; // px of height a jump must beat the steady decline by
  var BAND_PX = 5; // px of scroll held either side of the jump
  var stepQ = -1; // where the jump is, or -1 for a header that has none
  var stepLo = 0;
  var stepHi = 0;
  var pastStep = false;

  function heightAt(q) {
    nav.style.setProperty('--nav-shrink', q.toFixed(4));
    return nav.getBoundingClientRect().height;
  }

  /*
   * Find the jump by walking the header from full size to smallest, watching
   * for a drop far larger than the steady decline between samples, then halving
   * in on it. Reading it off the page beats hard-coding a number: it stays right
   * at any width, and at whatever length the owner makes the link names.
   */
  function findStep() {
    var COARSE = 16;
    var full = heightAt(0);
    var prev = full;
    var drop = 0;
    var lo = 0;
    var hi = 0;
    for (var i = 1; i <= COARSE; i++) {
      var q = i / COARSE;
      var h = heightAt(q);
      if (prev - h > drop) {
        drop = prev - h;
        lo = (i - 1) / COARSE;
        hi = q;
      }
      prev = h;
    }
    /*
     * The header does not shrink perfectly smoothly even without a re-wrap: a
     * line of text is a whole number of pixels tall, so its height comes down a
     * staircase of a pixel or two per line — measured at 4px across the whole
     * header. Judge a drop against the decline expected across one sample
     * anyway, so what counts as a jump scales with how far this header travels
     * rather than being a number that happens to suit one phone.
     */
    if (drop - (full - prev) / COARSE < STEP_MIN) return -1;
    // Half the drop tells the jump apart from the gradual shrinking that also
    // happens across the same interval, which is a fraction of its size.
    var edge = drop / 2;
    var top = heightAt(lo);
    for (var j = 0; j < 6; j++) {
      var mid = (lo + hi) / 2;
      if (top - heightAt(mid) > edge) hi = mid;
      else lo = mid;
    }
    return hi;
  }

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
    nav.classList.add('nav-tracking'); // measure sizes, not animations to them
    stepQ = findStep();
    nav.style.setProperty('--nav-shrink', '1');
    var smallHeight = nav.getBoundingClientRect().height;
    endScroll = target
      ? Math.max(1, target.getBoundingClientRect().top + window.pageYOffset - smallHeight)
      : FALLBACK_END;
    // The hold is set in pixels of scrolling, since what it has to outlast —
    // the page settling a pixel or two at the end of a flick — is measured in
    // pixels too, not in fractions of however long this particular trip is.
    stepLo = stepQ < 0 ? 0 : Math.max(0, stepQ - BAND_PX / endScroll);
    stepHi = stepQ < 0 ? 0 : Math.min(1, stepQ + BAND_PX / endScroll);
    if (had) nav.style.setProperty('--nav-shrink', had);
    else nav.style.removeProperty('--nav-shrink');
    /*
     * Settle the restored size while the transition is still suppressed. The
     * reads above force the browser to compute the sizes it was asked for;
     * without this flush it would only see the size again once this whole
     * function had finished — by which point the transition is back on, and it
     * would animate from small up to large. That is a visible grow-in on every
     * page load, from a measurement the visitor should never have seen at all.
     */
    void nav.offsetHeight;
    if (!wasTracking) nav.classList.remove('nav-tracking');
  }

  // Hold the size still across the jump, and commit to whichever side of the
  // band the page leaves it on.
  function hold(q) {
    if (stepQ < 0) return q;
    if (q >= stepHi) pastStep = true;
    else if (q <= stepLo) pastStep = false;
    if (pastStep) return q < stepHi ? stepHi : q;
    return q > stepLo ? stepLo : q;
  }

  function apply() {
    var q = window.pageYOffset / endScroll;
    if (q < 0) q = 0;
    else if (q > 1) q = 1;
    nav.style.setProperty('--nav-shrink', hold(q).toFixed(4));
    // The heavier weight the small header has always carried. Weight cannot
    // tween between separate font files, so it lands at the end of the trip
    // rather than snapping somewhere in the middle of it. It follows the real
    // scroll position, not the held one, so it still arrives with the smallest
    // size rather than a few pixels before it.
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

  /*
   * Only a change of width can move the finish line: measured across viewports
   * from 455px to 900px tall it did not shift by a pixel, because nothing above
   * the demo is sized against the viewport's height. Phones fire resize
   * constantly while you scroll, as the address bar slides away, and measuring
   * means resizing the header twice to read it — work worth skipping in the
   * middle of the very scroll it would disturb.
   */
  var lastWidth = window.innerWidth;
  var resizing;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizing);
    resizing = setTimeout(remeasure, 100);
  });
  // Anything above the demo that loads late moves it, and with it the point the
  // shrink is aimed at.
  window.addEventListener('load', remeasure);
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(remeasure).catch(function () {});
  }

  measure();
  apply(); // no rAF here: the first paint should already be the right size
})();
