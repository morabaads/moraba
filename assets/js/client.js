/* Client portal (public link): mobile login, then progress, designs (pins), files, invoices and the conversation. */
(function () {
  'use strict';
  var base = window.MP_CLIENT.url;
  var me = null, data = null, tab = 'progress', lastId = 0, chatTimer = null;
  var ST = { pending: 'منتظر نظر شما', approved: 'تأیید شد', changes: 'نیاز به تغییر', delivered: 'تحویل شد' };
  var PST = { waiting: 'در انتظار شروع', doing: 'در حال انجام', done: 'تمام‌شده' };
  var IST = { sent: 'منتظر پرداخت', accepted: 'تأیید شد', paid: 'پرداخت شد', cancelled: 'لغو شد' };
  var MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  var TABS = [['progress', 'پیشرفت پروژه', 'pie'], ['designs', 'طرح‌ها', 'eye'], ['files', 'فایل‌های تحویلی', 'download'], ['invoices', 'فاکتورها', 'file'], ['chat', 'گفت‌وگو', 'chat']];

  /* ------------------------------------------------------------ helpers */
  function $(id) { return document.getElementById(id); }
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') n.textContent = v; else if (k === 'html') n.innerHTML = v; else if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c) n.append(c); });
    return n;
  }
  function icon(n) { return '<svg class="icon" aria-hidden="true"><use href="#' + n + '"></use></svg>'; }
  function fa(n) { return String(n).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function latin(s) { return String(s).replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }); }
  function money(n) { return fa(Number(n || 0).toLocaleString('en-US')) + ' تومان'; }
  function j(iso) { // Gregorian → [jy, jm, jd]
    var p = iso.slice(0, 10).split('-').map(Number), gy = p[0], gm = p[1], gd = p[2];
    var g = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], gy2 = gm > 2 ? gy + 1 : gy;
    var days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + g[gm - 1];
    var jy = -1595 + 33 * Math.floor(days / 12053); days %= 12053; jy += 4 * Math.floor(days / 1461); days %= 1461;
    if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
    return [jy, days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30), 1 + (days < 186 ? days % 31 : (days - 186) % 30)];
  }
  function jal(iso, year) { if (!iso) return ''; var x = j(iso); return fa(x[2]) + ' ' + MONTHS[x[1] - 1] + (year === false ? '' : ' ' + fa(x[0])); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }
  function toast(t) { var n = $('cp-toast'); n.textContent = t; n.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { n.classList.remove('on'); }, 3200); }
  function api(path, body) {
    return fetch(base + path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { var e = new Error(d.message || 'خطا'); e.code = d.code; throw e; } return d; }); });
  }
  function initials(name) { return String(name || '؟').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join(''); }
  function logoInto(el, url, name) { el.replaceChildren(url ? h('img', { src: url, alt: name }) : h('span', { text: initials(name) })); }

  /* ------------------------------------------------------------ login */
  var loginMobile = '', resendTimer = null;
  function showLogin() {
    $('cp-app').hidden = true; $('cp-login').hidden = false;
    $('cp-login-title').textContent = me.title;
    if (me.logo) { $('cp-login-client').src = me.logo; $('cp-login-client').hidden = false; $('cp-login-x').hidden = false; }
    if (!me.sms) { $('cp-login-sub').textContent = 'ورود با کد پیامک در حال حاضر فعال نیست؛ لطفاً با تیم مربع تماس بگیرید.'; $('cp-step-mobile').hidden = true; }
    setTimeout(function () { $('cp-step-mobile').elements.mobile.focus(); }, 60);
  }
  function loginError(t) { $('cp-login-error').textContent = t || ''; }
  function busy(form, on, label) { var b = form.querySelector('[type=submit]'); b.disabled = on; if (label) { b.dataset.l = b.dataset.l || b.textContent; b.textContent = on ? label : b.dataset.l; } }
  function countdown(sec) {
    var b = $('cp-resend'); clearInterval(resendTimer); b.disabled = true;
    resendTimer = setInterval(function () { sec--; b.textContent = sec > 0 ? 'ارسال دوباره (' + fa(sec) + ')' : 'ارسال دوباره'; if (sec <= 0) { clearInterval(resendTimer); b.disabled = false; } }, 1000);
  }
  function requestCode(mobile) {
    loginError('');
    var f = $('cp-step-mobile'); busy(f, true, 'در حال ارسال…');
    return api('/login/request', { mobile: latin(mobile) }).then(function (r) {
      busy(f, false, 'x'); loginMobile = r.mobile;
      $('cp-step-mobile').hidden = true; $('cp-step-code').hidden = false;
      $('cp-code-label').textContent = 'کد ۵ رقمی ارسال‌شده به ' + fa(r.mobile);
      $('cp-step-code').elements.code.value = ''; $('cp-step-code').elements.code.focus();
      countdown(r.wait || 60);
    }).catch(function (e) { busy(f, false, 'x'); loginError(e.message); });
  }
  $('cp-step-mobile').onsubmit = function (e) { e.preventDefault(); requestCode(this.elements.mobile.value); };
  $('cp-step-code').onsubmit = function (e) {
    e.preventDefault(); loginError('');
    var f = this; busy(f, true, 'در حال بررسی…');
    api('/login/verify', { mobile: loginMobile, code: latin(f.elements.code.value) }).then(function () { return start(); })
      .catch(function (err) { busy(f, false, 'x'); loginError(err.message); f.elements.code.select(); });
  };
  $('cp-step-code').elements.code.addEventListener('input', function () { var v = latin(this.value).replace(/\D/g, ''); this.value = fa(v); if (v.length === 5) $('cp-step-code').requestSubmit(); });
  $('cp-change').onclick = function () { $('cp-step-code').hidden = true; $('cp-step-mobile').hidden = false; loginError(''); };
  $('cp-resend').onclick = function () { requestCode(loginMobile); };
  $('cp-logout').onclick = function () { api('/logout', {}).then(function () { location.reload(); }); };

  /* ------------------------------------------------------------ shell */
  function badge(k) {
    if (!data) return 0;
    if (k === 'designs') return data.designs.filter(function (d) { return d.status === 'pending'; }).length;
    if (k === 'invoices') return data.invoices.filter(function (x) { return x.kind === 'invoice' && x.status === 'sent'; }).length;
    return 0;
  }
  function tabs() {
    var list = data && data.project ? TABS : TABS.filter(function (t) { return t[0] === 'chat'; });
    // Sidebar: the panel's own menu items; phones: a bottom tab bar.
    var side = $('cp-nav'); side.replaceChildren();
    list.forEach(function (t) {
      var n = badge(t[0]);
      side.append(h('button', { type: 'button', class: 'nav-item' + (t[0] === tab ? ' active' : ''), 'aria-current': t[0] === tab ? 'page' : null, onclick: function () { go(t[0]); } }, [
        h('span', { class: 'cp-ni', html: icon(t[2]) }), h('span', { class: 'nav-label', text: t[1] }), n ? h('span', { class: 'badge', text: fa(n) }) : null]));
    });
    var bar = $('cp-tabbar'); bar.replaceChildren();
    list.forEach(function (t) {
      var n = badge(t[0]);
      bar.append(h('button', { type: 'button', class: 'cp-tab' + (t[0] === tab ? ' on' : ''), onclick: function () { go(t[0]); } }, [
        h('span', { class: 'cp-tab-ico', html: icon(t[2]) }), h('span', { class: 'cp-tab-label', text: t[0] === 'files' ? 'فایل‌ها' : t[0] === 'progress' ? 'پیشرفت' : t[1] }), n ? h('i', { text: fa(n) }) : null]));
    });
  }
  var SUB = {
    progress: function () { return data.project ? data.project.name : ''; },
    designs: function () { return 'روی هر قسمت طرح کلیک کنید و نظرتان را همان‌جا بنویسید؛ بعد تأیید کنید یا تغییر بخواهید.'; },
    files: function () { return 'فایل‌های نهایی که تیم تحویل داده است.'; },
    invoices: function () { return 'پیش‌فاکتورها و فاکتورهای این پروژه.'; },
    chat: function () { return 'گفت‌وگو با تیم مربع؛ پاسخ‌ها همین‌جا می‌آید.'; }
  };
  function go(k) {
    tab = k; tabs();
    TABS.forEach(function (t) { $('pane-' + t[0]).hidden = t[0] !== k; });
    $('cp-page-title').textContent = TABS.filter(function (t) { return t[0] === k; })[0][1];
    $('cp-page-sub').textContent = SUB[k]();
    try { history.replaceState(null, '', '#' + k); } catch (e) { /* file: */ }
    window.scrollTo(0, 0);
    if (k === 'chat') { var b = $('chat-messages'); setTimeout(function () { b.scrollTop = b.scrollHeight; }, 30); loadChat(true); }
  }

  /* ------------------------------------------------------------ progress */
  function ring(pct) {
    var r = 52, c = 2 * Math.PI * r;
    return '<svg viewBox="0 0 120 120" class="cp-ring"><circle cx="60" cy="60" r="' + r + '" class="bg"/><circle cx="60" cy="60" r="' + r + '" class="fg" stroke-dasharray="' + c + '" stroke-dashoffset="' + (c * (1 - pct / 100)) + '"/></svg>';
  }
  function progress() {
    var p = data.project, pane = $('pane-progress'), t = today();
    var left = p.end ? daysBetween(t, p.end) : null;
    var pend = data.designs.filter(function (d) { return d.status === 'pending'; }).length;
    var unpaid = data.invoices.filter(function (x) { return x.kind === 'invoice' && x.status === 'sent'; });
    pane.replaceChildren(
      h('div', { class: 'cp-hero' }, [
        h('div', { class: 'cp-ring-wrap', html: ring(p.progress) + '<div class="cp-ring-num"><b>' + fa(p.progress) + '٪</b><small>انجام شده</small></div>' }),
        h('div', { class: 'cp-hero-copy' }, [
          h('span', { class: 'chip ' + (p.status === 'done' ? 'ok' : 'brand'), text: PST[p.status] || '' }),
          h('h2', { text: p.name }),
          h('p', { text: jal(p.start) + ' تا ' + jal(p.end) }),
          left !== null ? h('div', { class: 'cp-left' + (left < 0 && p.status !== 'done' ? ' late' : '') }, [h('b', { text: p.status === 'done' ? 'تحویل شد 🎉' : left >= 0 ? fa(left) : fa(-left) }), h('span', { text: p.status === 'done' ? '' : left >= 0 ? 'روز تا تحویل' : 'روز از موعد گذشته' })]) : null
        ])
      ]),
      h('div', { class: 'kpis cp-stats' }, [
        stat('eye', 'طرح منتظر نظر شما', fa(pend), pend ? function () { go('designs'); } : null, pend ? 'warn' : ''),
        stat('download', 'فایل تحویلی', fa(data.files.length), data.files.length ? function () { go('files'); } : null),
        stat('file', 'فاکتور منتظر پرداخت', unpaid.length ? money(unpaid.reduce(function (s, x) { return s + x.total; }, 0)) : '—', unpaid.length ? function () { go('invoices'); } : null, unpaid.length ? 'warn' : ''),
        stat('pie', 'مرحله‌های انجام‌شده', fa(p.milestones.filter(function (m) { return m.status === 'done'; }).length) + ' از ' + fa(p.milestones.length))
      ])
    );
    if (p.milestones.length) {
      pane.append(h('article', { class: 'cp-card' }, [h('h3', { text: 'مراحل پروژه' }), h('ol', { class: 'cp-steps' }, p.milestones.map(function (m) {
        var now = m.status !== 'done' && m.start <= t && m.end >= t;
        return h('li', { class: m.status + (now ? ' now' : '') }, [h('span', { class: 'dot', html: m.status === 'done' ? icon('check') : '' }), h('div', null, [h('strong', { text: m.title }), h('small', { text: jal(m.start, false) + ' تا ' + jal(m.end, false) + ' · ' + (m.status === 'done' ? 'انجام شد' : now ? 'در حال انجام' : PST[m.status] || '') })])]);
      }))]));
    }
    var secs = p.sections.filter(function (s) { return s.total; });
    if (secs.length) pane.append(h('article', { class: 'cp-card' }, [h('h3', { text: 'پیشرفت بخش‌ها' })].concat(secs.map(function (s) {
      var pc = Math.round(s.done / s.total * 100);
      return h('div', { class: 'cp-sec' }, [h('span', { text: s.title }), h('div', { class: 'cp-bar' }, [h('i', { style: 'width:' + pc + '%' })]), h('b', { text: fa(pc) + '٪' })]);
    }))));
  }
  function stat(ic, label, value, onclick, tone) {
    // Same KPI card as the panel's dashboard.
    return h('article', { class: 'card kpi' + (onclick ? '' : ' static'), tabindex: onclick ? '0' : null, role: onclick ? 'button' : null, onclick: onclick }, [h('div', { class: 'kpi-icon' + (tone === 'warn' ? ' warn' : ''), html: icon(ic) }), h('div', { class: 'kpi-copy' }, [h('small', { text: label }), h('strong', { text: value })])]);
  }

  /* ------------------------------------------------------------ designs */
  function tone(s) { return s === 'approved' ? 'ok' : s === 'changes' ? 'danger' : 'brand'; }
  var reviewing = false;
  function designs() {
    var pane = $('pane-designs'); reviewing = false;
    if (!data.designs.length) { pane.replaceChildren(empty('eye', 'هنوز طرحی برای بررسی ارسال نشده', 'وقتی تیم طرحی بفرستد، اینجا می‌بینید و نظر می‌دهید.')); return; }
    pane.replaceChildren(h('div', { class: 'cp-grid' }, data.designs.map(function (d) {
      var open = d.pins.filter(function (p) { return !p.parent_id && !p.resolved; }).length;
      return h('button', { type: 'button', class: 'cp-design', onclick: function () { review(d); } }, [
        h('span', { class: 'cp-thumb' }, [h('img', { src: d.file.url, alt: d.title, loading: 'lazy' }), d.status === 'pending' ? h('em', { text: 'منتظر نظر شما' }) : null]),
        h('div', { class: 'cp-design-copy' }, [h('strong', { text: d.title }), h('div', null, [h('span', { class: 'chip ' + tone(d.status), text: ST[d.status] }), d.version > 1 ? h('span', { class: 'chip', text: 'نسخه ' + fa(d.version) }) : null, open ? h('span', { class: 'chip', text: fa(open) + ' نظر باز' }) : null])])
      ]);
    })));
  }
  function review(d) {
    var pane = $('pane-designs'), viewer = h('div'); reviewing = true;
    var note = h('textarea', { rows: 2, maxlength: 1000, placeholder: 'توضیح کلی (برای درخواست تغییر لازم است)' });
    function replace(it) { data.designs = data.designs.map(function (x) { return x.id === it.id ? it : x; }); tabs(); }
    function decide(kind) {
      api('/items/' + d.id + '/decision', { decision: kind, note: note.value.trim(), name: myName() }).then(function (it) {
        replace(it); toast(kind === 'approved' ? 'طرح تأیید شد. سپاس!' : 'درخواست تغییر برای تیم ارسال شد.'); designs();
      }).catch(function (e) { toast(e.message); });
    }
    pane.replaceChildren(h('article', { class: 'cp-card' }, [
      h('div', { class: 'cp-review-head' }, [
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', html: icon('right') + ' همه طرح‌ها', onclick: designs }),
        h('strong', { text: d.title + (d.version > 1 ? ' · نسخه ' + fa(d.version) : '') }),
        h('span', { class: 'chip ' + tone(d.status), text: ST[d.status] })]),
      d.note ? h('p', { class: 'cp-note', text: d.note }) : null,
      viewer,
      d.status === 'approved' ? h('p', { class: 'cp-note ok', text: '✓ این طرح را ' + (d.decided_by || 'شما') + ' تأیید کرده است.' }) : h('div', { class: 'cp-decide' }, [note, h('div', null, [
        h('button', { type: 'button', class: 'btn btn-primary', html: icon('check') + ' تأیید طرح', onclick: function () { if (confirm('این طرح تأیید شود؟')) decide('approved'); } }),
        h('button', { type: 'button', class: 'btn btn-secondary', text: 'درخواست تغییر', onclick: function () { decide('changes'); } })])])
    ]));
    window.MPPins.mount(viewer, d, { team: false, name: myName, post: function (b) { return api('/items/' + d.id + '/pins', b).then(function (it) { replace(it); d = it; return it; }); } });
  }

  /* ------------------------------------------------------------ files & invoices */
  function empty(ic, t, s) { return h('div', { class: 'cp-empty' }, [h('span', { html: icon(ic) }), h('strong', { text: t }), s ? h('p', { text: s }) : null]); }
  function ext(n) { return (String(n).split('.').pop() || '').toUpperCase().slice(0, 4); }
  function files() {
    var pane = $('pane-files');
    pane.replaceChildren(data.files.length ? h('div', { class: 'cp-card cp-list' }, data.files.map(function (f) {
      return h('a', { class: 'cp-row', href: f.file.url, target: '_blank', rel: 'noopener', download: f.file.name }, [
        f.file.image ? h('img', { class: 'cp-row-ico', src: f.file.url, alt: '' }) : h('span', { class: 'cp-row-ico', text: ext(f.file.name) }),
        h('div', { class: 'cp-row-copy' }, [h('strong', { text: f.title }), h('small', { text: jal(f.created_at) + (f.note ? ' · ' + f.note : '') })]),
        h('span', { class: 'btn btn-secondary btn-sm', html: icon('download') + ' دانلود' })]);
    })) : empty('download', 'هنوز فایلی تحویل نشده', null));
  }
  function invoices() {
    var pane = $('pane-invoices');
    pane.replaceChildren(data.invoices.length ? h('div', { class: 'cp-card cp-list' }, data.invoices.map(function (x) {
      return h('a', { class: 'cp-row', href: x.url, target: '_blank', rel: 'noopener' }, [
        h('span', { class: 'cp-row-ico', html: icon('file') }),
        h('div', { class: 'cp-row-copy' }, [h('strong', { text: (x.kind === 'proforma' ? 'پیش‌فاکتور ' : 'فاکتور ') + fa(x.number) + (x.title ? ' — ' + x.title : '') }), h('small', { text: jal(x.date) })]),
        h('div', { class: 'cp-row-end' }, [h('b', { text: money(x.total) }), h('span', { class: 'chip ' + (x.status === 'paid' ? 'ok' : x.status === 'cancelled' ? 'danger' : 'brand'), text: x.kind === 'proforma' && x.status === 'sent' ? 'منتظر تأیید' : IST[x.status] || '' })])]);
    })) : empty('file', 'فاکتوری صادر نشده', null));
  }

  /* ------------------------------------------------------------ chat */
  var box = $('chat-messages'), form = $('client-form'), lastDay = '', sending = Promise.resolve(), chatBusy = null;
  function myName() { return me && me.name ? me.name : (form.elements.name.value.trim() || ''); }
  function hm(s) { return fa(String(s || '').slice(11, 16)); }
  var SYS_ICON = { design: 'eye', file: 'download', invoice: 'file', join: 'user' };
  function sysCard(m) {
    var t = m.meta && m.meta.t, act = null;
    if (t === 'invoice' && m.meta.url) act = h('a', { class: 'sys-link', href: m.meta.url, target: '_blank', rel: 'noopener', text: 'مشاهده ' + (m.meta.k === 'proforma' || /^پیش‌فاکتور/.test(m.body) ? 'پیش‌فاکتور' : 'فاکتور') });
    else if ((t === 'design' || t === 'file') && data && data.project) act = h('button', { type: 'button', class: 'sys-link', text: t === 'design' ? 'دیدن طرح' : 'دانلود فایل', onclick: function () {
      var d = t === 'design' && data.designs.filter(function (x) { return x.id === m.meta.id; })[0];
      go(t === 'design' ? 'designs' : 'files'); if (d) review(d);
    } });
    return h('div', { class: 'sys-msg' }, [h('span', { class: 'sys-ico', html: icon(SYS_ICON[t] || 'bell') }), h('p', { text: m.body }), act, h('time', { text: hm(m.created_at) })]);
  }
  function loadChat(scroll) {
    // One request at a time; a caller during a running one waits for it and then asks again.
    if (chatBusy) return chatBusy.then(function () { return loadChat(scroll); });
    chatBusy = fetchChat(scroll).then(function () { chatBusy = null; }, function () { chatBusy = null; });
    return chatBusy;
  }
  function fetchChat(scroll) {
    return api('?after=' + lastId).then(function (d) {
      var near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
      if (!lastId && !d.messages.length && !box.querySelector('.bubble-row')) box.replaceChildren(empty('chat', 'اولین پیام را بفرستید', 'تیم مربع همین‌جا پاسخ می‌دهد.'));
      // Polls and sends can overlap: a message already shown is never added again.
      var first = !lastId, stale = false;
      d.messages.filter(function (m) { return m.id > lastId; }).forEach(function (m) {
        var tmp = box.querySelector('.bubble-row.b-pending'); if (tmp && !m.team) tmp.remove();
        if (!lastId) box.replaceChildren();
        lastId = Math.max(lastId, m.id);
        var e = box.querySelector('.cp-empty'); if (e) e.remove();
        var day = m.created_at.slice(0, 10);
        if (day !== lastDay) { lastDay = day; box.append(h('div', { class: 'day-sep', text: day === today() ? 'امروز' : jal(day) })); }
        if (m.kind === 'system') { if (!first && m.meta && m.meta.t !== 'join') stale = true; box.append(sysCard(m)); return; }
        var mine = !m.team;
        var b = h('div', { class: 'bubble' }, [h('span', { class: 'b-author', text: m.author + (m.team ? ' · تیم مربع' : '') })]);
        if (m.file && /^audio\//.test(m.file.mime || '')) b.append(h('audio', { controls: '', preload: 'metadata', src: m.file.url, class: 'b-audio' }));
        else if (m.file && m.file.image) b.append(h('a', { href: m.file.url, target: '_blank', rel: 'noopener' }, [h('img', { class: 'b-img', src: m.file.url, alt: m.file.name })]));
        else if (m.file) b.append(h('a', { class: 'file-chip', href: m.file.url, target: '_blank', rel: 'noopener', html: icon('clip') + '<span></span>' }));
        if (m.file && !m.file.image && !/^audio\//.test(m.file.mime || '')) b.querySelector('.file-chip span').textContent = m.file.name;
        if (m.body) b.append(h('p', { text: m.body }));
        b.append(h('span', { class: 'b-meta', text: hm(m.created_at) }));
        box.append(h('div', { class: 'bubble-row ' + (mine ? 'me' : 'other') + (lastId && !scroll ? ' b-new' : '') }, [b]));
      });
      if (scroll || (d.messages.length && near)) box.scrollTop = box.scrollHeight;
      if (stale) refresh(); // a new design, file or invoice: the other tabs and badges update too
    }).catch(function (e) { if (e.code === 'mp_login_required') location.reload(); });
  }
  form.onsubmit = function (e) {
    e.preventDefault();
    var ta = form.elements.message, body = ta.value.trim();
    if (!body) return;
    if (!me.logged_in) { var n = form.elements.name.value.trim(); try { localStorage.setItem('mp-client-name', n); } catch (err) { /* private */ } }
    ta.value = ''; ta.style.height = '';
    // Shown at once; swapped for the saved message when the server answers.
    var e0 = box.querySelector('.cp-empty'); if (e0) e0.remove();
    var row = h('div', { class: 'bubble-row me b-pending' }, [h('div', { class: 'bubble' }, [h('p', { text: body }), h('span', { class: 'b-meta', text: 'در حال ارسال…' })])]);
    box.append(row); box.scrollTop = box.scrollHeight;
    sending = sending.then(function () { return api('', { body: body, name: myName() }); }).then(function () { row.remove(); return loadChat(true); })
      .catch(function (err) { row.remove(); ta.value = body; toast(err.message || 'ارسال نشد'); });
  };
  form.elements.message.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  form.elements.message.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(140, this.scrollHeight) + 'px'; });

  function refresh() {
    return api('/portal').then(function (d) { data = d; if (d.project) { progress(); if (!reviewing) designs(); files(); invoices(); } tabs(); }).catch(function () {});
  }

  /* ------------------------------------------------------------ start */
  function start() {
    return api('/me').then(function (m) {
      me = m;
      if (m.auth_required && !m.logged_in) { showLogin(); return null; }
      $('cp-login').hidden = true; $('cp-app').hidden = false;
      document.title = m.title + ' | مربع استودیو';
      $('cp-client-name').textContent = m.client || m.title;
      $('cp-project-name').textContent = m.title;
      logoInto($('cp-client-logo'), m.logo, m.client || m.title);
      logoInto($('cp-client-logo-m'), m.logo, m.client || m.title);
      var hr = new Date().getHours(), first = m.logged_in ? String(m.name).split(' ')[0] : '';
      $('cp-hello').textContent = (hr < 12 ? 'صبح بخیر' : hr < 17 ? 'روز بخیر' : 'عصر بخیر') + (first ? '، ' + first : '');
      $('cp-hello-sub').textContent = (m.client || '') + (m.client && m.title ? ' · ' : '') + m.title;
      var tj = j(today()); $('cp-today').textContent = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'][new Date().getDay()] + ' ' + fa(tj[2]) + ' ' + MONTHS[tj[1] - 1] + ' ' + fa(tj[0]);
      if (m.logged_in) { $('cp-logout').hidden = false; $('cp-me-avatar').hidden = false; $('cp-me-avatar').textContent = initials(m.name); $('cp-me-avatar').title = m.name; }
      else { form.elements.name.hidden = false; try { form.elements.name.value = localStorage.getItem('mp-client-name') || ''; } catch (e) { /* private */ } }
      return api('/portal').then(function (d) {
        data = d;
        var want = (location.hash || '').slice(1);
        if (!d.project) tab = 'chat';
        else {
          progress(); designs(); files(); invoices();
          tab = TABS.some(function (t) { return t[0] === want; }) ? want : d.designs.some(function (x) { return x.status === 'pending'; }) ? 'designs' : 'progress';
        }
        go(tab);
        clearInterval(chatTimer);
        chatTimer = setInterval(function () { if (!document.hidden) loadChat(false); }, 5000);
        loadChat(true);
      });
    }).catch(function (e) {
      document.body.replaceChildren(h('main', { class: 'cp-login' }, [h('div', { class: 'cp-login-card' }, [h('img', { src: document.querySelector('.cp-studio-logo') ? document.querySelector('.cp-studio-logo').src : '', class: 'cp-studio-logo', alt: '' }), h('h1', { text: 'این لینک در دسترس نیست' }), h('p', { text: e.message || 'لینک را دوباره از تیم مربع بگیرید.' })])]));
    });
  }
  start();
})();
