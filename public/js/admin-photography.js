(function () {
  'use strict';

  /*
   * Selecting several photos to move together. The tickboxes live inside the
   * cards but belong to the toolbar's form (via their form attribute), because
   * each card already contains forms of its own and forms cannot nest.
   *
   * Everything here is presentation: the toolbar is hidden until the script
   * runs, so without JavaScript the page keeps exactly the single-photo arrows
   * it had rather than showing a control that would not behave.
   */
  var form = document.getElementById('photoBulk');
  if (!form) return;
  var boxes = Array.prototype.slice.call(document.querySelectorAll('.ph-pick input[type="checkbox"]'));
  if (!boxes.length) return;

  var count = document.getElementById('phCount');
  var needSel = Array.prototype.slice.call(form.querySelectorAll('[data-needs-selection]'));
  var lastTouched = -1;

  function picked() {
    return boxes.filter(function (b) {
      return b.checked;
    });
  }

  function sync() {
    var n = picked().length;
    if (count) count.textContent = n ? n + ' selected' : 'Nothing selected';
    needSel.forEach(function (el) {
      el.disabled = !n;
    });
    boxes.forEach(function (b) {
      var card = b.closest('.ph-card');
      if (card) card.classList.toggle('is-picked', b.checked);
    });
  }

  boxes.forEach(function (b, i) {
    b.addEventListener('click', function (ev) {
      // Shift-click fills in everything between the two, the way file managers
      // do — picking a run of twenty photos one at a time is the thing this
      // feature exists to avoid.
      if (ev.shiftKey && lastTouched >= 0 && lastTouched !== i) {
        var from = Math.min(lastTouched, i);
        var to = Math.max(lastTouched, i);
        for (var k = from; k <= to; k++) boxes[k].checked = b.checked;
      }
      lastTouched = i;
      sync();
    });
  });

  var all = document.getElementById('phAll');
  if (all) {
    all.addEventListener('click', function () {
      boxes.forEach(function (b) {
        b.checked = true;
      });
      sync();
    });
  }
  var none = document.getElementById('phNone');
  if (none) {
    none.addEventListener('click', function () {
      boxes.forEach(function (b) {
        b.checked = false;
      });
      lastTouched = -1;
      sync();
    });
  }

  form.hidden = false;
  sync(); // a selection carried back from the last move arrives already ticked
})();
