// NE admin: list, edit, add and delete catalogue products.
// Talks to /api/admin/* (worker/index.js), which commits to GitHub.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var products = [];
  var editing = null;      // product being edited, or null when adding
  var newImage = null;     // { base64, type } chosen in the form

  function api(path, body) {
    var init = { credentials: 'same-origin', headers: { 'x-ne-admin': '1' } };
    if (body) {
      init.method = 'POST';
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || 'Request failed');
        return data;
      });
    });
  }

  function notice(text, isError) {
    var el = $('notice');
    el.textContent = text;
    el.className = 'notice' + (isError ? ' error' : '');
    el.hidden = !text;
    if (text) window.scrollTo(0, 0);
  }

  function money(n) { return 'KES ' + Number(n).toLocaleString('en-KE'); }

  function img(src) { return src ? '/' + src.replace(/^\//, '') : '/assets/nashnaal-favicon.png'; }

  // ---- list ----------------------------------------------------------------
  function renderList() {
    var q = $('search').value.trim().toLowerCase();
    var cat = $('filter-cat').value;
    var shown = products.filter(function (p) {
      if (cat && p.category !== cat) return false;
      return !q || (p.model + ' ' + p.name).toLowerCase().indexOf(q) !== -1;
    });
    $('count').textContent = shown.length + ' of ' + products.length + ' products';
    var list = $('list');
    list.textContent = '';
    shown.slice(0, 200).forEach(function (p) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'row';
      row.innerHTML = '<img alt="" loading="lazy"><div><div class="name"></div><div class="meta"></div></div><div class="price"></div>';
      row.querySelector('img').src = img(p.image);
      row.querySelector('.name').textContent = p.name;
      row.querySelector('.meta').textContent = p.model.trim() + ' · ' + p.category;
      row.querySelector('.price').textContent = money(p.price);
      row.addEventListener('click', function () { openEditor(p); });
      list.appendChild(row);
    });
  }

  function load() {
    return api('/api/admin/products').then(function (data) {
      products = data.products;
      $('who').textContent = data.user.email;
      var cats = Array.from(new Set(products.map(function (p) { return p.category; }))).sort();
      [$('filter-cat'), $('f-category')].forEach(function (sel, i) {
        var keep = sel.value;
        sel.length = i === 0 ? 1 : 0;
        cats.forEach(function (c) { sel.add(new Option(c, c)); });
        sel.value = keep;
      });
      renderList();
    });
  }

  function loadLog() {
    api('/api/admin/log').then(function (data) {
      var ol = $('log');
      ol.textContent = '';
      data.log.forEach(function (entry) {
        var li = document.createElement('li');
        li.textContent = entry.created_at + ' UTC — ' + entry.detail;
        ol.appendChild(li);
      });
      if (!data.log.length) ol.innerHTML = '<li>No changes yet.</li>';
    }).catch(function () {});
  }

  // ---- editor --------------------------------------------------------------
  function show(view) {
    $('list-view').hidden = view !== 'list';
    $('edit-view').hidden = view !== 'edit';
    window.scrollTo(0, 0);
  }

  function openEditor(p) {
    editing = p;
    newImage = null;
    $('photo').value = '';
    $('edit-title').textContent = p ? 'Edit product' : 'Add a product';
    $('f-model').value = p ? p.model.trim() : '';
    $('f-model').readOnly = Boolean(p);
    $('f-name').value = p ? p.name : '';
    $('f-category').value = p ? p.category : '';
    $('f-price').value = p ? p.price : '';
    $('f-features').value = p ? p.features : '';
    $('f-pcs').value = p ? p.pcsCtn : '';
    $('photo-preview').src = img(p && p.image);
    $('delete-btn').hidden = !p;
    $('view-link').hidden = !p;
    if (p) $('view-link').href = p.url;
    notice('');
    show('edit');
  }

  // Resize to at most 1000px and convert to WebP in the browser.
  function readPhoto(file) {
    return createImageBitmap(file).then(function (bitmap) {
      var scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      var type = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0 ? 'image/webp' : 'image/jpeg';
      var dataUrl = canvas.toDataURL(type, 0.82);
      return { dataUrl: dataUrl, image: { type: type, base64: dataUrl.split(',')[1] } };
    });
  }

  $('photo').addEventListener('change', function () {
    var file = this.files[0];
    if (!file) return;
    readPhoto(file).then(function (out) {
      newImage = out.image;
      $('photo-preview').src = out.dataUrl;
    }).catch(function () { notice('Could not read that photo. Try a JPEG or PNG.', true); });
  });

  function busy(on) {
    $('save-btn').disabled = on;
    $('save-btn').textContent = on ? 'Saving…' : 'Save';
  }

  $('edit-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var fields = {
      name: $('f-name').value, category: $('f-category').value, price: $('f-price').value,
      features: $('f-features').value, pcsCtn: $('f-pcs').value,
    };
    var body = editing
      ? { action: 'update', slug: editing.slug, product: fields }
      : { action: 'add', product: Object.assign({ model: $('f-model').value }, fields) };
    if (newImage) body.image = newImage;
    busy(true);
    api('/api/admin/products', body).then(function (res) {
      busy(false);
      return load().then(function () {
        loadLog();
        show('list');
        notice(res.unchanged ? 'Nothing changed.' : 'Saved: ' + res.message + '. It will be live on the website in about 2–3 minutes.');
      });
    }).catch(function (err) { busy(false); notice(err.message, true); });
  });

  $('delete-btn').addEventListener('click', function () {
    if (!editing) return;
    if (!window.confirm('Delete ' + editing.model.trim() + ' from the website? Its page will stop working.')) return;
    api('/api/admin/products', { action: 'delete', slug: editing.slug }).then(function (res) {
      return load().then(function () { loadLog(); show('list'); notice('Deleted: ' + res.message + '.'); });
    }).catch(function (err) { notice(err.message, true); });
  });

  $('add-btn').addEventListener('click', function () { openEditor(null); });
  $('back-btn').addEventListener('click', function () { notice(''); show('list'); });
  $('search').addEventListener('input', renderList);
  $('filter-cat').addEventListener('change', renderList);

  load().then(loadLog).catch(function (err) { notice(err.message, true); $('count').textContent = ''; });
})();
