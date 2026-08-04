(function () {
  'use strict';

  var modal = document.getElementById('mediaViewer');
  if (!modal) return;

  var stage = modal.querySelector('.viewer-stage');
  var btnPrev = modal.querySelector('[data-viewer-prev]');
  var btnNext = modal.querySelector('[data-viewer-next]');
  var btnClose = modal.querySelector('[data-viewer-close]');
  var btnFull = modal.querySelector('[data-viewer-fullscreen]');
  var content = modal.querySelector('.vidmodal-content');
  var note = modal.querySelector('[data-viewer-note]');

  var items = [];
  var index = 0;

  function ytEmbed(id) {
    return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) +
      '?autoplay=1&rel=0&modestbranding=1&playsinline=1';
  }

  /*
   * A turntable: an ordered image sequence (or a single video) the visitor
   * scrubs rather than plays. Dragging on the picture itself works as well as
   * the slider — that's how you expect to turn an object — and the whole width
   * of the picture maps to the whole sequence, so one swipe covers the lot.
   *
   * Frames are drawn to a canvas from <img> elements that are kept alive and
   * decoded up front, which is the difference between scrubbing and slideshow:
   * measured on a 36-frame sequence, assigning a new src costs ~22ms a frame
   * (median; 45ms at worst) because the browser re-decodes each time, so at
   * 60fps every single step misses its frame and a fast drag falls behind.
   * Blitting an already-decoded image is ~0.5ms at worst. ImageBitmaps were
   * measured too — slower to draw AND ~200MB of extra memory, so plain <img>
   * wins on both counts.
   *
   * Nothing can be scrubbed until every frame has decoded: landing on one that
   * hasn't shows a blank, which reads as broken.
   */
  function buildTurntable(it) {
    var wrap = document.createElement('div');
    wrap.className = 'viewer-turntable viewer-media';

    // Decoded pixels are what this costs, so a small screen takes the small set
    // rather than holding four times what it can actually show.
    var wide = it.frames || [];
    var narrow = it.framesSmall || wide;
    var want = Math.max(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1);
    var frames = want <= 1100 ? narrow : wide;

    var isVideo = !frames.length && it.src;
    var last = -1;
    var media;
    var ctx = null;
    var sheets = []; // the decoded frames, held so they can't be collected

    if (isVideo) {
      media = document.createElement('video');
      media.src = it.src;
      media.preload = 'auto';
      media.muted = true;
      media.playsInline = true;
      if (it.poster) media.poster = it.poster;
    } else {
      media = document.createElement('canvas');
      media.setAttribute('role', 'img');
      if (it.alt) media.setAttribute('aria-label', it.alt);
      ctx = media.getContext('2d');
    }
    media.className = 'tt-media';
    media.draggable = false;
    wrap.appendChild(media);

    var bar = document.createElement('div');
    bar.className = 'tt-bar';
    var slider = document.createElement('input');
    slider.type = 'range';
    slider.min = 0;
    slider.step = isVideo ? 0.001 : 1;
    slider.max = isVideo ? 1 : Math.max(0, frames.length - 1);
    slider.value = 0;
    slider.className = 'tt-slider';
    slider.setAttribute('aria-label', 'Scrub through this sequence');
    var readout = document.createElement('span');
    readout.className = 'tt-readout';
    bar.appendChild(slider);
    bar.appendChild(readout);
    wrap.appendChild(bar);

    var loading = document.createElement('div');
    loading.className = 'tt-loading';
    wrap.appendChild(loading);

    function show(v) {
      if (isVideo) {
        if (media.readyState >= 1 && isFinite(media.duration)) {
          media.currentTime = Math.max(0, Math.min(media.duration - 0.001, v * media.duration));
        }
        readout.textContent = Math.round(v * 100) + '%';
        return;
      }
      var i = Math.max(0, Math.min(frames.length - 1, Math.round(v)));
      if (i !== last && sheets[i] && sheets[i].naturalWidth) {
        ctx.drawImage(sheets[i], 0, 0, media.width, media.height);
        last = i;
      }
      readout.textContent = i + 1 + ' / ' + frames.length;
    }

    slider.addEventListener('input', function () {
      show(parseFloat(slider.value));
    });

    // Drag anywhere on the picture. Pointer events cover mouse, touch and pen,
    // and capture keeps the drag alive if the pointer leaves the frame.
    var dragging = false;
    media.addEventListener('pointerdown', function (ev) {
      dragging = true;
      if (media.setPointerCapture) {
        try { media.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      }
      ev.preventDefault();
    });
    media.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      var r = media.getBoundingClientRect();
      if (!r.width) return;
      var frac = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      slider.value = isVideo ? frac : Math.round(frac * (frames.length - 1));
      show(parseFloat(slider.value));
      ev.preventDefault();
    });
    ['pointerup', 'pointercancel'].forEach(function (e) {
      media.addEventListener(e, function () { dragging = false; });
    });

    if (isVideo) {
      // Seeking only works once enough is buffered to seek into.
      media.addEventListener('loadeddata', function () {
        wrap.classList.add('is-ready');
        show(0);
      });
      media.addEventListener('error', function () {
        loading.textContent = 'This sequence could not be loaded.';
      });
    } else if (frames.length) {
      var done = 0;
      loading.textContent = 'Loading 0 / ' + frames.length;
      frames.forEach(function (src, i) {
        var pre = new Image();
        sheets[i] = pre; // kept in the array: an unreferenced Image is collectable,
        // and once it's collected the next draw pays the full decode again.
        var tick = function () {
          done++;
          loading.textContent = 'Loading ' + done + ' / ' + frames.length;
          if (done !== frames.length) return;
          // Size the canvas to the frames themselves; CSS scales it to fit.
          var first = sheets.filter(function (s) { return s && s.naturalWidth; })[0];
          if (first) {
            media.width = first.naturalWidth;
            media.height = first.naturalHeight;
          }
          wrap.classList.add('is-ready');
          show(0);
        };
        // decode() resolves once the pixels are ready, not merely downloaded —
        // waiting for that is what makes the first scrub as quick as the rest.
        pre.onload = function () {
          if (pre.decode) pre.decode().then(tick, tick);
          else tick();
        };
        pre.onerror = tick; // a missing frame shouldn't hold the whole sequence
        pre.src = src;
      });
    }

    return wrap;
  }

  function render() {
    stage.innerHTML = '';
    var it = items[index];
    if (!it) return;
    var el = null;

    if (it.type === 'turntable') {
      stage.appendChild(buildTurntable(it));
      if (note) note.hidden = true;
      var multiT = items.length > 1;
      btnPrev.style.display = multiT ? '' : 'none';
      btnNext.style.display = multiT ? '' : 'none';
      return;
    }

    if (it.type === 'image') {
      el = document.createElement('img');
      el.src = it.src;
      el.alt = it.alt || '';
    } else if (it.type === 'video') {
      el = document.createElement('video');
      el.src = it.src;
      el.controls = true;
      el.autoplay = true;
      el.playsInline = true;
      if (it.poster) el.poster = it.poster;
    } else if (it.type === 'embed') {
      el = document.createElement('iframe');
      el.src = ytEmbed(it.embedId);
      el.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
      el.setAttribute('allowfullscreen', '');
    }

    if (el) {
      el.className = 'viewer-media';
      stage.appendChild(el);
    }

    // Colour-accuracy note: shown for video and YouTube embeds, whose inline
    // colours some browsers (Chromium on Windows) render wrong until fullscreen.
    // Not for stills. (CSS hides it again while fullscreen.)
    if (note) note.hidden = it.type !== 'embed' && it.type !== 'video';

    var multi = items.length > 1;
    btnPrev.style.display = multi ? '' : 'none';
    btnNext.style.display = multi ? '' : 'none';
  }

  function open(mediaArray, start) {
    items = Array.isArray(mediaArray) ? mediaArray : [];
    if (!items.length) return;
    index = Math.min(Math.max(start || 0, 0), items.length - 1);
    render();
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function close() {
    if (document.fullscreenElement) {
      try { document.exitFullscreen(); } catch (e) { /* ignore */ }
    }
    modal.style.display = 'none';
    document.body.style.overflow = '';
    stage.innerHTML = ''; // stops any playing video and blanks the iframe (kills audio)
  }

  function go(delta) {
    if (items.length < 2) return;
    index = (index + delta + items.length) % items.length;
    render();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      return;
    }
    var target = content;
    if (target.requestFullscreen) target.requestFullscreen();
    else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
  }

  // Wire each project's thumbnail to open its media set.
  document.querySelectorAll('.project').forEach(function (project) {
    var opener = project.querySelector('[data-project-open]');
    var dataEl = project.querySelector('.project-media-data');
    if (!opener || !dataEl) return;

    var media = [];
    try { media = JSON.parse(dataEl.textContent); } catch (e) { media = []; }
    if (!media.length) return;

    opener.style.cursor = 'pointer';
    opener.addEventListener('click', function () { open(media, 0); });
  });

  btnPrev.addEventListener('click', function () { go(-1); });
  btnNext.addEventListener('click', function () { go(1); });
  btnClose.addEventListener('click', close);
  btnFull.addEventListener('click', toggleFullscreen);
  modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

  document.addEventListener('keydown', function (e) {
    if (modal.style.display !== 'flex') return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  });
})();
