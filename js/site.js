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
      // Category headings only make sense in the full, unsearched list.
      var showHeadings = state.cat === 'All' && !state.q.trim();
      Array.prototype.forEach.call(grid.querySelectorAll('.pgroup'), function (heading) {
        var group = heading.getAttribute('data-group');
        heading.hidden = !showHeadings || !cards.some(function (card) {
          return !card.hidden && card.getAttribute('data-cat') === group;
        });
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
    // On phones the tabs scroll sideways; bring the selected one into view.
    var current = document.querySelector('.ptab.on');
    if (current && current.parentNode.scrollWidth > current.parentNode.clientWidth) {
      current.parentNode.scrollLeft = current.offsetLeft - current.parentNode.offsetLeft - 24;
    }
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

  // ---- Homepage "Recommended for you": a fresh draw on every visit -------
  // Slots: Turbo HD camera, IP camera, any camera, access control/intercom.
  function initPicks() {
    var data = document.getElementById('picks-data');
    var cards = document.querySelectorAll('.pick[data-slot]');
    if (!data || cards.length !== 4) return;
    var pools;
    try { pools = JSON.parse(data.textContent); } catch (e) { return; }
    var slots = [pools[0], pools[1], pools[0].concat(pools[1]), pools[2]];
    var used = {};
    Array.prototype.forEach.call(cards, function (card, i) {
      // Skip models and photos already shown so the four cards look different.
      var options = slots[i].filter(function (p) { return !used[p.m] && !used[p.i]; });
      if (!options.length) return;
      var p = options[Math.floor(Math.random() * options.length)];
      used[p.m] = used[p.i] = true;
      card.href = p.u;
      var img = card.querySelector('img');
      img.src = p.i;
      img.alt = p.n;
      card.querySelector('.pick-cat').textContent = p.c;
      card.querySelector('.pick-name').textContent = p.n;
      card.querySelector('.pick-foot span').textContent = 'KES ' + p.p;
    });
  }

  function init() {
    initPicks();
    initCatalog();
    initWhatsAppForms();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
