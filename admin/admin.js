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
    $('tech-view').hidden = view !== 'tech';
    $('orders-view').hidden = view !== 'orders';
    $('customers-view').hidden = view !== 'customers';
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.classList.toggle('on', tab.getAttribute('data-tab') === (view === 'edit' ? 'list' : view));
    });
    window.scrollTo(0, 0);
  }

  // ---- technicians ---------------------------------------------------------
  var LABELS = [['phone', 'Phone'], ['business', 'Business'], ['town', 'Town'], ['years', 'Years'],
    ['cert_number', 'Certificate'], ['work_link', 'Work'], ['email', 'Google'], ['created_at', 'Applied']];

  function loadTechs() {
    return api('/api/admin/technicians').then(function (data) {
      var pending = data.technicians.filter(function (t) { return t.status === 'pending'; }).length;
      $('tech-badge').textContent = pending;
      $('tech-badge').hidden = !pending;
      $('tech-count').textContent = data.technicians.length
        ? pending + ' waiting · ' + data.technicians.length + ' total · approved technicians get ' + data.discount + '% off'
        : 'No applications yet. Technicians apply from the "Sign in" link on the website.';
      var list = $('tech-list');
      list.textContent = '';
      data.technicians.forEach(function (t) { list.appendChild(techCard(t)); });
    });
  }

  function techCard(t) {
    var el = document.createElement('article');
    el.className = 'tech ' + t.status;
    el.innerHTML = '<div class="st"></div><h3></h3><dl></dl><div class="row-actions"></div>';
    el.querySelector('.st').className = 'st ' + t.status;
    el.querySelector('.st').textContent = t.status;
    el.querySelector('h3').textContent = t.full_name;
    var dl = el.querySelector('dl');
    LABELS.forEach(function (pair) {
      if (!t[pair[0]]) return;
      var dt = document.createElement('dt'); dt.textContent = pair[1];
      var dd = document.createElement('dd');
      if (pair[0] === 'work_link' && /^https?:\/\//.test(t.work_link)) {
        var a = document.createElement('a'); a.href = t.work_link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = t.work_link;
        dd.appendChild(a);
      } else {
        dd.textContent = pair[0] === 'created_at' ? t[pair[0]] + ' UTC' : t[pair[0]];
      }
      dl.appendChild(dt); dl.appendChild(dd);
    });
    var actions = el.querySelector('.row-actions');
    var digits = String(t.phone).replace(/[^0-9]/g, '').replace(/^0/, '254');
    var wa = document.createElement('a');
    wa.className = 'wa'; wa.target = '_blank'; wa.rel = 'noopener';
    wa.href = 'https://wa.me/' + digits + '?text=' + encodeURIComponent('Hi ' + t.full_name.split(' ')[0] + ', this is NE (Nashnaal Electronics) about your technician account application.');
    wa.textContent = 'WhatsApp';
    actions.appendChild(wa);
    function button(label, cls, decision, confirmText) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = cls; b.textContent = label;
      b.addEventListener('click', function () {
        if (confirmText && !window.confirm(confirmText)) return;
        b.disabled = true;
        api('/api/admin/technicians', { user_id: t.user_id, decision: decision }).then(function () {
          notice(t.full_name + ': ' + (decision === 'approve' ? 'approved. They now see technician prices.' : decision === 'reject' ? 'not approved.' : 'technician prices turned off.'));
          loadTechs(); loadLog();
        }).catch(function (err) { b.disabled = false; notice(err.message, true); });
      });
      actions.appendChild(b);
    }
    if (t.status !== 'approved') button('Approve', 'ok', 'approve');
    if (t.status === 'pending') button('Reject', 'danger', 'reject', 'Reject ' + t.full_name + '?');
    if (t.status === 'approved') button('Remove technician prices', 'danger', 'remove', 'Turn off technician prices for ' + t.full_name + '?');
    return el;
  }

  // ---- orders --------------------------------------------------------------
  var orderFilter = '';
  var ORDER_NEXT = {
    new: [['confirmed', 'Confirm', 'primary'], ['paid', 'Mark paid', 'ok'], ['cancelled', 'Cancel', 'danger']],
    confirmed: [['paid', 'Mark paid', 'ok'], ['cancelled', 'Cancel', 'danger']],
    paid: [['delivered', 'Mark delivered', 'ok']],
    delivered: [],
    cancelled: [],
  };

  function loadOrders() {
    return api('/api/admin/orders' + (orderFilter ? '?status=' + orderFilter : '')).then(function (data) {
      var waiting = data.counts.new || 0;
      $('orders-badge').textContent = waiting;
      $('orders-badge').hidden = !waiting;
      var total = Object.keys(data.counts).reduce(function (n, k) { return n + data.counts[k]; }, 0);
      $('orders-count').textContent = total ? data.orders.length + ' shown · ' + waiting + ' new · ' + total + ' total' : 'No orders yet. They appear here when customers check out from the cart.';
      var list = $('orders-list');
      list.textContent = '';
      data.orders.forEach(function (o) { list.appendChild(orderCard(o)); });
    });
  }

  function orderCard(o) {
    var el = document.createElement('article');
    el.className = 'tech ord ' + o.status;
    el.innerHTML = '<div class="head"><div><div class="st"></div><h3></h3></div><div class="tot"></div></div><dl></dl><ul></ul><div class="row-actions"></div>';
    el.querySelector('.st').className = 'st ' + o.status;
    el.querySelector('.st').textContent = o.status + ' · ' + (o.channel === 'whatsapp' ? 'sent via WhatsApp' : 'sent on website');
    el.querySelector('h3').textContent = o.number + ' — ' + o.name;
    el.querySelector('.tot').textContent = money(o.total);
    var delivery = o.delivery === 'outside' ? 'Outside Nairobi: ' + o.town + ' (' + o.transport + ', customer pays)' : o.deliveryLabel;
    var facts = [['Phone', o.phone], ['Email', o.email], ['Delivery', delivery], ['Account', o.account_email ? o.account_email + ' (earns ' + o.earn_rate + '%)' : 'Guest – no rewards'],
      ['Discounts', [o.tech_discount ? 'technician −' + money(o.tech_discount) : '', o.reward_used ? 'reward −' + money(o.reward_used) : ''].filter(Boolean).join(', ')],
      ['Reward earned', o.reward_earned ? money(o.reward_earned) : ''], ['Notes', o.notes], ['Placed', o.created_at + ' UTC']];
    var dl = el.querySelector('dl');
    facts.forEach(function (f) {
      if (!f[1]) return;
      var dt = document.createElement('dt'); dt.textContent = f[0];
      var dd = document.createElement('dd'); dd.textContent = f[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
    var ul = el.querySelector('ul');
    o.items.forEach(function (i) {
      var li = document.createElement('li');
      li.textContent = i.qty + ' × ' + i.name + ' (' + i.model + ') — ' + money(i.qty * i.price);
      ul.appendChild(li);
    });
    var actions = el.querySelector('.row-actions');
    var digits = String(o.phone).replace(/[^0-9]/g, '').replace(/^0/, '254');
    var wa = document.createElement('a');
    wa.className = 'wa'; wa.target = '_blank'; wa.rel = 'noopener';
    wa.href = 'https://wa.me/' + digits + '?text=' + encodeURIComponent('Hi ' + o.name.split(' ')[0] + ', this is NE (Nashnaal Electronics) about your order ' + o.number + ' (' + money(o.total) + ').');
    wa.textContent = 'WhatsApp';
    actions.appendChild(wa);
    var view = document.createElement('a');
    view.className = 'chip'; view.target = '_blank'; view.rel = 'noopener';
    view.href = '/order/?n=' + encodeURIComponent(o.number) + '&k=' + encodeURIComponent(o.token);
    view.textContent = 'Open / PDF';
    actions.appendChild(view);
    (ORDER_NEXT[o.status] || []).forEach(function (step) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = step[2]; b.textContent = step[1];
      b.addEventListener('click', function () {
        if (step[0] === 'cancelled' && !window.confirm('Cancel order ' + o.number + '? Any reward credit used on it goes back to the customer.')) return;
        b.disabled = true;
        api('/api/admin/orders', { id: o.id, status: step[0] }).then(function (res) {
          notice(res.message);
          loadOrders(); loadLog();
        }).catch(function (err) { b.disabled = false; notice(err.message, true); });
      });
      actions.appendChild(b);
    });
    return el;
  }

  Array.prototype.forEach.call(document.querySelectorAll('#order-filter .chip'), function (chip) {
    chip.addEventListener('click', function () {
      orderFilter = chip.getAttribute('data-status');
      Array.prototype.forEach.call(document.querySelectorAll('#order-filter .chip'), function (c) { c.classList.toggle('on', c === chip); });
      loadOrders().catch(function (err) { notice(err.message, true); });
    });
  });

  // ---- customers ------------------------------------------------------------
  var customers = [];

  function day(sql) { return sql ? new Date(sql.replace(' ', 'T') + 'Z').toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }

  function rangeQuery() {
    var q = [];
    if ($('cust-from').value) q.push('from=' + $('cust-from').value);
    if ($('cust-to').value) q.push('to=' + $('cust-to').value);
    return q.join('&');
  }

  function loadCustomers() {
    var q = rangeQuery();
    $('pdf-sales').href = '/admin/report/?type=sales' + (q ? '&' + q : '');
    return api('/api/admin/customers' + (q ? '?' + q : '')).then(function (data) {
      customers = data.customers;
      var t = data.totals;
      var label = data.from || data.to ? 'Bought ' + (data.from ? 'from ' + day(data.from + ' 00:00:00') : '') + (data.to ? ' to ' + day(data.to + ' 00:00:00') : '') : 'Bought (paid orders)';
      $('cust-tiles').innerHTML = '';
      [[money(t.credit), 'Rebate we owe (2% / 1%) · ' + t.with_credit + ' people', 'owe'], [money(t.bought), label, ''],
       [money(t.pending), 'Waiting for payment', ''], [String(t.customers), 'Customers', '']].forEach(function (x) {
        var d = document.createElement('div');
        d.className = 'tile ' + x[2];
        d.innerHTML = '<b></b><span></span>';
        d.querySelector('b').textContent = x[0];
        d.querySelector('span').textContent = x[1];
        $('cust-tiles').appendChild(d);
      });
      renderCustomers();
    });
  }

  function renderCustomers() {
    var q = $('cust-search').value.trim().toLowerCase();
    var f = $('cust-filter').value;
    var shown = customers.filter(function (c) {
      if (f === 'credit' && !(c.credit > 0)) return false;
      if (f && f !== 'credit' && c.type !== f) return false;
      return !q || (c.name + ' ' + c.phone + ' ' + c.email).toLowerCase().indexOf(q) !== -1;
    });
    $('cust-count').textContent = shown.length + ' of ' + customers.length + ' customers · sorted by most bought';
    var list = $('cust-list');
    list.textContent = '';
    shown.forEach(function (c) { list.appendChild(customerCard(c)); });
    if (!customers.length) $('cust-count').textContent = 'No customers yet. People appear here when they sign in or place an order.';
  }

  function customerCard(c) {
    var el = document.createElement('article');
    el.className = 'tech cust';
    el.innerHTML = '<h3></h3><div class="meta"></div><div class="nums"></div><div class="meta extra"></div><div class="row-actions"></div>';
    var h3 = el.querySelector('h3');
    h3.textContent = c.name;
    var tag = document.createElement('span');
    tag.className = 'tag ' + c.type;
    tag.textContent = c.type;
    h3.appendChild(tag);
    el.querySelector('.meta').textContent = [c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details yet';
    var nums = el.querySelector('.nums');
    [[money(c.bought), 'Bought (' + c.paid_orders + ' paid)', ''], [money(c.pending), 'Not paid yet', ''],
     [c.type === 'guest' ? '—' : money(c.credit), 'Rebate owed', c.credit > 0 ? 'owe' : '']].forEach(function (n) {
      var d = document.createElement('div');
      d.className = n[2];
      d.innerHTML = '<b></b><span></span>';
      d.querySelector('b').textContent = n[0];
      d.querySelector('span').textContent = n[1];
      nums.appendChild(d);
    });
    var extra = [];
    if (c.credit_next) extra.push(money(c.credit_next.amount) + ' expires ' + day(c.credit_next.expires));
    if (c.credit_expired) extra.push(money(c.credit_expired) + ' rebate expired unused');
    extra.push(c.orders + ' order' + (c.orders === 1 ? '' : 's') + ' · last ' + day(c.last_order));
    el.querySelector('.extra').textContent = extra.join(' · ');
    var actions = el.querySelector('.row-actions');
    if (c.phone) {
      var digits = String(c.phone).replace(/[^0-9]/g, '').replace(/^0/, '254');
      var msg = 'Hi ' + c.name.split(' ')[0] + ', this is NE (Nashnaal Electronics).' + (c.credit > 0 ? ' You have ' + money(c.credit) + ' rebate (your NE reward) to use on your next order at nashnaal.com.' : '');
      var wa = document.createElement('a');
      wa.className = 'wa'; wa.target = '_blank'; wa.rel = 'noopener';
      wa.href = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(msg);
      wa.textContent = 'WhatsApp';
      actions.appendChild(wa);
    }
    var pdf = document.createElement('a');
    pdf.className = 'chip'; pdf.target = '_blank'; pdf.rel = 'noopener';
    pdf.href = '/admin/report/?type=statement&' + (c.user_id ? 'user=' + c.user_id : 'phone=' + encodeURIComponent(c.phone));
    pdf.textContent = 'Statement PDF';
    actions.appendChild(pdf);
    return el;
  }

  $('cust-search').addEventListener('input', renderCustomers);
  $('cust-filter').addEventListener('change', renderCustomers);
  ['cust-from', 'cust-to'].forEach(function (id) {
    $(id).addEventListener('change', function () { loadCustomers().catch(function (err) { notice(err.message, true); }); });
  });
  $('cust-range-clear').addEventListener('click', function () {
    $('cust-from').value = ''; $('cust-to').value = '';
    loadCustomers().catch(function (err) { notice(err.message, true); });
  });

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    tab.addEventListener('click', function () {
      notice('');
      var view = tab.getAttribute('data-tab');
      show(view);
      if (view === 'tech') loadTechs().catch(function (err) { notice(err.message, true); });
      if (view === 'orders') loadOrders().catch(function (err) { notice(err.message, true); });
      if (view === 'customers') loadCustomers().catch(function (err) { notice(err.message, true); });
    });
  });

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
  loadTechs().catch(function () {});  // fills the badge
  loadOrders().catch(function () {});
})();
