// My account: shows the technician application status and the apply form.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  var STATUS_TEXT = {
    pending: ['Application received', 'Thanks! We check every application, usually with a quick WhatsApp call. Once approved, your technician prices appear on every product.'],
    approved: ['Approved technician', 'Your technician price (%PCT%% off) now shows on every product and bundle. When you order on WhatsApp from the website, your message says you have a technician account.'],
    rejected: ['Application not approved', 'We could not approve this application. Call or WhatsApp us on 0737 454 891 if you think this is a mistake, or update your details and apply again.'],
    removed: ['Technician prices turned off', 'Your technician prices have been turned off. Call or WhatsApp us on 0737 454 891 for details.'],
  };

  function render(data) {
    var app = data.application;
    var pct = data.discount;
    $('hello').textContent = 'Hello, ' + ((data.user.name || '').split(' ')[0] || 'there');
    $('email').textContent = 'Signed in as ' + data.user.email;
    if (document.cookie.indexOf('ne_welcome=1') !== -1) {
      document.cookie = 'ne_welcome=; Path=/; Max-Age=0; Secure; SameSite=Lax';
      $('welcome-card').hidden = false;
    }
    Array.prototype.forEach.call(document.querySelectorAll('.pct'), function (el) { el.textContent = pct; });

    var card = $('status-card');
    if (app) {
      var text = STATUS_TEXT[app.status] || STATUS_TEXT.pending;
      card.innerHTML = '<span class="status"></span><h2></h2><p></p>';
      card.querySelector('.status').className = 'status ' + app.status;
      card.querySelector('.status').textContent = app.status === 'approved' ? '✓ Approved' : app.status.charAt(0).toUpperCase() + app.status.slice(1);
      card.querySelector('h2').textContent = text[0];
      card.querySelector('p').textContent = text[1].replace('%PCT%', pct);
      if (app.status === 'approved') {
        var shop = document.createElement('a');
        shop.className = 'btn primary';
        shop.href = '/products';
        shop.textContent = 'See your prices';
        card.appendChild(shop);
      }
      card.hidden = false;
    }
    // Show the form for new applicants and for anyone not approved who wants to (re)apply.
    var canApply = !app || app.status === 'rejected';
    $('apply-card').hidden = !canApply;
    if (app && canApply) {
      ['full_name', 'phone', 'business', 'town', 'years', 'cert_number', 'work_link'].forEach(function (key) {
        var input = $('apply-form').elements[key];
        if (input && app[key]) input.value = app[key];
      });
    } else if (!app) {
      $('apply-form').elements.full_name.value = data.user.name || '';
    }
  }

  function load() {
    return fetch('/api/account/application', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 401) { window.location.href = '/auth/google/login?next=/account'; throw new Error('signed out'); }
        return r.json();
      })
      .then(render);
  }

  $('show-form').addEventListener('click', function () {
    $('apply-form').hidden = false;
    this.hidden = true;
    $('apply-form').elements.full_name.focus();
  });

  $('apply-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var form = this;
    var body = {};
    Array.prototype.forEach.call(form.elements, function (el) { if (el.name) body[el.name] = el.value; });
    $('submit-btn').disabled = true;
    $('form-error').hidden = true;
    fetch('/api/account/application', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (data) { if (!r.ok) throw new Error(data.error || 'Could not send.'); return data; });
    }).then(function () {
      return load();
    }).then(function () {
      window.scrollTo(0, 0);
    }).catch(function (err) {
      $('form-error').textContent = err.message;
      $('form-error').hidden = false;
    }).then(function () { $('submit-btn').disabled = false; });
  });

  // Reward credit and order history.
  var ORDER_STATUS = { new: 'Received', confirmed: 'Confirmed', paid: 'Paid', delivered: 'Delivered', cancelled: 'Cancelled' };
  function money(n) { return 'KES ' + Math.round(n).toLocaleString('en-KE'); }
  function day(sql) { return new Date(sql.replace(' ', 'T') + 'Z').toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }); }

  function loadSummary() {
    return fetch('/api/account/summary', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (s) {
      if (!s.signedIn) return;
      $('reward-balance').textContent = money(s.balance);
      var note = s.balance > 0 && s.next
        ? money(s.next.amount) + ' of this expires on ' + day(s.next.expires) + '. Use it at checkout on your next order.'
        : 'Earn ' + s.rewardPercent + '% of every paid order as credit for your next order. Credit lasts 6 months.';
      $('reward-note').textContent = note;
      $('reward-card').hidden = false;
      if (s.orders.length) {
        var list = $('orders-list');
        list.textContent = '';
        s.orders.forEach(function (o) {
          var a = document.createElement('a');
          a.className = 'order';
          a.href = '/order/?n=' + encodeURIComponent(o.number) + '&k=' + encodeURIComponent(o.token);
          a.innerHTML = '<span><strong></strong><small></small></span><span style="text-align:right"><strong></strong><span class="st"></span></span>';
          a.querySelector('strong').textContent = o.number;
          a.querySelector('small').textContent = day(o.created_at) + (o.reward_earned ? ' · earned ' + money(o.reward_earned) : '');
          a.querySelectorAll('strong')[1].textContent = money(o.total);
          a.querySelector('.st').textContent = ORDER_STATUS[o.status] || o.status;
          a.querySelector('.st').style.display = 'block';
          list.appendChild(a);
        });
        $('orders-card').hidden = false;
      }
    }).catch(function () {});
  }

  load().catch(function () {});
  loadSummary();
})();
