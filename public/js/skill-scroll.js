(function () {
  'use strict';

  /*
   * The page's scroll-driven pictures — mostly the Skills section's, and the
   * two elsewhere that are the same kind of thing. Six effects, one pass:
   *
   *   [data-anim-frames]   the Animation picture, played frame by frame
   *   [data-scrub-frames]  the Texturing picture, a sequence scrubbed by scroll
   *   [data-slit-layers]   the same picture, cut into slits travelling across it
   *   [data-wipe-frames]   the Grading picture, each frame wiped in from the left
   *   [data-scroll-scale]  the Modeling pair, largest as the section passes
   *   [data-scroll-shrink] the demo's play button, shrinking as you leave it
   *   [data-scroll-zoom]   the About picture, settling into frame as it arrives
   *   [data-scroll-unblur] the About banner, sharpening as the section arrives
   *
   * They nearly all read the same notion of how far through its pass an element
   * is — the About picture is the exception, since it is measured against its
   * section rather than the screen — and all run off one listener and one
   * animation frame, so they can never drift apart or cost more than one pass
   * of work.
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
  var slits = Array.prototype.slice.call(document.querySelectorAll('[data-slit-layers]'));
  var wipes = Array.prototype.slice.call(document.querySelectorAll('[data-wipe-frames]'));
  var scalers = Array.prototype.slice.call(document.querySelectorAll('[data-scroll-scale]'));
  var shrinkers = Array.prototype.slice.call(document.querySelectorAll('[data-scroll-shrink]'));
  var zoomers = Array.prototype.slice.call(document.querySelectorAll('[data-scroll-zoom]'));
  var unblurs = Array.prototype.slice.call(document.querySelectorAll('[data-scroll-unblur]'));
  if (!stacks.length && !scrubs.length && !slits.length && !wipes.length && !scalers.length
      && !shrinkers.length && !zoomers.length && !unblurs.length) return;

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
   * ---- the Texturing slits -------------------------------------------------
   *
   * The same picture as the sequence above, made a different way. Instead of
   * stills that each hold the whole thing at one moment, the layers of the asset
   * are given whole — one picture per layer, all the size of the background they
   * sit on — and a band of slits travels across them: each layer shows through
   * its own slit and nowhere else, so the band reads as a cut through the render
   * with a different layer in every strip of it.
   *
   * Nothing about the movement is in the pictures, which is the point. Where the
   * band is, is one number. How wide a slit is, is another. The number of slits
   * is however many layers were uploaded. A sequence of stills has all three
   * baked into the files, so it can only step as finely as it has frames — at
   * sixteen stills across a picture this wide, each step moves the band further
   * than a slit is wide, and no amount of care in the export makes that smooth.
   * Here there are no steps at all.
   *
   * The whole band is one offset: slit i sits at x + i widths, so the browser is
   * told two lengths per frame and works out six positions from them. Hard edges
   * throughout — the mask is a solid block, not a gradient, so a slit is a cut
   * and neighbouring layers never bleed into one another.
   */
  function updateSlits(el) {
    var n = el.__count;
    if (!n) return;
    var w = el.getBoundingClientRect().width;
    if (!w) return; // the plate has not loaded yet, so there is nothing to cut

    var slit = (w * el.__pct) / 100;
    var band = slit * n;
    /*
     * From the band wholly off the left edge to wholly off the right, so it
     * arrives and leaves rather than appearing part-way across. The pass holds
     * at both ends the way the sequences do, which is what keeps the picture
     * whole for a moment before and after.
     */
    var x = -band + passProgress(el) * (w + band);

    el.style.setProperty('--slit-w', slit.toFixed(2) + 'px');
    el.style.setProperty('--slit-x', x.toFixed(2) + 'px');
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
   * arriving, one by WIPE_END — and clamped, so from there down the last frame
   * simply stays.
   *
   * rawPass is 0.5 exactly where the picture is centred, so 0.42 lands the last
   * frame a little above that: settled and being looked at by the time the
   * picture reaches the middle, rather than only arriving there.
   *
   * The two ends move together on purpose. Pulling only the finish up would
   * leave the same number of wipes to run across less scroll and hurry every one
   * of them; starting the first wipe as much earlier keeps them at the pace they
   * had (0.32 of the pass against 0.35) and moves the whole sequence up the
   * screen instead. What that spends is the opening hold on the first frame,
   * which is the one frame this sequence is not about.
   */
  var WIPE_IN = 0.1;
  var WIPE_END = 0.42;

  function wipeProgress(el) {
    return clamp01((rawPass(el) - WIPE_IN) / (WIPE_END - WIPE_IN));
  }

  /*
   * Which of the three parts a frame is playing. The mask and the clip that go
   * with a part are in the stylesheet, so this is a class rather than a set of
   * properties, and it is only touched when a frame actually changes part —
   * which is a few times a pass, not sixty times a second.
   */
  function setRole(f, role) {
    if (f.__role === role) return;
    f.__role = role;
    f.classList.toggle('wf-in', role === 'in');
    f.classList.toggle('wf-out', role === 'out');
    // Whatever the last part left behind is not this one's to inherit.
    if (role !== 'in') {
      f.style.webkitMaskPosition = '';
      f.style.maskPosition = '';
    }
    if (role !== 'out') f.style.clipPath = '';
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

    /*
     * The incoming frame's soft edge is one fixed picture, three times the width
     * of the frame — opaque, then the seam, then nothing — slid along until its
     * boundary sits where the wipe has got to. Sliding a mask moves where it is
     * sampled; rewriting one makes the browser draw it again, and a browser that
     * is asked to redraw a mask on every animation frame of a scroll can be
     * caught painting the frame without it. That is what this used to do.
     *
     * With the mask three times the width, its own position runs 0% to 50% as
     * the boundary crosses the picture: a percentage places the image's left
     * edge across (frame - mask) = -2 widths, so the boundary, one width in from
     * that edge, lands at 1 - 2p of the way across.
     */
    var maskPos = (50 * (1 - lead / 100)).toFixed(3) + '% 0';

    for (var k = 0; k < frames.length; k++) {
      var f = frames[k];
      if (k === nextIdx) {
        f.style.opacity = '1';
        setRole(f, 'in');
        f.style.webkitMaskPosition = maskPos;
        f.style.maskPosition = maskPos;
      } else if (k === cur) {
        f.style.opacity = '1';
        /*
         * Cut off flush with the seam, not faded out across it: past `lead` the
         * incoming frame is fully opaque and covers this one anyway, and before
         * it this one has to be gone or it shows through wherever the new frame
         * is transparent. A hard edge needs no mask at all — clip-path cuts the
         * shape rather than painting a stencil over it, which is one less thing
         * for a browser to rasterise and get wrong.
         */
        if (nextIdx < 0) {
          setRole(f, 'whole');
        } else {
          setRole(f, 'out');
          f.style.clipPath = 'inset(0 0 0 ' + Math.max(0, lead).toFixed(2) + '%)';
        }
      } else {
        f.style.opacity = '0';
        setRole(f, 'hidden');
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
   * ---- settling into frame -------------------------------------------------
   * The About picture: zoomed half again past its framing as it comes onto the
   * screen, at that framing by the time its section is in view, and staying
   * there for the whole way down. So scrolling to it opens the picture out rather than
   * enlarging it — more of the photograph as it settles. One-sided, unlike the
   * Modeling pair: this one arrives and stays arrived rather than swelling past
   * and shrinking away again.
   *
   * The mask is a box of its own and this scales the picture inside it, so the
   * circle does not move or change size — only what is behind it does. It also
   * only ever zooms in past the framing, never below it, and that is not a
   * detail: the framing is the picture at cover, the least zoom that fills a
   * round hole with a rectangular photo, so anything below it would pull the
   * picture off the edge of the circle and let the page show through the gap.
   *
   * "In view" has to mean two things, because a section can be taller than the
   * screen or shorter than it. Shorter, and it is fully in view once its bottom
   * reaches the bottom of the screen; taller, and the fullest view there is comes
   * when its top reaches the top. Either way it is the moment the section is as
   * completely on screen as it is ever going to be, which is where the settling
   * should be over.
   */
  /*
   * Half again at the start. Worth knowing where that lands: the picture is
   * drawn at one and a half times the circle while it arrives, so the file it
   * is given has to be big enough for that and not for the resting size —
   * which is what the `sizes` on it is written for.
   */
  var ZOOM_FROM = 1.5;

  /*
   * How much further something has to travel before it is as completely on
   * screen as it can be. Shorter than the screen, that is its bottom reaching
   * the bottom; taller than it, its top reaching the top — the fullest view
   * there is of something that cannot fit.
   */
  function untilFullyInView(r, vh) {
    var left = r.height <= vh ? r.bottom - vh : r.top;
    return left < 0 ? 0 : left;
  }

  function updateZoom(el) {
    var vh = window.innerHeight || document.documentElement.clientHeight;
    // The element's own rect is its scaled one, and feeding a transform back
    // into the measurement that produces it makes the effect chase itself. Its
    // box is the parent's — here the mask — which the transform does not touch.
    var b = el.__box.getBoundingClientRect();
    var s = el.__section.getBoundingClientRect();

    // How far it has come since the picture's top edge touched the bottom of the
    // screen, and how much further until the section is as in view as it gets.
    var came = vh - b.top;
    if (came < 0) came = 0;
    var left = untilFullyInView(s, vh);

    /*
     * Both of those move one-for-one with the scroll, so their sum is the whole
     * distance between the two moments and the ratio is linear in scroll — no
     * absolute positions to work out and nothing to recompute when the page
     * reflows. A sine eases it so it settles into its framing instead of
     * arriving at a corner.
     */
    var span = came + left;
    var p = span > 0 ? came / span : 1;
    var z = ZOOM_FROM + (1 - ZOOM_FROM) * Math.sin((clamp01(p) * Math.PI) / 2);
    el.style.transform = 'scale(' + z.toFixed(4) + ')';
  }

  /*
   * ---- coming into focus ---------------------------------------------------
   * The About banner arrives soft and sharpens as you scroll to it, clear by the
   * moment the profile picture below it is completely on screen — which is what
   * it is measured against, rather than anything about the banner itself. The
   * two together read as the section resolving as you reach it.
   *
   * A blurred picture fades out past its own edges, so while it is soft it is
   * drawn a little larger and the box around it clips that overscan away. The
   * amount is tied to the blur, so what is hidden is exactly the fade and the
   * picture is back to its own size the moment it is sharp.
   *
   * Blur is the most expensive thing on this page to ask for every frame, so it
   * is written only when it has actually changed, and cleared outright rather
   * than left at blur(0) — a filter that is set at all keeps the element on its
   * own layer, and there is nothing to gain from that once it is sharp.
   */
  var BLUR_MAX = 12; // px, at the moment it comes onto the screen

  function updateUnblur(el) {
    if (!el.__target) return; // nothing to be sharp by: leave the picture alone
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var came = vh - el.__box.getBoundingClientRect().top;
    if (came < 0) came = 0;
    var left = untilFullyInView(el.__target.getBoundingClientRect(), vh);
    var span = came + left;
    var p = span > 0 ? came / span : 1;
    // Eased the same way as the others, so it settles into sharp rather than
    // arriving there at full speed.
    var blur = Math.round(BLUR_MAX * (1 - Math.sin((clamp01(p) * Math.PI) / 2)) * 10) / 10;
    if (blur === el.__blur) return;
    el.__blur = blur;
    if (blur < 0.05) {
      el.style.filter = '';
      el.style.transform = '';
    } else {
      el.style.filter = 'blur(' + blur + 'px)';
      el.style.transform = 'scale(' + (1 + blur * 0.003).toFixed(4) + ')';
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
      for (var s = 0; s < scrubs.length; s++) updateScrub(scrubs[s]);
      for (var l = 0; l < slits.length; l++) updateSlits(slits[l]);
      for (var w = 0; w < wipes.length; w++) updateWipe(wipes[w]);
      for (var j = 0; j < scalers.length; j++) updateScale(scalers[j]);
      for (var k = 0; k < shrinkers.length; k++) updateShrink(shrinkers[k]);
      for (var g = 0; g < zoomers.length; g++) updateZoom(zoomers[g]);
      for (var u = 0; u < unblurs.length; u++) updateUnblur(unblurs[u]);
    });
  }

  slits.forEach(function (el) {
    el.__count = el.querySelectorAll('.sl').length;
    // How wide a slit is, as a percentage of the picture, so it means the same
    // thing at every screen width. The fallback is only ever reached by markup
    // written by hand.
    el.__pct = parseFloat(el.getAttribute('data-slit')) || 6.5;
    // The band is measured against the stack, and the stack is the plate — so
    // until the plate has arrived there is no width to cut up.
    Array.prototype.slice.call(el.querySelectorAll('img')).forEach(function (img) {
      if (!img.complete) img.addEventListener('load', schedule, { once: true });
    });
  });

  zoomers.forEach(function (el) {
    // Measured through its parent, and stopped at its own section: what "in
    // view" means is the section's business, and taking it from the element
    // keeps the effect free of anything named.
    el.__box = el.parentElement || el;
    el.__section = (el.closest && el.closest('section')) || el.__box;
  });

  unblurs.forEach(function (el) {
    // Measured through its parent for the same reason as the picture above: this
    // one is scaled while it is soft, and its own rect would carry that scale.
    el.__box = el.parentElement || el;
    el.__blur = -1;
    // What it has to be sharp by, named in the markup rather than here — a bad
    // selector leaves the picture alone rather than throwing the whole file over.
    var sel = el.getAttribute('data-scroll-unblur') || '';
    try {
      el.__target = sel ? document.querySelector(sel) : null;
    } catch (e) {
      el.__target = null;
    }
  });

  // A box only settles once its pictures have loaded, and they are lazy — so
  // recompute as each arrives, exactly as the frames do. The About picture is
  // measured element rather than a box holding one, and a picture that has not
  // arrived has no size at all, so it has to count as its own.
  scalers.concat(shrinkers).concat(zoomers).concat(unblurs).forEach(function (el) {
    var imgs = el.tagName === 'IMG' ? [el] : Array.prototype.slice.call(el.querySelectorAll('img'));
    imgs.forEach(function (img) {
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
