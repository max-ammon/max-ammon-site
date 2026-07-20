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

  function render() {
    stage.innerHTML = '';
    var it = items[index];
    if (!it) return;
    var el = null;

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
