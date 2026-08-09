(function () {
  'use strict';

  /*
   * The Skills section's scroll-driven pictures. Four effects, one pass:
   *
   *   [data-anim-frames]   the Animation picture, played frame by frame
   *   [data-scrub-frames]  the Texturing picture, a sequence scrubbed by scroll
   *   [data-scroll-scale]  the Modeling pair, largest as the section passes
   *   [data-scroll-shrink] the demo's play button, shrinking as you leave it
   *
   * They all read the same notion of how far through its pass an element is, and
   * all run off one listener and one animation frame, so they can never drift
   * apart or cost more than one pass of work.
   *
   * ---- the Animation picture --------------------------------------------
   *
   * Its frames are stacked in one box — the same box the single image used to
   * occupy — and scroll position picks which one is "current". The current
   * frame is fully opaque and carries a slight aqua tint; the frames on either
   * side of it sit behind at lower opacity, further back the further away they
   * are, like onion skins in an animation program. Scroll on and the tint and
   * the opacity hand over to the next frame.
   *
   * Everything is a continuous function of scroll position, so it reads as one
   * smooth cross-fade rather than three states snapping between each other.
   *
   * Only opacity and colour change — nothing moves, nothing is animated on its
   * own — so this is left alone under prefers-reduced-motion, which is about
   * movement rather than any change at all.
   */
  var stacks = Array.prototype.slice.call(document.querySelectorAll('[data-anim-frames]'));
  var scrubs = Array.prototype.slice.call(document.querySelectorAll('[data-scrub-frames]'));
  var scalers = Array.prototype.slice.call(document.querySelectorAll('[data-scroll-scale]'));
  var shrinkers = Array.prototype.slice.call(document.querySelectorAll('[data-scroll-shrink]'));
  if (!stacks.length && !scrubs.length && !scalers.length && !shrinkers.length) return;

  // How far back a frame sits at one and at two frames from the current one.
  var NEAR = 0.45;
  var FAR = 0.18;
  var TINT_MAX = 0.45; // strength of the aqua on the current frame

  /*
   * Dead zones at either end of the pass, as a fraction of it: the first frame
   * holds while the section is arriving and the last one holds as it leaves,
   * so both are on screen properly rather than only being touched in passing.
   *
   * These two and the speed of the handover are the same dial. The section only
   * travels so far, so every bit held at the ends is scroll the moving part no
   * longer has — raise them and the frames change over more quickly. At 0.15
   * each the handover runs across 70% of the pass, so it is about 1.4x brisker
   * than with no holds at all.
   */
  var HOLD_IN = 0.15;
  var HOLD_OUT = 0.15;

  /*
   * How far an element is through its pass across the screen: 0 as its top
   * reaches the bottom of the screen, 1 once its bottom has left the top —
   * which puts 0.5 exactly where it is centred, so "the middle of the section"
   * is genuinely the middle. The ends are spent holding (see above), and the
   * whole 0..1 is fitted into what is left.
   */
  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function passProgress(el) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var span = vh + r.height;
    var p = clamp01(span > 0 ? (vh - r.top) / span : 0);
    var moving = 1 - HOLD_IN - HOLD_OUT;
    return clamp01(moving > 0 ? (p - HOLD_IN) / moving : 0);
  }

  // Opacity as a function of distance from the current frame. Continuous, and
  // flat past two frames out so a long sequence keeps a readable floor.
  function opacityFor(d) {
    if (d <= 1) return 1 - d * (1 - NEAR);
    if (d >= 2) return FAR;
    return NEAR - (d - 1) * (NEAR - FAR);
  }

  function update(stack) {
    var frames = stack.__frames;
    if (!frames || frames.length < 2) return;
    var current = passProgress(stack) * (frames.length - 1);
    for (var i = 0; i < frames.length; i++) {
      var d = Math.abs(i - current);
      var op = opacityFor(d);
      var f = frames[i];
      f.style.opacity = op.toFixed(3);
      // Tint only the current frame, fading out as the next one takes over.
      f.style.setProperty('--tint', (d >= 1 ? 0 : (1 - d) * TINT_MAX).toFixed(3));
      // Whichever frame is nearest has to sit on top of the ghosts behind it.
      f.style.zIndex = String(Math.round(op * 100));
    }
  }

  /*
   * ---- the Texturing sequence ----------------------------------------------
   *
   * A longer sequence — sixteen stills rather than three — played by scroll
   * position: scrolling down runs it forwards, scrolling back up runs it in
   * reverse, and it sits still when you do.
   *
   * The Animation picture's onion skins are wrong here. They are made for three
   * frames, where a ghost either side reads as an animator's drawing; across
   * sixteen it would leave four or five stills piled up at once and the picture
   * would never be a picture. So this shows one frame, cross-fading only into
   * the next as it hands over.
   *
   * The cross-fade leans on the stack: the outgoing frame stays fully opaque and
   * the incoming one fades in above it. Fading both at once would be the obvious
   * way and the wrong one — two half-transparent frames let the page background
   * through the middle of the blend, and the picture would go pale every time it
   * changed.
   */
  function frameReady(f) {
    var img = f.__img;
    return !!img && img.complete && img.naturalWidth > 0;
  }

  function updateScrub(el) {
    var frames = el.__frames;
    if (!frames || frames.length < 2) return;
    var pos = passProgress(el) * (frames.length - 1);
    var i = Math.floor(pos);
    if (i > frames.length - 1) i = frames.length - 1;
    var frac = pos - i;

    /*
     * Only ever show a frame that has actually arrived. The frames past the
     * first are lazy, so on a slow connection the sequence is still filling in
     * while the section comes up — and cutting to a frame that has not decoded
     * would blank the picture altogether. Holding the last one that did decode
     * makes that read as a sequence that is briefly coarse rather than broken.
     */
    var cur = i;
    while (cur >= 0 && !frameReady(frames[cur])) cur--;
    if (cur < 0) return; // nothing decoded yet — leave the stack as the CSS has it

    var nextIdx = -1;
    var blend = 0;
    if (cur === i && i + 1 < frames.length && frameReady(frames[i + 1])) {
      nextIdx = i + 1;
      blend = frac;
    }
    for (var k = 0; k < frames.length; k++) {
      var op = k === cur ? 1 : k === nextIdx ? blend : 0;
      frames[k].style.opacity = op.toFixed(3);
    }
  }

  /*
   * ---- the Modeling pair ---------------------------------------------------
   * Smallest as the section arrives and as it leaves, at its natural size when
   * the section is centred. transform never touches layout, so the pictures
   * only ever appear to change size — nothing around them moves, and scaling
   * the pair as one keeps the gap between them in proportion.
   *
   * A sine gives the shape for free: nought at both ends, one in the middle,
   * and flat where it peaks, so it settles at full size rather than snapping
   * through it. It never goes above 1, so "largest" is the size it has today.
   */
  var SCALE_MIN = 0.9;

  function updateScale(el) {
    var s = SCALE_MIN + (1 - SCALE_MIN) * Math.sin(Math.PI * passProgress(el));
    // A variable rather than the transform itself, so the stylesheet decides how
    // it composes — the play button, for one, is already centred by a translate.
    el.style.setProperty('--scale', s.toFixed(4));
  }

  /*
   * ---- leaving something behind --------------------------------------------
   * One-sided: full size for as long as the thing is still on its way to the
   * middle, then shrinking away as it carries on past and off the top. Used for
   * the demo's play button, which should be at its full size while you are
   * looking at the demo and get out of the way once you have moved on.
   *
   * The variable is set on the element measured, and custom properties inherit,
   * so the buttons inside it pick it up without being measured themselves —
   * which matters, because a hidden button has no box to measure.
   */
  var SHRINK_MIN = 0.5;

  function updateShrink(el) {
    var p = passProgress(el);
    var t = p <= 0.5 ? 0 : (p - 0.5) / 0.5;
    var s = 1 - (1 - SHRINK_MIN) * Math.sin((t * Math.PI) / 2);
    el.style.setProperty('--shrink', s.toFixed(4));
  }

  /*
   * Coalesce to one update per frame by replacing the pending request rather
   * than latching a flag: a flag that is only cleared inside the callback
   * freezes the whole effect for good if that callback is ever dropped.
   */
  var pending = 0;
  function schedule() {
    if (pending) window.cancelAnimationFrame(pending);
    pending = window.requestAnimationFrame(function () {
      pending = 0;
      for (var i = 0; i < stacks.length; i++) update(stacks[i]);
      for (var s = 0; s < scrubs.length; s++) updateScrub(scrubs[s]);
      for (var j = 0; j < scalers.length; j++) updateScale(scalers[j]);
      for (var k = 0; k < shrinkers.length; k++) updateShrink(shrinkers[k]);
    });
  }

  // The pair's box only settles once its pictures have loaded, and they are
  // lazy — so recompute as each arrives, exactly as the frames do.
  scalers.concat(shrinkers).forEach(function (el) {
    Array.prototype.slice.call(el.querySelectorAll('img')).forEach(function (img) {
      if (!img.complete) img.addEventListener('load', schedule, { once: true });
    });
  });

  stacks.forEach(function (stack) {
    stack.__frames = Array.prototype.slice.call(stack.querySelectorAll('.af'));
    // The box only gets its real height once the first frame has loaded, and
    // the frames are lazy — so recompute as each one arrives.
    stack.__frames.forEach(function (f) {
      var img = f.querySelector('img');
      if (img && !img.complete) img.addEventListener('load', schedule, { once: true });
    });
  });

  scrubs.forEach(function (el) {
    el.__frames = Array.prototype.slice.call(el.querySelectorAll('.sf'));
    el.__frames.forEach(function (f) {
      // Kept on the frame so the every-frame check is a property read rather
      // than a query, and so a frame that fails to load is never mistaken for
      // one that simply has not arrived yet.
      f.__img = f.querySelector('img');
      if (f.__img && !f.__img.complete) {
        f.__img.addEventListener('load', schedule, { once: true });
        f.__img.addEventListener('error', schedule, { once: true });
      }
    });
  });

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(schedule).catch(function () {});
  }
  schedule();
})();
