(function () {
  'use strict';

  var preview = document.getElementById('preview');
  var hexInputs = Array.prototype.slice.call(document.querySelectorAll('.hex'));
  var HEX6 = /^#[0-9a-fA-F]{6}$/;
  var HEXOK = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

  function applyOne(token, value) {
    try {
      var doc = preview && preview.contentDocument;
      if (doc && HEXOK.test(value)) doc.documentElement.style.setProperty('--' + token, value);
    } catch (e) {
      /* cross-origin can't happen here (same origin); ignore */
    }
  }

  // Re-apply all current (possibly unsaved) values — used after the iframe loads.
  function applyAll() {
    hexInputs.forEach(function (hex) {
      applyOne(hex.dataset.token, hex.value.trim());
    });
  }

  hexInputs.forEach(function (hex) {
    var token = hex.dataset.token;
    var swatch = document.querySelector('.swatch[data-token="' + token + '"]');

    hex.addEventListener('input', function () {
      var v = hex.value.trim();
      applyOne(token, v);
      if (swatch && HEX6.test(v)) swatch.value = v;
    });

    if (swatch) {
      swatch.addEventListener('input', function () {
        hex.value = swatch.value;
        applyOne(token, swatch.value);
      });
    }
  });

  // Keep unsaved edits visible when the preview reloads / switches pages.
  if (preview) preview.addEventListener('load', applyAll);

  // Preview page tabs.
  document.querySelectorAll('.preview-tabs button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.preview-tabs button').forEach(function (b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      preview.src = btn.dataset.src;
    });
  });
})();
