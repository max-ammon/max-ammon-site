(function () {
  'use strict';
  var box = document.querySelector('.demo-embed');
  if (!box) return;
  var id = box.getAttribute('data-youtube');
  if (!id) return;

  box.addEventListener('click', function () {
    if (box.classList.contains('playing')) return;
    var iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) +
      '?autoplay=1&rel=0&modestbranding=1&playsinline=1';
    iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('title', 'Demo video');
    box.appendChild(iframe);
    box.classList.add('playing');
  });
})();
