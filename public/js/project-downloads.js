(function () {
  'use strict';

  /*
   * The download pill in the bottom-right of a gallery card opens a small menu
   * of that project's files. Only one is open at a time; a click anywhere else,
   * or Escape, closes it.
   */
  var toggles = document.querySelectorAll('.project-dl-toggle');
  if (!toggles.length) return;

  function closeAll(except) {
    Array.prototype.forEach.call(document.querySelectorAll('.project-dl'), function (dl) {
      if (dl === except) return;
      var menu = dl.querySelector('.project-dl-menu');
      var btn = dl.querySelector('.project-dl-toggle');
      if (menu) menu.hidden = true;
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  Array.prototype.forEach.call(toggles, function (btn) {
    btn.addEventListener('click', function (ev) {
      // Don't let the click reach the card (or the document closer below).
      ev.preventDefault();
      ev.stopPropagation();
      var dl = btn.parentNode;
      var menu = dl.querySelector('.project-dl-menu');
      if (!menu) return;
      var opening = menu.hidden;
      closeAll(dl);
      menu.hidden = !opening;
      btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
    });
  });

  // Clicking a file should download it and close the menu, not bubble out to
  // the card underneath.
  Array.prototype.forEach.call(document.querySelectorAll('.project-dl-menu'), function (menu) {
    menu.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (ev.target.closest && ev.target.closest('a')) closeAll(null);
    });
  });

  document.addEventListener('click', function () {
    closeAll(null);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeAll(null);
  });
})();
