/* Public client group: a customer reads and writes messages with only the private link. */
(function () {
  'use strict';
  var url = window.MP_CLIENT.url, lastId = 0, box = document.getElementById('chat-messages'), form = document.getElementById('client-form');
  var nameKey = 'mp-client-name';
  try { form.elements.name.value = localStorage.getItem(nameKey) || ''; } catch (e) { /* storage blocked */ }

  function when(mysql) {
    return String(mysql || '').slice(11, 16).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; });
  }
  function load(scroll) {
    return fetch(url + '?after=' + lastId, { credentials: 'omit' }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.message); return d; }); })
      .then(function (data) {
        document.getElementById('client-title').textContent = data.title;
        document.getElementById('client-sub').textContent = 'گفت‌وگوی ' + data.client + ' با تیم مربع';
        data.messages.forEach(function (m) {
          lastId = Math.max(lastId, m.id);
          var row = document.createElement('div'); row.className = 'bubble-row ' + (m.team ? 'other' : 'me');
          var b = document.createElement('div'); b.className = 'bubble';
          var who = document.createElement('span'); who.className = 'b-author'; who.textContent = m.author + (m.team ? ' (تیم مربع)' : '');
          b.append(who);
          if (m.file && /^audio\//.test(m.file.mime || '')) {
            var au = document.createElement('audio'); au.controls = true; au.preload = 'metadata'; au.src = m.file.url; au.className = 'b-audio'; b.append(au);
          } else if (m.file) {
            var a = document.createElement('a'); a.href = m.file.url; a.target = '_blank'; a.rel = 'noopener';
            if (m.file.image) { var img = document.createElement('img'); img.className = 'b-img'; img.src = m.file.url; img.alt = m.file.name; a.append(img); }
            else { a.className = 'file-chip'; a.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7"/></svg>'; a.append(document.createTextNode(m.file.name)); }
            b.append(a);
          }
          if (m.body) { var p = document.createElement('p'); p.textContent = m.body; b.append(p); }
          var t = document.createElement('span'); t.className = 'b-meta'; t.textContent = when(m.created_at);
          b.append(t); row.append(b); box.append(row);
        });
        if (data.messages.length || scroll) box.scrollTop = box.scrollHeight;
      })
      .catch(function (err) {
        document.getElementById('client-title').textContent = err.message || 'این گروه در دسترس نیست.';
        form.hidden = true;
        clearInterval(timer);
      });
  }
  form.onsubmit = function (e) {
    e.preventDefault();
    var body = form.elements.message.value.trim(), name = form.elements.name.value.trim();
    if (!body) return;
    try { localStorage.setItem(nameKey, name); } catch (err) { /* ignore */ }
    form.elements.message.value = '';
    fetch(url, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: body, name: name }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.message); }); })
      .then(function () { return load(true); })
      .catch(function (err) { form.elements.message.value = body; alert(err.message || 'ارسال پیام انجام نشد.'); });
  };
  var timer = setInterval(function () { if (!document.hidden) load(false); }, 6000);
  load(true);
})();

