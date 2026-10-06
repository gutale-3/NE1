// NE printable catalogue: today's date on the cover and footers, phone
// scaling, and "Download PDF" (the browser's print → Save as PDF).
(function () {
  'use strict';
  var today = new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' });
  Array.prototype.forEach.call(document.querySelectorAll('[data-today]'), function (el) { el.textContent = today; });

  function fit() {
    var sheet = document.querySelector('.sheet');
    if (!sheet) return;
    var width = sheet.offsetWidth || 794;
    document.documentElement.style.setProperty('--fit', Math.min(1, (window.innerWidth - 16) / width).toFixed(3));
  }
  fit();
  window.addEventListener('resize', fit);

  // Every photo must be loaded before printing, or the PDF has gaps.
  function ready() {
    return Promise.all(Array.prototype.map.call(document.images, function (img) {
      return img.complete ? null : new Promise(function (done) { img.onload = img.onerror = done; });
    }));
  }
  var btn = document.getElementById('pdf-btn');
  btn.addEventListener('click', function () {
    btn.disabled = true;
    btn.textContent = 'Preparing…';
    ready().then(function () {
      btn.disabled = false;
      btn.textContent = 'Download PDF';
      window.print();
    });
  });
})();
