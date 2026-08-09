(function () {
  'use strict';

  /*
   * The Skills section's scroll-driven pictures. Five effects, one pass:
   *
   *   [data-anim-frames]   the Animation picture, played frame by frame
   *   [data-scrub-frames]  the Texturing picture, a sequence scrubbed by scroll
   *   [data-wipe-frames]   the Grading picture, each frame wiped in from the left
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
  var wipes = Array.prototype.slice.call(document.querySelectorAll('[data-wipe-frames]'));
  var scalers = Array.prototype.slice.call(document.querySelectorAll('[data-scroll-scale]'));
  var shrinkers = Array.prototype.slice.call(document.querySelectorAll('[data-scroll-shrink]'));
  if (!stacks.length && !scrubs.length && !wipes.length && !scalers.length && !shrinkers.length) return;

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

  function rawPass(el) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var span = vh + r.height;
    return clamp01(span > 0 ? (vh - r.top) / span : 0);
  }

  function passProgress(el) {
    var moving = 1 - HOLD_IN - HOLD_OUT;
    return clamp01(moving > 0 ? (rawPass(el) - HOLD_IN) / moving : 0);
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
   * would never be a picture. So exactly one frame is ever visible: the handover
   * is a hard cut, the way a sequence of stills is meant to run, and no two
   * frames are ever on screen together to blend into one another.
   */
  function frameReady(f) {
    var img = f.__img;
    return !!img && img.complete && img.naturalWidth > 0;
  }

  function updateScrub(el) {
    var frames = el.__frames;
    if (!frames || frames.length < 2) return;
    var i = Math.floor(passProgress(el) * (frames.length - 1));
    if (i > frames.length - 1) i = frames.length - 1;

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

    for (var k = 0; k < frames.length; k++) {
      frames[k].style.opacity = k === cur ? '1' : '0';
    }
  }

  /*
   * ---- the Grading sequence ------------------------------------------------
   *
   * Each frame is wiped in over the one before it by an edge that travels left
   * to right across the picture, so a frame arrives the way a grade is revealed
   * across a shot rather than by fading up in place.
   *
   * The whole sequence is over by the time the picture is centred, and the last
   * frame then holds for the rest of the pass and every scroll position below
   * it. That frame is the finished grade — the point of the sequence — so it is
   * the one you get to sit with, rather than the one that flicks past as the
   * section leaves. Scrolling back up runs the wipes in reverse.
   *
   * Respecting what the frames themselves let through is the whole trick here,
   * and it is why the outgoing frame is masked rather than simply left in place
   * underneath. Where the wipe has passed, the new frame is alone: it is the
   * only thing painted there, so wherever it is transparent you see the page,
   * not a leftover of the frame before. The two only ever overlap inside the
   * seam itself, and there the outgoing frame is solid beneath the incoming
   * one's fade, so the blend is between the two pictures and never lets the
   * background up through the middle of it — the same reason the Texturing
   * sequence never faded two frames at once.
   */

  // Width of the soft edge of the wipe, as a percentage of the picture. Wide
  // enough to read as a blend rather than a line sweeping past, narrow enough
  // that what you are looking at is a frame and not a permanent smear.
  var SEAM = 7;

  /*
   * How far through its wipes the sequence is: nought while the picture is
   * arriving, one by the time it is centred. rawPass is 0.5 exactly when the
   * element is centred, so that is where the last frame lands — and since it is
   * clamped, everything below the middle of the section holds it.
   */
  function wipeProgress(el) {
    return clamp01((rawPass(el) - HOLD_IN) / (0.5 - HOLD_IN));
  }

  function setMask(f, m) {
    // Mask strings cost more to parse than a number, and most animation frames
    // leave the hidden ones exactly as they were, so only write what changed.
    if (f.__mask === m) return;
    f.__mask = m;
    f.style.webkitMaskImage = m;
    f.style.maskImage = m;
  }

  function updateWipe(el) {
    var frames = el.__frames;
    if (!frames || frames.length < 2) return;
    var pos = wipeProgress(el) * (frames.length - 1);
    var i = Math.floor(pos);
    if (i > frames.length - 1) i = frames.length - 1;
    var frac = pos - i;

    // Frames that have not decoded are held back exactly as in the Texturing
    // sequence: show the last one that did rather than wiping to nothing.
    var cur = i;
    while (cur >= 0 && !frameReady(frames[cur])) cur--;
    if (cur < 0) return; // nothing decoded yet — leave the stack as the CSS has it

    var nextIdx = cur === i && i + 1 < frames.length && frameReady(frames[i + 1]) ? i + 1 : -1;

    /*
     * The seam runs from one width off the left edge to one width past the
     * right, so at the start of a wipe nothing is revealed yet and at the end
     * the last column is. `lead` is where the new frame has taken over
     * completely; `edge` is where it has not begun.
     */
    var edge = frac * (100 + SEAM);
    var lead = edge - SEAM;

    for (var k = 0; k < frames.length; k++) {
      var f = frames[k];
      if (k === nextIdx) {
        f.style.opacity = '1';
        setMask(f, 'linear-gradient(to right, #000 ' + lead.toFixed(2) + '%, transparent ' + edge.toFixed(2) + '%)');
      } else if (k === cur) {
        f.style.opacity = '1';
        // Cut off flush with the seam, not faded out across it: past `lead` the
        // incoming frame is fully opaque and covers this one anyway, and before
        // it this one has to be gone or it shows through wherever the new frame
        // is transparent.
        setMask(f, nextIdx < 0 ? 'none'
          : 'linear-gradient(to right, transparent ' + lead.toFixed(2) + '%, #000 ' + lead.toFixed(2) + '%)');
      } else {
        f.style.opacity = '0';
      }
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
      for (var w = 0; w < wipes.length; w++) updateWipe(wipes[w]);
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

  // Both sequences hold at the last frame that decoded, so both have to be told
  // when another one arrives; the frame each is on is a property read rather
  // than a query, and a frame that failed to load is never mistaken for one that
  // simply has not arrived yet.
  scrubs.concat(wipes).forEach(function (el) {
    el.__frames = Array.prototype.slice.call(el.querySelectorAll('.sf, .wf'));
    el.__frames.forEach(function (f) {
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
