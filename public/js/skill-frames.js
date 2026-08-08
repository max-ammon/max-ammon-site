(function () {
  'use strict';

  /*
   * The Animation skill's picture, played by scrolling.
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
  if (!stacks.length) return;

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
    var r = stack.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    /*
     * 0 as the picture's top reaches the bottom of the screen (it is arriving),
     * 1 once its bottom has passed the top (it is gone) — which puts 0.5
     * exactly where the picture is centred on screen, so "the middle of the
     * section" is the middle frame rather than something that only looks close.
     */
    var span = vh + r.height;
    var p = span > 0 ? (vh - r.top) / span : 0;
    if (p < 0) p = 0;
    else if (p > 1) p = 1;

    // Spend the ends holding, and fit the whole handover into what's left.
    var moving = 1 - HOLD_IN - HOLD_OUT;
    p = moving > 0 ? (p - HOLD_IN) / moving : 0;
    if (p < 0) p = 0;
    else if (p > 1) p = 1;

    var current = p * (frames.length - 1);
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
    });
  }

  stacks.forEach(function (stack) {
    stack.__frames = Array.prototype.slice.call(stack.querySelectorAll('.af'));
    // The box only gets its real height once the first frame has loaded, and
    // the frames are lazy — so recompute as each one arrives.
    stack.__frames.forEach(function (f) {
      var img = f.querySelector('img');
      if (img && !img.complete) img.addEventListener('load', schedule, { once: true });
    });
  });

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(schedule).catch(function () {});
  }
  schedule();
})();
