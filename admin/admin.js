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
    $('wa-view').hidden = view !== 'wa';
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

  // ---- funnel: accounts -> orders -> paid -> revenue -----------------------
  var funnelData = null, funnelPeriod = '30';
  function pct(a, b) { return b ? Math.round(a * 100 / b) + '%' : '—'; }
  function renderFunnel() {
    if (!funnelData) return;
    var f = funnelData.periods[funnelPeriod];
    var steps = [
      [String(f.accounts), 'New accounts', ''],
      [String(f.orders), 'Orders sent', f.member_orders + ' from signed-in customers (' + pct(f.member_orders, f.orders) + ')'],
      [String(f.paid), 'Paid orders', pct(f.paid, f.orders) + ' of orders paid' + (f.cancelled ? ' · ' + f.cancelled + ' cancelled' : '')],
      [money(f.revenue), 'Paid sales', f.paid ? 'Average ' + money(Math.round(f.revenue / f.paid)) : ''],
    ];
    var box = $('funnel');
    box.textContent = '';
    steps.forEach(function (st) {
      var d = document.createElement('div');
      d.className = 'fstep';
      d.innerHTML = '<b></b><span></span><em></em>';
      d.querySelector('b').textContent = st[0];
      d.querySelector('span').textContent = st[1];
      d.querySelector('em').textContent = st[2];
      box.appendChild(d);
    });
    var idle = funnelData.idle;
    $('idle-box').hidden = !idle.length;
    $('idle-title').textContent = idle.length + (idle.length === 20 ? '+' : '') + ' signed up but never ordered (most recent first)';
    $('idle-list').textContent = '';
    idle.forEach(function (u) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = 'mailto:' + u.email;
      a.textContent = u.email;
      li.appendChild(document.createTextNode((u.name || 'No name') + ' · '));
      li.appendChild(a);
      li.appendChild(document.createTextNode(' · joined ' + day(u.created_at)));
      $('idle-list').appendChild(li);
    });
  }
  function loadFunnel() {
    return api('/api/admin/funnel').then(function (data) { funnelData = data; renderFunnel(); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('#funnel-period .chip'), function (chip) {
    chip.addEventListener('click', function () {
      funnelPeriod = chip.getAttribute('data-p');
      Array.prototype.forEach.call(document.querySelectorAll('#funnel-period .chip'), function (c) { c.classList.toggle('on', c === chip); });
      renderFunnel();
    });
  });

  // ---- WhatsApp updates number -------------------------------------------
  function dl(box, pairs) {
    box.textContent = '';
    pairs.forEach(function (p) {
      var dt = document.createElement('dt'); dt.textContent = p[0];
      var dd = document.createElement('dd');
      if (p[2]) { var c = document.createElement('span'); c.className = 'copy'; c.textContent = p[1]; dd.appendChild(c); } else dd.textContent = p[1];
      box.appendChild(dt); box.appendChild(dd);
    });
  }
  function loadWhatsApp() {
    return api('/api/admin/whatsapp').then(function (d) {
      var n = d.number || {};
      dl($('wa-status'), [
        ['Number', n.display_phone_number || '+254 141 444 982'],
        ['Display name', (n.verified_name || 'Nashnaal Electronics') + (n.name_status ? ' (' + n.name_status.toLowerCase().replace(/_/g, ' ') + ')' : '')],
        ['Quality', n.quality_rating || '—'],
        ['Access key', d.hasToken ? 'Saved in Cloudflare' : 'Missing: add WHATSAPP_TOKEN secret'],
        ['App secret', d.hasAppSecret ? 'Saved in Cloudflare' : 'Missing: add META_APP_SECRET secret'],
        ['Owner alerts to', d.owner ? '+' + d.owner : '—'],
      ].concat(d.numberError ? [['Error', d.numberError]] : []));
      dl($('wa-hook'), [['Callback URL', d.webhookUrl, true], ['Verify token', d.verifyToken || 'Add META_APP_SECRET first', Boolean(d.verifyToken)]]);
      var tl = $('wa-templates'); tl.textContent = '';
      if (d.templatesError) tl.textContent = d.templatesError;
      (d.templates || []).forEach(function (t) {
        var el = document.createElement('div'); el.className = 'tpl';
        el.innerHTML = '<div><b></b><p></p></div><span class="s"></span>';
        el.querySelector('b').textContent = t.name;
        el.querySelector('p').textContent = t.body + (t.reason && t.reason !== 'NONE' ? ' — Rejected: ' + t.reason : '');
        el.querySelector('.s').className = 's ' + t.status; el.querySelector('.s').textContent = t.status;
        tl.appendChild(el);
      });
      if (!d.configured) tl.textContent = 'Templates appear here once the access key is saved in Cloudflare.';
      var log = $('wa-log'); log.textContent = '';
      var inbound = 0;
      d.messages.forEach(function (m) {
        if (m.direction === 'in' && m.created_at > (localStorage.getItem('ne_wa_seen') || '')) inbound++;
        var el = document.createElement('div'); el.className = 'wa-msg ' + m.direction;
        el.innerHTML = '<span class="dir"></span><div><div class="txt"></div><small></small></div><span class="st"></span>';
        el.querySelector('.dir').textContent = m.direction === 'in' ? 'From' : 'To';
        el.querySelector('.txt').textContent = m.body || '';
        var who = '+' + m.phone + ' · ' + (m.direction === 'in' ? m.kind : m.kind.replace(/^ne_/, '').replace(/_/g, ' ')) + ' · ' + day(m.created_at);
        el.querySelector('small').textContent = who + (m.error ? ' · ' + m.error : '');
        if (m.direction === 'in') {
          var a = document.createElement('a'); a.href = 'https://wa.me/' + m.phone; a.target = '_blank'; a.rel = 'noopener'; a.textContent = ' Reply from my WhatsApp';
          el.querySelector('small').appendChild(a);
        }
        el.querySelector('.st').className = 'st ' + m.status; el.querySelector('.st').textContent = m.status;
        log.appendChild(el);
      });
      if (!d.messages.length) log.textContent = 'No messages yet.';
      try { if (d.messages[0]) localStorage.setItem('ne_wa_seen', d.messages[0].created_at); } catch (e) { /* ignore */ }
    });
  }
  // ---- WhatsApp conversations ------------------------------------------
  var openPhone = null, chatTimer = null;
  function when(sql) {
    var d = new Date(String(sql).replace(' ', 'T') + 'Z');
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
  }
  function loadChats() {
    return api('/api/admin/whatsapp/chats').then(function (d) {
      $('wa-badge').textContent = d.waiting;
      $('wa-badge').hidden = !d.waiting;
      var list = $('chat-list'); list.textContent = '';
      if (!d.chats.length) list.innerHTML = '<p class="hint" style="padding:14px">No conversations yet.</p>';
      d.chats.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chat-item' + (c.waiting ? ' waiting' : '') + (c.phone === openPhone ? ' on' : '');
        b.innerHTML = '<div class="ci-top"><b></b><time></time></div><p></p>';
        b.querySelector('b').textContent = c.name && c.name !== 'message' ? c.name : '+' + c.phone;
        b.querySelector('time').textContent = when(c.last_at);
        b.querySelector('p').textContent = (c.last_dir === 'out' ? 'You: ' : '') + (c.last_body || '');
        b.addEventListener('click', function () { openChat(c.phone); });
        list.appendChild(b);
      });
    });
  }
  function openChat(phone) {
    openPhone = phone;
    $('chat-app').classList.add('open');
    return api('/api/admin/whatsapp/chat?phone=' + phone).then(function (d) {
      if (openPhone !== phone) return;
      $('chat-empty').hidden = true;
      $('chat-head').hidden = false; $('chat-msgs').hidden = false;
      $('chat-name').textContent = d.name && d.name !== 'message' ? d.name : '+' + phone;
      $('chat-phone').textContent = ' +' + phone;
      $('chat-wa').href = 'https://wa.me/' + phone;
      $('chat-form').hidden = !d.open; $('chat-closed').hidden = d.open;
      var box = $('chat-msgs');
      var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
      box.textContent = '';
      d.messages.forEach(function (m) {
        var el = document.createElement('div');
        var auto = m.direction === 'out' && m.kind !== 'reply';
        el.className = 'bubble ' + m.direction + (auto ? ' auto' : '');
        el.textContent = m.body || '';
        var meta = document.createElement('small');
        var label = auto ? (m.kind === 'auto_reply' ? 'Auto-reply' : 'Update: ' + m.kind.replace(/^ne_/, '').replace(/_/g, ' ')) + ' · ' : '';
        var tick = m.direction === 'out' ? (m.status === 'read' ? ' ✓✓ read' : m.status === 'delivered' ? ' ✓✓' : m.status === 'failed' ? ' failed' : ' ✓') : '';
        meta.textContent = label + when(m.created_at) + tick;
        if (m.status === 'failed') { meta.className = 'failed'; meta.title = m.error || ''; }
        el.appendChild(meta);
        box.appendChild(el);
      });
      if (atBottom || !box.dataset.phone || box.dataset.phone !== phone) box.scrollTop = box.scrollHeight;
      box.dataset.phone = phone;
      loadChats();
    });
  }
  $('chat-back').addEventListener('click', function () { openPhone = null; $('chat-app').classList.remove('open'); loadChats(); });
  $('chat-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = $('chat-text').value.trim();
    if (!text || !openPhone) return;
    $('chat-send').disabled = true;
    api('/api/admin/whatsapp', { action: 'reply', phone: openPhone, text: text }).then(function () {
      $('chat-text').value = '';
      return openChat(openPhone);
    }).catch(function (err) { notice(err.message, true); }).then(function () { $('chat-send').disabled = false; });
  });
  $('chat-text').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 761px)').matches) { e.preventDefault(); $('chat-form').requestSubmit(); }
  });
  function startChatPolling() {
    clearInterval(chatTimer);
    chatTimer = setInterval(function () {
      if ($('wa-view').hidden || document.hidden) return;
      (openPhone ? openChat(openPhone) : loadChats()).catch(function () {});
    }, 15000);
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-wa]'), function (b) {
    b.addEventListener('click', function () {
      b.disabled = true;
      api('/api/admin/whatsapp', { action: b.getAttribute('data-wa') }).then(function (r) {
        notice(r.message); return loadWhatsApp();
      }).catch(function (err) { notice(err.message, true); }).then(function () { b.disabled = false; });
    });
  });

  function askReview(phone, name, btn) {
    btn.disabled = true;
    return api('/api/admin/whatsapp', { action: 'review', phone: phone, name: name }).then(function (r) {
      notice(r.message); return true;
    }).catch(function (err) { notice(err.message, true); }).then(function (ok) { btn.disabled = false; return ok; });
  }
  $('review-form').addEventListener('submit', function (e) {
    e.preventDefault();
    askReview($('rv-phone').value, $('rv-name').value, this.querySelector('button')).then(function (ok) {
      if (ok) $('review-form').reset();
    });
  });
  $('rv-mine').addEventListener('click', function () {
    var d = $('rv-phone').value.replace(/\D/g, '');
    if (d.charAt(0) === '0') d = '254' + d.slice(1);
    else if (d.length === 9) d = '254' + d;
    if (!/^254[17]\d{8}$/.test(d)) { notice("Enter the customer's WhatsApp number first.", true); return; }
    var n = $('rv-name').value.trim().split(/\s+/)[0];
    n = n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : 'there';
    var text = 'Hi ' + n + ', thank you for choosing Nashnaal Electronics. If you have a minute, we would really appreciate a short Google review. ' +
      'A line about the product or our service helps other customers find us. Thank you!\n\nhttps://nashnaal.com/review';
    window.open('https://wa.me/' + d + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
  });
  $('chat-review').addEventListener('click', function () {
    var name = $('chat-name').textContent;
    if (openPhone) askReview(openPhone, name.charAt(0) === '+' ? '' : name, this).then(function (ok) { if (ok) openChat(openPhone); });
  });

  $('tpl-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = this.querySelector('button'); btn.disabled = true;
    api('/api/admin/whatsapp', { action: 'create', template: { name: $('tpl-name').value, category: $('tpl-cat').value, body: $('tpl-body').value } }).then(function (r) {
      notice(r.message); $('tpl-form').reset(); return loadWhatsApp();
    }).catch(function (err) { notice(err.message, true); }).then(function () { btn.disabled = false; });
  });

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
      if (view === 'wa') {
        loadChats().catch(function (err) { notice(err.message, true); });
        loadWhatsApp().catch(function (err) { notice(err.message, true); });
        startChatPolling();
      }
      if (view === 'customers') {
        loadCustomers().catch(function (err) { notice(err.message, true); });
        loadFunnel().catch(function (err) { notice(err.message, true); });
      }
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
  loadChats().catch(function () {});  // fills the WhatsApp badge
  // The home-screen app opens straight on the chats (start_url /admin/#wa).
  if (location.hash === '#wa') { var waTab = document.querySelector('[data-tab=wa]'); if (waTab) waTab.click(); }
})();
