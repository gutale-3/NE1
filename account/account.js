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

  load().catch(function () {});
})();
