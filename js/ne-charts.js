// Small bar charts and stat tiles for the signed-in pages (/team, /partner, /account).
// No library: plain DOM, so it works under the site's script policy.
//
//   NECharts.tiles(el, [{ label, value, sub, color }])
//   NECharts.columns(el, { labels: [...], series: [{ name, color, values: [...] }], money: true })
//   NECharts.hbars(el, { rows: [{ label, value }], money: true })
//
// Colours (validated for colour-blind separation): blue, orange, aqua, yellow.
// Every value is also in the hover/tap tooltip and the "Show as table" view.
(function () {
  'use strict';
  var COLORS = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100' };

  var css = '' +
    '.nc{position:relative;font-size:12.5px;color:#4A5B68}' +
    '.nc-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px}' +
    '.nc-tile{background:#fff;border:1px solid #E7ECF1;border-radius:14px;padding:12px 14px;border-top:4px solid var(--c)}' +
    '.nc-tile small{display:block;font-size:12.5px;color:#4A5B68;font-weight:600}' +
    '.nc-tile b{display:block;font-size:22px;color:#10202E;margin:4px 0 2px;font-weight:800}' +
    '.nc-tile span{font-size:12px;color:#4A5B68}' +
    '.nc-plot{position:relative;height:170px;margin:8px 0 0 40px;border-bottom:1px solid #D5DEE5}' +
    '.nc-grid{position:absolute;left:0;right:0;border-top:1px solid #EEF2F5}' +
    '.nc-grid i{position:absolute;right:100%;margin-right:6px;transform:translateY(-50%);font-style:normal;white-space:nowrap;font-size:11.5px}' +
    '.nc-groups{position:absolute;inset:0;display:flex}' +
    '.nc-group{flex:1;display:flex;align-items:flex-end;justify-content:center;gap:2px;position:relative;cursor:pointer;outline:none}' +
    '.nc-group:hover,.nc-group:focus,.nc-group.on{background:rgba(42,120,214,.06)}' +
    '.nc-bar{width:min(24px,40%);border-radius:4px 4px 0 0;min-height:0;transition:filter .1s}' +
    '.nc-group:hover .nc-bar,.nc-group.on .nc-bar{filter:brightness(1.08)}' +
    '.nc-val{position:absolute;left:50%;transform:translate(-50%,-100%);margin-top:-3px;font-weight:700;color:#10202E;font-size:11.5px;white-space:nowrap}' +
    '.nc-x{display:flex;margin-left:40px}.nc-x span{flex:1;text-align:center;padding-top:6px;font-size:11.5px;white-space:nowrap;overflow:hidden}' +
    '.nc-legend{display:flex;gap:14px;flex-wrap:wrap;margin:2px 0 4px;font-size:12.5px;color:#10202E}' +
    '.nc-legend span{display:inline-flex;align-items:center;gap:6px}.nc-legend i{width:12px;height:12px;border-radius:3px;display:inline-block}' +
    '.nc-tip{position:absolute;z-index:3;pointer-events:none;background:#10202E;color:#fff;border-radius:8px;padding:7px 10px;font-size:12.5px;line-height:1.45;white-space:nowrap;transform:translate(-50%,-100%)}' +
    '.nc-tip b{font-size:14px}.nc-tip em{display:inline-block;width:10px;height:2px;margin-right:6px;vertical-align:middle;font-style:normal}' +
    '.nc-h{display:grid;grid-template-columns:max-content 1fr max-content;gap:9px 10px;align-items:center;font-size:13px;color:#10202E}.nc-hrow{display:contents}' +
    '.nc-htrack{height:14px;background:#EEF2F5;border-radius:4px;overflow:hidden}.nc-hfill{height:100%;border-radius:0 4px 4px 0}' +
    '.nc details{margin-top:8px}.nc summary{cursor:pointer;font-size:12.5px;color:#086E9E}' +
    '.nc table{width:100%;border-collapse:collapse;margin-top:6px;font-size:12.5px}.nc td,.nc th{padding:4px 6px;border-bottom:1px solid #EEF2F5;text-align:right}' +
    '.nc td:first-child,.nc th:first-child{text-align:left}' +
    '.nc table{display:table;border:0;background:none}.nc tr{display:table-row}.nc td,.nc th{display:table-cell;width:auto;background:none}' +
    '.nc-empty{padding:18px 0;text-align:center;color:#8193A0}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function compact(n) {
    var a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(Math.round(n * 10) / 10);
  }
  function full(n, money) { return (money ? 'KES ' : '') + Math.round(n).toLocaleString('en-KE'); }
  // A clean top for the axis: 1, 2, 2.5 or 5 × 10^k.
  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
    return 10 * p;
  }
  function color(c) { return COLORS[c] || c || COLORS.blue; }

  function table(labels, series, money) {
    var d = el('details');
    d.appendChild(el('summary', null, 'Show as table'));
    var t = el('table');
    var head = el('tr');
    head.appendChild(el('th', null, ''));
    series.forEach(function (s) { head.appendChild(el('th', null, s.name)); });
    t.appendChild(head);
    labels.forEach(function (l, i) {
      var tr = el('tr');
      tr.appendChild(el('td', null, l));
      series.forEach(function (s) { tr.appendChild(el('td', null, full(s.values[i] || 0, money))); });
      t.appendChild(tr);
    });
    d.appendChild(t);
    return d;
  }

  function tiles(container, list) {
    container.textContent = '';
    var wrap = el('div', 'nc-tiles');
    list.forEach(function (t) {
      var tile = el('div', 'nc-tile');
      tile.style.setProperty('--c', color(t.color));
      tile.appendChild(el('small', null, t.label));
      tile.appendChild(el('b', null, t.value));
      if (t.sub) tile.appendChild(el('span', null, t.sub));
      wrap.appendChild(tile);
    });
    container.appendChild(wrap);
  }

  function columns(container, opt) {
    container.textContent = '';
    var root = el('div', 'nc');
    var series = opt.series.map(function (s) { return { name: s.name, color: color(s.color), values: s.values }; });
    var max = 0;
    series.forEach(function (s) { s.values.forEach(function (v) { if (v > max) max = v; }); });
    if (!max) {
      root.appendChild(el('div', 'nc-empty', opt.empty || 'Nothing yet. Your numbers will show here.'));
      container.appendChild(root);
      return;
    }
    if (series.length > 1) {
      var legend = el('div', 'nc-legend');
      series.forEach(function (s) {
        var item = el('span');
        var key = el('i'); key.style.background = s.color;
        item.appendChild(key); item.appendChild(document.createTextNode(s.name));
        legend.appendChild(item);
      });
      root.appendChild(legend);
    }
    var top = niceMax(max);
    var plot = el('div', 'nc-plot');
    [0, 0.5, 1].forEach(function (f) {
      var g = el('div', 'nc-grid');
      g.style.bottom = (f * 100) + '%';
      g.appendChild(el('i', null, compact(top * f)));
      plot.appendChild(g);
    });
    var groups = el('div', 'nc-groups');
    var tip = el('div', 'nc-tip'); tip.hidden = true;
    // Label only the biggest value (single series): the axis, tooltip and table carry the rest.
    var peak = series.length === 1 ? series[0].values.indexOf(max) : -1;
    opt.labels.forEach(function (label, i) {
      var g = el('div', 'nc-group');
      g.tabIndex = 0;
      g.setAttribute('role', 'img');
      g.setAttribute('aria-label', label + ': ' + series.map(function (s) { return s.name + ' ' + full(s.values[i] || 0, opt.money); }).join(', '));
      series.forEach(function (s) {
        var b = el('div', 'nc-bar');
        b.style.background = s.color;
        b.style.height = ((s.values[i] || 0) / top * 100) + '%';
        g.appendChild(b);
      });
      if (i === peak) {
        var v = el('div', 'nc-val', compact(max));
        v.style.bottom = (max / top * 100) + '%';
        g.appendChild(v);
      }
      function show() {
        Array.prototype.forEach.call(groups.children, function (x) { x.classList.toggle('on', x === g); });
        tip.textContent = '';
        tip.appendChild(el('div', null, label));
        series.forEach(function (s) {
          var row = el('div');
          var key = el('em'); key.style.background = s.color;
          row.appendChild(key);
          row.appendChild(el('b', null, full(s.values[i] || 0, opt.money)));
          if (series.length > 1) row.appendChild(document.createTextNode(' ' + s.name));
          tip.appendChild(row);
        });
        tip.hidden = false;
        var gx = g.offsetLeft + g.offsetWidth / 2 + 40;
        var high = Math.max.apply(null, series.map(function (s) { return s.values[i] || 0; }));
        tip.style.left = Math.min(Math.max(gx, 60), root.offsetWidth - 60) + 'px';
        tip.style.top = (plot.offsetTop + plot.offsetHeight * (1 - high / top) - 8) + 'px';
      }
      function hide() { tip.hidden = true; g.classList.remove('on'); }
      g.addEventListener('pointerenter', show);
      g.addEventListener('pointerdown', show);
      g.addEventListener('focus', show);
      g.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
      g.addEventListener('blur', hide);
      groups.appendChild(g);
    });
    plot.appendChild(groups);
    root.appendChild(plot);
    var x = el('div', 'nc-x');
    // Many bars on a phone: label every other one (all are in the tooltip and table).
    var skip = opt.labels.length > 6 && container.offsetWidth < 560;
    opt.labels.forEach(function (l, i) { x.appendChild(el('span', null, skip && i % 2 ? '' : l)); });
    root.appendChild(x);
    root.appendChild(tip);
    root.appendChild(table(opt.labels, series, opt.money));
    container.appendChild(root);
  }

  // One series, one bar per category, largest first. Values sit beside each bar.
  function hbars(container, opt) {
    container.textContent = '';
    var root = el('div', 'nc');
    var rows = opt.rows.filter(function (r) { return r.value > 0; });
    if (!rows.length) { root.appendChild(el('div', 'nc-empty', opt.empty || 'Nothing yet.')); container.appendChild(root); return; }
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }));
    var list = el('div', 'nc-h');
    rows.forEach(function (r) {
      var row = el('div', 'nc-hrow');
      row.appendChild(el('span', null, r.label));
      var track = el('div', 'nc-htrack');
      var fill = el('div', 'nc-hfill');
      fill.style.width = Math.max(2, r.value / max * 100) + '%';
      fill.style.background = color(r.color || opt.color);
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('b', null, full(r.value, opt.money)));
      list.appendChild(row);
    });
    root.appendChild(list);
    container.appendChild(root);
  }

  window.NECharts = { tiles: tiles, columns: columns, hbars: hbars, money: full, compact: compact };
})();