/* Client portal: progress, designs to review (pins), delivered files, invoices; the chat above is the «گفت‌وگو» tab. */
(function () {
  'use strict';
  var base = window.MP_CLIENT.url, data = null, tab = 'progress';
  var ST = { pending: 'منتظر نظر شما', approved: 'تأیید شد', changes: 'نیاز به تغییر', delivered: 'تحویل شد' };
  var PST = { waiting: 'در انتظار', doing: 'در حال انجام', done: 'تمام‌شده' };
  var IST = { sent: 'منتظر پرداخت', accepted: 'تأیید شد', paid: 'پرداخت شد', cancelled: 'لغو شد' };
  var MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k]; else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.append(c); });
    return n;
  }
  function fa(n) { return String(n).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function money(n) { return fa(Number(n || 0).toLocaleString('en-US')) + ' تومان'; }
  // Gregorian → Jalali (same algorithm as the panel).
  function jal(iso) {
    if (!iso) return '';
    var p = iso.slice(0, 10).split('-').map(Number), gy = p[0], gm = p[1], gd = p[2];
    var g = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], gy2 = gm > 2 ? gy + 1 : gy;
    var days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + g[gm - 1];
    var jy = -1595 + 33 * Math.floor(days / 12053); days %= 12053; jy += 4 * Math.floor(days / 1461); days %= 1461;
    if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
    var jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30), jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
    return fa(jd) + ' ' + MONTHS[jm - 1] + ' ' + fa(jy);
  }
  function name() { var i = document.querySelector('#client-form [name=name]'); return i ? i.value.trim() : ''; }
  function api(path, body) {
    return fetch(base + path, { method: body ? 'POST' : 'GET', credentials: 'omit', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.message || 'خطا'); return d; }); });
  }
  function empty(t) { return h('div', { class: 'card portal-empty', text: t }); }

  function tabs() {
    var nav = document.getElementById('portal-tabs'), list = [['progress', 'پیشرفت'], ['designs', 'طرح‌ها'], ['files', 'فایل‌های تحویلی'], ['invoices', 'فاکتورها'], ['chat', 'گفت‌وگو']];
    var pending = data.designs.filter(function (d) { return d.status === 'pending'; }).length;
    nav.hidden = false; nav.replaceChildren();
    list.forEach(function (t) {
      nav.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(t[0] === tab), onclick: function () { tab = t[0]; show(); } }, [document.createTextNode(t[1]), t[0] === 'designs' && pending ? h('i', { text: fa(pending) }) : null]));
    });
  }
  function show() {
    tabs();
    ['progress', 'designs', 'files', 'invoices', 'chat'].forEach(function (k) { document.getElementById('pane-' + k).hidden = k !== tab; });
    if (tab === 'chat') { var b = document.getElementById('chat-messages'); b.scrollTop = b.scrollHeight; }
  }

  function progress() {
    var p = data.project, pane = document.getElementById('pane-progress');
    pane.replaceChildren(h('article', { class: 'card portal-card' }, [
      h('div', { class: 'portal-prog-head' }, [h('div', null, [h('small', { text: 'پیشرفت پروژه' }), h('strong', { text: p.name })]), h('span', { class: 'chip brand', text: PST[p.status] || '' })]),
      h('div', { class: 'portal-bar' }, [h('i', { style: 'width:' + p.progress + '%' })]),
      h('div', { class: 'portal-prog-foot' }, [h('b', { text: fa(p.progress) + '٪ انجام شده' }), h('small', { text: jal(p.start) + ' تا ' + jal(p.end) })])
    ]));
    if (p.milestones.length) pane.append(h('article', { class: 'card portal-card' }, [h('h3', { text: 'مراحل' }), h('ol', { class: 'portal-steps' }, p.milestones.map(function (m) {
      return h('li', { class: m.status }, [h('span', { class: 'dot' }), h('div', null, [h('strong', { text: m.title }), h('small', { text: jal(m.start) + ' تا ' + jal(m.end) + ' · ' + (PST[m.status] || '') })])]);
    }))]));
    var secs = p.sections.filter(function (s) { return s.total; });
    if (secs.length) pane.append(h('article', { class: 'card portal-card' }, [h('h3', { text: 'بخش‌ها' })].concat(secs.map(function (s) {
      var pc = Math.round(s.done / s.total * 100);
      return h('div', { class: 'portal-sec' }, [h('span', { text: s.title }), h('div', { class: 'portal-bar sm' }, [h('i', { style: 'width:' + pc + '%' })]), h('b', { text: fa(pc) + '٪' })]);
    }))));
  }

  function designs() {
    var pane = document.getElementById('pane-designs');
    pane.replaceChildren();
    if (!data.designs.length) { pane.append(empty('هنوز طرحی برای بررسی ارسال نشده است.')); return; }
    var grid = h('div', { class: 'portal-grid' });
    data.designs.forEach(function (d) {
      var open = d.pins.filter(function (p) { return !p.parent_id && !p.resolved; }).length;
      grid.append(h('button', { type: 'button', class: 'card portal-design', onclick: function () { review(d); } }, [
        h('img', { src: d.file.url, alt: d.title, loading: 'lazy' }),
        h('div', { class: 'pd-copy' }, [h('strong', { text: d.title + (d.version > 1 ? ' · نسخه ' + fa(d.version) : '') }), h('span', { class: 'chip ' + (d.status === 'approved' ? 'ok' : d.status === 'changes' ? 'danger' : 'brand'), text: ST[d.status] }), open ? h('small', { text: fa(open) + ' نظر باز' }) : null])
      ]));
    });
    pane.append(grid);
  }

  function review(d) {
    var pane = document.getElementById('pane-designs');
    var viewer = h('div');
    var note = h('textarea', { rows: 2, maxlength: 1000, placeholder: 'توضیح کلی (اختیاری برای تأیید)' });
    function decide(kind) {
      api('/items/' + d.id + '/decision', { decision: kind, note: note.value.trim(), name: name() }).then(function (it) {
        d = it; replace(it); alert(kind === 'approved' ? 'طرح تأیید شد. سپاس!' : 'درخواست تغییر برای تیم ارسال شد.'); designs();
      }).catch(function (e) { alert(e.message); });
    }
    function replace(it) { data.designs = data.designs.map(function (x) { return x.id === it.id ? it : x; }); }
    pane.replaceChildren(h('div', { class: 'card portal-card' }, [
      h('div', { class: 'portal-review-head' }, [
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '→ همه طرح‌ها', onclick: designs }),
        h('strong', { text: d.title + (d.version > 1 ? ' · نسخه ' + fa(d.version) : '') }),
        h('span', { class: 'chip ' + (d.status === 'approved' ? 'ok' : d.status === 'changes' ? 'danger' : 'brand'), text: ST[d.status] })]),
      d.note ? h('p', { class: 'portal-note', text: d.note }) : null,
      viewer,
      d.status === 'approved' ? h('p', { class: 'portal-note ok', text: 'این طرح را ' + (d.decided_by || 'شما') + ' تأیید کرده است.' }) : h('div', { class: 'portal-decide' }, [note, h('div', null, [
        h('button', { type: 'button', class: 'btn btn-primary', text: 'تأیید طرح', onclick: function () { if (confirm('این طرح تأیید شود؟')) decide('approved'); } }),
        h('button', { type: 'button', class: 'btn btn-secondary', text: 'درخواست تغییر', onclick: function () { decide('changes'); } })])])
    ]));
    window.MPPins.mount(viewer, d, { team: false, name: name, post: function (b) { return api('/items/' + d.id + '/pins', b).then(function (it) { replace(it); d = it; return it; }); } });
  }

  function files() {
    var pane = document.getElementById('pane-files');
    pane.replaceChildren(data.files.length ? h('div', { class: 'card portal-card portal-files' }, data.files.map(function (f) {
      return h('a', { class: 'portal-file', href: f.file.url, target: '_blank', rel: 'noopener', download: f.file.name }, [
        f.file.image ? h('img', { src: f.file.url, alt: '' }) : h('span', { class: 'pf-ico', text: (f.file.name.split('.').pop() || '').toUpperCase().slice(0, 4) }),
        h('div', null, [h('strong', { text: f.title }), h('small', { text: jal(f.created_at) + (f.note ? ' · ' + f.note : '') })]),
        h('span', { class: 'btn btn-secondary btn-sm', text: 'دانلود' })]);
    })) : empty('هنوز فایلی تحویل داده نشده است.'));
  }

  function invoices() {
    var pane = document.getElementById('pane-invoices');
    pane.replaceChildren(data.invoices.length ? h('div', { class: 'card portal-card portal-files' }, data.invoices.map(function (x) {
      return h('a', { class: 'portal-file', href: x.url, target: '_blank', rel: 'noopener' }, [
        h('span', { class: 'pf-ico', text: x.kind === 'proforma' ? 'پیش' : 'فاکتور' }),
        h('div', null, [h('strong', { text: (x.kind === 'proforma' ? 'پیش‌فاکتور ' : 'فاکتور ') + x.number + (x.title ? ' — ' + x.title : '') }), h('small', { text: jal(x.date) + ' · ' + money(x.total) })]),
        h('span', { class: 'chip ' + (x.status === 'paid' ? 'ok' : 'brand'), text: IST[x.status] || '' })]);
    })) : empty('فاکتوری برای این پروژه صادر نشده است.'));
  }

  api('/portal').then(function (d) {
    data = d;
    if (!d.project) return; // no project: the page stays a plain chat
    tab = d.designs.some(function (x) { return x.status === 'pending'; }) ? 'designs' : 'progress';
    progress(); designs(); files(); invoices(); show();
  }).catch(function () { /* chat keeps working */ });
})();
