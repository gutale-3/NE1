// Small progressive enhancements. Every page works without this file:
// the catalog shows all products, tabs are links to category pages, and the
// quote forms fall back to plain WhatsApp links.
(function () {
  'use strict';
  var WHATSAPP = '254737454891';
  var PAGE_SIZE = 24;

  // ---- Catalog: category tabs, search and "show more" -------------------
  function initCatalog() {
    var grid = document.getElementById('catalog-grid');
    if (!grid) return;
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.pc'));
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.ptab'));
    var search = document.getElementById('catalog-search');
    var more = document.getElementById('catalog-more');
    var empty = document.getElementById('catalog-empty');
    var scope = grid.getAttribute('data-scope');           // set on category pages
    var params = new URLSearchParams(window.location.search);
    var state = { cat: scope || params.get('cat') || 'All', q: params.get('q') || '', shown: PAGE_SIZE };
    var onProductsPage = !scope;

    if (search && state.q) search.value = state.q;

    function matches(card) {
      if (state.cat !== 'All' && card.getAttribute('data-cat') !== state.cat) return false;
      var q = state.q.trim().toLowerCase();
      if (!q) return true;
      var text = card.getAttribute('data-q');
      return q.split(/\s+/).every(function (word) { return text.indexOf(word) !== -1; });
    }

    function render() {
      var visible = 0;
      cards.forEach(function (card) {
        var ok = matches(card);
        if (ok) visible++;
        card.hidden = !ok || visible > state.shown;
      });
      if (more) more.hidden = visible <= state.shown;
      if (empty) empty.hidden = visible !== 0;
      if (onProductsPage) {
        tabs.forEach(function (tab) {
          tab.classList.toggle('on', tab.getAttribute('data-cat') === state.cat);
        });
        var url = new URL(window.location.href);
        if (state.cat === 'All') url.searchParams.delete('cat'); else url.searchParams.set('cat', state.cat);
        if (state.q) url.searchParams.set('q', state.q); else url.searchParams.delete('q');
        history.replaceState(null, '', url.pathname + url.search);
      }
    }

    if (onProductsPage) {
      tabs.forEach(function (tab) {
        tab.addEventListener('click', function (event) {
          event.preventDefault();
          state.cat = tab.getAttribute('data-cat');
          state.shown = PAGE_SIZE;
          render();
        });
      });
    }
    if (search) {
      search.addEventListener('input', function () {
        state.q = search.value;
        state.shown = PAGE_SIZE;
        render();
      });
    }
    if (more) {
      more.addEventListener('click', function () {
        state.shown += PAGE_SIZE;
        render();
      });
    }
    render();
  }

  // ---- WhatsApp forms: contact form and quote builder --------------------
  // A form with data-whatsapp collects its labelled fields into one message.
  function initWhatsAppForms() {
    var forms = document.querySelectorAll('form[data-whatsapp]');
    Array.prototype.forEach.call(forms, function (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!form.reportValidity()) return;
        var lines = [form.getAttribute('data-whatsapp')];
        var fields = form.querySelectorAll('[data-label]');
        Array.prototype.forEach.call(fields, function (field) {
          var value;
          if (field.type === 'radio' || field.type === 'checkbox') {
            if (!field.checked) return;
            value = field.value;
          } else {
            value = (field.value || '').trim();
          }
          if (!value) return;
          lines.push('• ' + field.getAttribute('data-label') + ': ' + value);
        });
        var url = 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(lines.join('\n'));
        window.open(url, '_blank', 'noopener');
      });
    });
  }

  function init() {
    initCatalog();
    initWhatsAppForms();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
