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
        if (techTag) lines.push(techTag);
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
      var price = card.querySelector('.pick-foot span');
      price.textContent = 'KES ' + p.p;
      price.setAttribute('data-kes', p.k);
    });
  }

  // ---- Accounts: header link, technician prices ----------------------------
  // Only people who have signed in carry the ne_signed_in cookie, so everyone
  // else never calls the API.
  var techTag = '';

  function money(n) { return 'KES ' + Math.round(n).toLocaleString('en-KE'); }

  function showTechPrices(pct) {
    var rate = (100 - pct) / 100;
    Array.prototype.forEach.call(document.querySelectorAll('[data-kes]'), function (el) {
      // Inside a price row (homepage picks) the badge goes under the whole row.
      var anchor = el.closest('.pick-foot') || el;
      var next = anchor.nextElementSibling;
      if (next && next.classList.contains('tech-price')) next.remove();
      var tag = document.createElement('div');
      tag.className = 'tech-price';
      tag.textContent = 'Technician price: ' + money(Number(el.getAttribute('data-kes')) * rate);
      anchor.insertAdjacentElement('afterend', tag);
    });
  }

  function tagWhatsAppLinks() {
    Array.prototype.forEach.call(document.querySelectorAll('a[href*="wa.me/"]'), function (a) {
      // Rebuilt by hand: URLSearchParams would turn spaces into '+', which WhatsApp shows literally.
      var match = a.href.match(/^([^?]*\?(?:[^#]*&)?text=)([^&#]*)(.*)$/);
      if (!match) return;
      var text;
      try { text = decodeURIComponent(match[2].replace(/\+/g, ' ')); } catch (e) { return; }
      if (text.indexOf(techTag) !== -1) return;
      a.href = match[1] + encodeURIComponent(text + '\n' + techTag) + match[3];
    });
  }

  function initAccount() {
    if (document.cookie.indexOf('ne_signed_in=1') === -1) return;
    fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (me) {
      if (!me.signedIn) return;
      Array.prototype.forEach.call(document.querySelectorAll('[data-acct]'), function (link) {
        link.href = me.admin ? '/admin' : '/account';
        link.querySelector('span').textContent = me.admin ? 'Admin' : 'My account';
      });
      if (me.techDiscount > 0) {
        techTag = '(Technician account: ' + (me.name || me.email) + ', approved)';
        var style = document.createElement('style');
        style.textContent = '.tech-price{display:block;width:max-content;max-width:100%;margin-top:6px;padding:3px 9px;border-radius:999px;background:#E8F8EE;color:#14532D;font-size:12.5px;font-weight:800;line-height:1.4}';
        document.head.appendChild(style);
        showTechPrices(me.techDiscount);
        tagWhatsAppLinks();
      }
      if (document.cookie.indexOf('ne_welcome=1') !== -1 && !me.admin) showWelcome(me);
    }).catch(function () {});
  }

  // One-time welcome after someone's first sign-in: what the account gives them.
  function showWelcome(me) {
    document.cookie = 'ne_welcome=; Path=/; Max-Age=0; Secure; SameSite=Lax';
    var first = String(me.name || '').split(' ')[0];
    var style = document.createElement('style');
    style.textContent = '.ne-welcome{position:fixed;left:16px;right:16px;bottom:16px;z-index:200;max-width:420px;margin-left:auto;background:#fff;border:1px solid #E7ECF1;border-radius:18px;box-shadow:0 18px 50px rgba(15,42,61,.25);padding:20px 20px 18px;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;color:#10202E}' +
      '.ne-welcome h2{font-size:19px;margin:0 0 4px}.ne-welcome p{margin:0 0 10px;color:#4A5B68;font-size:14px;line-height:1.5}' +
      '.ne-welcome ul{margin:0 0 14px;padding:0;list-style:none;display:grid;gap:7px;font-size:14px}.ne-welcome li{padding-left:24px;position:relative;line-height:1.4}' +
      '.ne-welcome li:before{content:"";position:absolute;left:2px;top:3px;width:13px;height:13px;border-radius:50%;background:#22C35E;box-shadow:inset 0 0 0 3px #E8F8EE}' +
      '.ne-welcome .acts{display:flex;gap:8px;flex-wrap:wrap}.ne-welcome .acts a,.ne-welcome .acts button{border:0;border-radius:10px;padding:10px 14px;font:inherit;font-size:14px;font-weight:700;cursor:pointer;text-decoration:none}' +
      '.ne-welcome .go{background:#086E9E;color:#fff}.ne-welcome .alt{background:#EAF6FC;color:#086E9E}.ne-welcome .x{position:absolute;top:10px;right:12px;background:none;border:0;font-size:22px;line-height:1;color:#8A99A6;cursor:pointer}';
    document.head.appendChild(style);
    var box = document.createElement('div');
    box.className = 'ne-welcome';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Welcome to NE');
    box.innerHTML = '<button class="x" type="button" aria-label="Close">&times;</button><h2></h2><p>Your NE account is ready. Here is what you get:</p><ul>' +
      '<li><b class="pct"></b> back as reward credit on every paid order, valid 6 months</li>' +
      '<li>Your orders and order PDFs in one place</li><li>Faster checkout: we fill in your details</li></ul>' +
      '<div class="acts"><a class="go" href="/products">Start shopping</a><a class="alt" href="/account#apply-card">Installer? Get 5% off</a></div>';
    box.querySelector('h2').textContent = 'Welcome to NE' + (first ? ', ' + first : '') + '!';
    box.querySelector('.pct').textContent = (me.rewardPercent || 2) + '%';
    if (location.pathname.indexOf('/cart') === 0) {
      var go = box.querySelector('.go');
      go.textContent = 'Back to my cart';
      go.href = '#';
      go.addEventListener('click', function (e) { e.preventDefault(); box.remove(); });
    }
    box.querySelector('.x').addEventListener('click', function () { box.remove(); });
    document.body.appendChild(box);
  }

  // ---- Cart: kept on this device (localStorage); checkout is on /cart ------
  var CART_KEY = 'ne_cart';

  function readCart() {
    try {
      var data = JSON.parse(window.localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(data) ? data.filter(function (i) { return i && typeof i.slug === 'string' && i.qty > 0; }) : [];
    } catch (e) { return []; }
  }

  function writeCart(items) {
    try { window.localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (e) { /* private mode: cart lasts this page only */ }
    updateCartCount(items);
    try { window.dispatchEvent(new CustomEvent('ne:cart', { detail: items })); } catch (e) { /* old browsers */ }
  }

  function addToCart(pairs) {
    var items = readCart();
    pairs.forEach(function (pair) {
      var existing = items.filter(function (i) { return i.slug === pair[0]; })[0];
      if (existing) existing.qty = Math.min(999, existing.qty + pair[1]);
      else items.push({ slug: pair[0], qty: pair[1] });
    });
    writeCart(items);
  }

  function updateCartCount(items) {
    var count = (items || readCart()).reduce(function (n, i) { return n + i.qty; }, 0);
    Array.prototype.forEach.call(document.querySelectorAll('[data-cart-count]'), function (el) {
      el.textContent = count > 99 ? '99+' : count;
      el.hidden = !count;
    });
  }

  function toast(text) {
    var el = document.getElementById('ne-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ne-toast';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100;background:#10202E;color:#fff;padding:12px 16px;border-radius:12px;font:600 14px Inter,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;gap:14px;align-items:center;max-width:92vw';
      document.body.appendChild(el);
    }
    el.innerHTML = '<span></span><a href="/cart" style="color:#7FD4FF;font-weight:800;white-space:nowrap">View cart &rarr;</a>';
    el.firstChild.textContent = text;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.hidden = true; }, 3500);
  }

  function initCart() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-add-cart], [data-add-kit]'), function (button) {
      button.hidden = false;
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var kit = button.getAttribute('data-add-kit');
        var pairs = kit ? JSON.parse(kit) : [[button.getAttribute('data-add-cart'), 1]];
        addToCart(pairs);
        var label = button.textContent;
        button.classList.add('added');
        button.textContent = 'Added ✓';
        setTimeout(function () { button.classList.remove('added'); button.textContent = label; }, 1500);
        toast(kit ? 'Bundle added to your cart' : 'Added to your cart');
      });
    });
    updateCartCount();
    // Keep the count in step when another tab changes the cart.
    window.addEventListener('storage', function (e) { if (e.key === CART_KEY) updateCartCount(); });
  }

  window.NECart = { read: readCart, write: writeCart };

  function init() {
    initCart();
    initPicks();
    initAccount();
    initCatalog();
    initWhatsAppForms();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
