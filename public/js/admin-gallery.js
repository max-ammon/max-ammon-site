(function () {
  'use strict';
  var sel = document.getElementById('mediaType');
  if (!sel) return;
  function update() {
    var v = sel.value;
    document.querySelectorAll('[data-when]').forEach(function (el) {
      var when = el.getAttribute('data-when').split(',');
      el.style.display = when.indexOf(v) >= 0 ? '' : 'none';
    });
  }
  sel.addEventListener('change', update);
  update();

  /* Thumbnails are scaled to a uniform height, with each item's width derived
     from its aspect ratio. Images get measured server-side by sharp, but there's
     no video probe on the server — so read the dimensions here, straight from
     the file the owner picked, and send them along with the upload. */
  var fileInput = document.querySelector('input[type="file"][name="file"]');
  var wField = document.getElementById('mediaW');
  var hField = document.getElementById('mediaH');
  if (!fileInput || !wField || !hField) return;

  fileInput.addEventListener('change', function () {
    wField.value = '';
    hField.value = '';
    var file = fileInput.files && fileInput.files[0];
    if (!file || file.type.indexOf('video/') !== 0) return; // images are measured server-side

    var url = URL.createObjectURL(file);
    var probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = function () {
      if (probe.videoWidth && probe.videoHeight) {
        wField.value = probe.videoWidth;
        hField.value = probe.videoHeight;
      }
      URL.revokeObjectURL(url);
    };
    probe.onerror = function () { URL.revokeObjectURL(url); };
    probe.src = url;
  });
})();
