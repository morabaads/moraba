/* Client portal (public link): mobile login, then progress, designs (pins), files, invoices and the conversation. */
(function () {
  'use strict';
  var base = window.MP_CLIENT.url;
  var me = null, data = null, tab = 'progress', lastId = 0, chatTimer = null;
  var ST = { pending: 'منتظر نظر شما', approved: 'تأیید شد', changes: 'نیاز به تغییر', delivered: 'تحویل شد' };
  var PST = { waiting: 'در انتظار شروع', doing: 'در حال انجام', done: 'تمام‌شده' };
  var IST = { sent: 'منتظر پرداخت', accepted: 'تأیید شد', paid: 'پرداخت شد', cancelled: 'لغو شد' };
  var MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  var TABS = [['progress', 'پیشرفت پروژه', 'pie'], ['designs', 'طرح‌ها', 'eye'], ['files', 'فایل‌های تحویلی', 'download'], ['invoices', 'فاکتورها', 'file'], ['contracts', 'قرارداد', 'edit'], ['meetings', 'جلسات', 'video'], ['chat', 'گفت‌وگو', 'chat']];

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
      var code = $('cp-step-code').elements.code;
      code.value = ''; code.focus();
      countdown(r.wait || 60);
      // Android Chrome reads the code straight from the SMS (its last line is «@site #code»).
      if ('OTPCredential' in window) {
        navigator.credentials.get({ otp: { transport: ['sms'] } }).then(function (o) { if (o && o.code && !$('cp-step-code').hidden) { code.value = fa(o.code); $('cp-step-code').requestSubmit(); } }).catch(function () {});
      }
    }).catch(function (e) { busy(f, false, 'x'); loginError(e.message); });
  }
  // Digits shown in Persian as they are typed (sent in Latin).
  $('cp-step-mobile').elements.mobile.addEventListener('input', function () { this.value = fa(latin(this.value).replace(/[^\d ]/g, '')); });
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
  /** Another of this person's conversations (a group, or the private chat with support) without a new login. */
  function switchTo(id) { api('/switch', { id: id }).then(function (r) { location.href = r.url + '#chat'; }).catch(function (e) { toast(e.message || 'باز نشد'); }); }
  function logout() { api('/logout', {}).then(function () { location.reload(); }).catch(function () { location.reload(); }); }
  $('cp-logout').onclick = logout;
  /* Header circle: who is logged in, the project, and «خروج از حساب». */
  var meMenu = null;
  function closeMe() { if (!meMenu) return; meMenu.remove(); meMenu = null; $('cp-me-btn').setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escMe, true); }
  function outside(e) { if (meMenu && !meMenu.contains(e.target) && !$('cp-me-btn').contains(e.target)) closeMe(); }
  function escMe(e) { if (e.key === 'Escape') { closeMe(); $('cp-me-btn').focus(); } }
  $('cp-me-btn').onclick = function () {
    if (meMenu) { closeMe(); return; }
    if (!me) return;
    var b = this.getBoundingClientRect();
    meMenu = h('div', { class: 'cp-me-menu', role: 'menu' }, [
      h('div', { class: 'cp-me-head' }, [
        me.logged_in ? h('span', { class: 'cp-avatar', text: initials(me.name) }) : h('span', { class: 'cp-client-logo sm' }),
        h('div', null, [h('strong', { text: me.logged_in ? me.name : (me.client || me.title) }), h('small', { text: (me.client || '') + (me.client && me.title ? ' · ' : '') + me.title })])]),
      (me.others || []).length ? h('div', { class: 'cp-me-others' }, [h('small', { text: 'گفت‌وگوهای دیگر شما' })].concat(me.others.map(function (x) {
        return h('button', { type: 'button', role: 'menuitem', class: 'cp-me-other', html: icon(x.pv ? 'chat' : 'user') + '<span></span>', onclick: function () { closeMe(); switchTo(x.id); } });
      }))) : null,
      me.logged_in ? h('button', { type: 'button', role: 'menuitem', class: 'cp-me-out', html: icon('logout') + '<span>' + (me.preview ? 'پایان «از طرف مشتری»' : 'خروج از حساب') + '</span>', onclick: function () { closeMe(); logout(); } })
        : h('p', { class: 'cp-me-note', text: 'برای این پرتال ورود با شماره موبایل لازم نیست.' })
    ]);
    Array.prototype.forEach.call(meMenu.querySelectorAll('.cp-me-other span'), function (sp, i) { sp.textContent = me.others[i].title; });
    if (!me.logged_in) logoInto(meMenu.querySelector('.cp-client-logo'), me.logo, me.client || me.title);
    meMenu.style.top = (b.bottom + 8) + 'px';
    meMenu.style.left = Math.max(8, Math.min(b.left, innerWidth - Math.min(280, innerWidth - 16) - 8)) + 'px';
    document.body.append(meMenu);
    this.setAttribute('aria-expanded', 'true');
    var out = meMenu.querySelector('.cp-me-out'); if (out) out.focus({ preventScroll: true });
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escMe, true);
  };
  window.addEventListener('resize', closeMe);

  /* ------------------------------------------------------------ shell */
  function badge(k) {
    if (!data) return 0;
    if (k === 'designs') return data.designs.filter(function (d) { return d.status === 'pending'; }).length;
    if (k === 'invoices') return data.invoices.filter(function (x) { return x.kind === 'invoice' && x.status === 'sent'; }).length;
    if (k === 'contracts') return (data.contracts || []).filter(function (x) { return x.status === 'sent'; }).length;
    if (k === 'meetings') return (data.meetings || []).filter(function (x) { return x.status === 'live'; }).length;
    return 0;
  }
  function tabs() {
    var hasMeet = data && (data.meetings || []).length;
    var list = data && data.project ? TABS.filter(function (t) { return (t[0] !== 'contracts' || (data.contracts || []).length) && (t[0] !== 'meetings' || hasMeet); }) : TABS.filter(function (t) { return t[0] === 'chat' || (t[0] === 'meetings' && hasMeet); });
    // Sidebar: the panel's own menu items; phones: a bottom tab bar.
    var side = $('cp-nav'); side.replaceChildren();
    list.forEach(function (t) {
      var n = badge(t[0]);
      side.append(h('button', { type: 'button', class: 'nav-item' + (t[0] === tab ? ' active' : ''), 'aria-current': t[0] === tab ? 'page' : null, onclick: function () { go(t[0]); } }, [
        h('span', { class: 'cp-ni', html: icon(t[2]) }), h('span', { class: 'nav-label', text: t[1] }), n ? h('span', { class: 'badge', text: fa(n) }) : null]));
    });
    // Same tabs as before: only move «on», so the pill animates instead of being redrawn.
    var bar = $('cp-tabbar'), key = list.map(function (t) { return t[0] + ':' + badge(t[0]); }).join(',');
    if (bar.dataset.key === key) {
      Array.prototype.forEach.call(bar.children, function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
      return;
    }
    bar.dataset.key = key; bar.replaceChildren();
    list.forEach(function (t) {
      var n = badge(t[0]);
      bar.append(h('button', { type: 'button', 'data-tab': t[0], class: 'cp-tab' + (t[0] === tab ? ' on' : ''), onclick: function () { go(t[0]); } }, [
        h('span', { class: 'cp-tab-ico', html: icon(t[2]) }), h('span', { class: 'cp-tab-label', text: t[0] === 'files' ? 'فایل‌ها' : t[0] === 'progress' ? 'پیشرفت' : t[1] }), n ? h('i', { text: fa(n) }) : null]));
    });
  }
  var SUB = {
    progress: function () { return data.project ? data.project.name : ''; },
    designs: function () { return 'روی هر قسمت طرح کلیک کنید و نظرتان را همان‌جا بنویسید؛ بعد تأیید کنید یا تغییر بخواهید.'; },
    files: function () { return 'فایل‌های نهایی که تیم تحویل داده است.'; },
    invoices: function () { return 'پیش‌فاکتورها و فاکتورهای این پروژه.'; },
    contracts: function () { return 'قراردادهای این پروژه؛ مطالعه، امضای آنلاین با کد پیامکی و نسخه PDF.'; },
    meetings: function () { return 'جلسه‌های آنلاین با تیم؛ در زمان جلسه روی «ورود» بزنید.'; },
    chat: function () { return 'گفت‌وگو با تیم مربع؛ پاسخ‌ها همین‌جا می‌آید.'; }
  };
  var prevTab = 'progress';
  function go(k) {
    if (k === 'chat' && tab !== 'chat') prevTab = tab;
    tab = k; tabs();
    // Like the team's panel: an open conversation takes the whole screen.
    document.body.classList.toggle('cp-chat-full', k === 'chat');
    document.body.dataset.tab = k;
    $('cp-chat-back').hidden = !(data && data.project);
    TABS.forEach(function (t) { $('pane-' + t[0]).hidden = t[0] !== k; });
    if (k !== 'chat') enter($('pane-' + k));
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
  /* ------------------------------------------------------------ motion helpers */
  var calm = function () { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; };
  /** Children of a pane enter one after another (CSS reads --i). */
  function enter(pane) {
    if (!pane || calm()) return;
    Array.prototype.forEach.call(pane.children, function (c, i) { c.style.setProperty('--i', Math.min(i, 8)); });
    pane.classList.remove('cp-in'); void pane.offsetWidth; pane.classList.add('cp-in');
  }
  /** A number that counts up to its value once. */
  function countUp(node, to, suffix) {
    if (calm() || !to) { node.textContent = fa(to) + (suffix || ''); return; }
    var t0 = Date.now(), dur = 900;
    (function step() {
      var k = Math.min(1, (Date.now() - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      node.textContent = fa(Math.round(to * e)) + (suffix || '');
      if (k < 1) setTimeout(step, 16);
    })();
  }

  /* ------------------------------------------------------------ project home */
  var homeShown = false;
  function progress() {
    var p = data.project, pane = $('pane-progress'), t = today(), first = !homeShown;
    homeShown = true;
    var left = p.end ? daysBetween(t, p.end) : null;
    var span = p.start && p.end ? Math.max(1, daysBetween(p.start, p.end)) : 0;
    var elapsed = span ? Math.min(100, Math.max(0, Math.round(daysBetween(p.start, t) / span * 100))) : 0;
    var tasks = p.tasks || [], doneT = tasks.filter(function (x) { return x.status === 'done'; }).length;
    var late = left !== null && left < 0 && p.status !== 'done';

    // Hero: name, ring, days left, the road from start to delivery.
    var r = 46, c = 2 * Math.PI * r;
    var ring = h('div', { class: 'cp-ring2', html: '<svg viewBox="0 0 108 108"><defs><linearGradient id="cpg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb35c"/><stop offset="1" stop-color="#f28a24"/></linearGradient></defs><circle cx="54" cy="54" r="' + r + '" class="bg"/><circle cx="54" cy="54" r="' + r + '" class="fg" stroke-dasharray="' + c + '" stroke-dashoffset="' + (first && !calm() ? c : c * (1 - p.progress / 100)) + '"/></svg>' });
    var pct = h('b', { text: first ? fa(0) + '٪' : fa(p.progress) + '٪' });
    ring.append(h('div', { class: 'cp-ring2-num' }, [pct, h('small', { text: 'پیشرفت' })]));
    var hero = h('section', { class: 'cp-hero2' + (p.status === 'done' ? ' done' : '') }, [
      h('div', { class: 'cp-h2-top' }, [
        h('span', { class: 'cp-h2-kicker', text: 'پروژه شما' }),
        h('span', { class: 'cp-h2-status ' + (p.status || ''), text: p.status === 'done' ? 'تحویل شد' : PST[p.status] || '' })]),
      h('h2', { text: p.name }),
      h('div', { class: 'cp-h2-body' }, [ring, h('div', { class: 'cp-h2-facts' }, [
        h('div', { class: 'cp-fact' + (late ? ' late' : '') }, [h('b', { text: p.status === 'done' ? '✓' : left === null ? '—' : fa(Math.abs(left)) }), h('small', { text: p.status === 'done' ? 'تحویل شده' : left === null ? 'بدون موعد' : late ? 'روز از موعد گذشته' : left === 0 ? 'امروز روز تحویل است' : 'روز تا تحویل' })]),
        tasks.length ? h('div', { class: 'cp-fact' }, [h('b', { text: fa(doneT) + '/' + fa(tasks.length) }), h('small', { text: 'کار انجام شده' })]) : null
      ])]),
      span ? h('div', { class: 'cp-road' }, [
        h('div', { class: 'cp-road-track' }, [h('i', { style: 'width:' + elapsed + '%' }), h('span', { class: 'cp-road-now', style: 'inset-inline-start:' + elapsed + '%' }, [h('em', { text: 'امروز' })])]),
        h('div', { class: 'cp-road-ends' }, [h('span', { text: 'شروع · ' + jal(p.start, false) }), h('span', { text: 'تحویل · ' + jal(p.end, false) })])
      ]) : null
    ]);
    if (first) {
      setTimeout(function () { var fg = ring.querySelector('.fg'); if (fg) fg.style.strokeDashoffset = c * (1 - p.progress / 100); }, 80);
      countUp(pct, p.progress, '٪');
    }

    pane.replaceChildren(hero, actions(t), tiles(p, doneT, tasks.length));
    if (p.milestones.length) {
      pane.append(h('article', { class: 'cp-card' }, [h('h3', { class: 'cp-h', html: icon('target') + '<span>مراحل پروژه</span>' }), h('ol', { class: 'cp-steps' }, p.milestones.map(function (m) {
        var now = m.status !== 'done' && m.start <= t && m.end >= t;
        return h('li', { class: m.status + (now ? ' now' : '') }, [h('span', { class: 'dot', html: m.status === 'done' ? icon('check') : '' }), h('div', null, [h('strong', { text: m.title }), h('small', { text: jal(m.start, false) + ' تا ' + jal(m.end, false) + ' · ' + (m.status === 'done' ? 'انجام شد' : now ? 'در حال انجام' : PST[m.status] || '') })])]);
      }))]));
    }
    if (tasks.length || canAddTask()) pane.append(taskBoard(tasks, t));
    var secs = p.sections.filter(function (s) { return s.total; });
    if (secs.length) pane.append(h('article', { class: 'cp-card' }, [h('h3', { class: 'cp-h', html: icon('grid') + '<span>پیشرفت بخش‌ها</span>' })].concat(secs.map(function (s) {
      var pc = Math.round(s.done / s.total * 100);
      return h('div', { class: 'cp-sec' }, [h('span', { text: s.title }), h('div', { class: 'cp-bar' }, [h('i', { style: 'width:' + pc + '%' })]), h('b', { text: fa(pc) + '٪' })]);
    }))));
  }

  /** «کارهای شما»: everything waiting on the client, each with one clear button. */
  function actions(t) {
    var list = [];
    var live = (data.meetings || []).filter(function (x) { return x.status === 'live'; })[0];
    if (live) list.push({ tone: 'live', ic: 'video', title: 'جلسه «' + live.title + '» همین حالا برگزار می‌شود', sub: 'تیم منتظر شماست', cta: 'ورود به جلسه', href: live.link });
    var pend = data.designs.filter(function (d) { return d.status === 'pending'; });
    if (pend.length) list.push({ tone: 'brand', ic: 'eye', title: pend.length > 1 ? fa(pend.length) + ' طرح منتظر نظر شماست' : 'طرح «' + pend[0].title + '» منتظر نظر شماست', sub: 'روی طرح نظر بدهید، تأیید کنید یا تغییر بخواهید', cta: 'دیدن طرح', run: function () { go('designs'); if (pend.length === 1) review(pend[0]); } });
    (data.contracts || []).filter(function (x) { return x.status === 'sent'; }).forEach(function (x) {
      list.push({ tone: 'brand', ic: 'edit', title: 'قرارداد ' + fa(x.number) + ' منتظر امضای شماست', sub: x.title || 'مطالعه و امضای آنلاین با کد پیامکی', cta: 'مطالعه و امضا', href: x.url });
    });
    data.invoices.filter(function (x) { return x.kind === 'proforma' && x.status === 'sent'; }).forEach(function (x) {
      list.push({ tone: 'brand', ic: 'file', title: 'پیش‌فاکتور ' + fa(x.number) + ' منتظر تأیید شماست', sub: money(x.total), cta: 'مشاهده و تأیید', href: x.url });
    });
    data.invoices.filter(function (x) { return x.kind === 'invoice' && x.status === 'sent'; }).forEach(function (x) {
      list.push({ tone: 'pay', ic: 'wallet', title: 'فاکتور ' + fa(x.number) + ' منتظر پرداخت', sub: money(x.total), cta: x.pay ? 'پرداخت آنلاین' : 'مشاهده فاکتور', run: x.pay ? function () { payNow(x); } : null, href: x.pay ? null : x.url });
    });
    var next = (data.meetings || []).filter(function (x) { return x.status !== 'live' && x.status !== 'ended' && x.date >= t; }).sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); })[0];
    var box = h('section', { class: 'cp-actions' }, [h('h3', { class: 'cp-h', html: icon('bell') + '<span>کارهای شما</span>' + (list.length ? '<em>' + fa(list.length) + '</em>' : '') })]);
    if (!list.length) box.append(h('div', { class: 'cp-act calm' }, [h('span', { class: 'cp-act-ico', html: icon('check') }), h('div', { class: 'cp-act-copy' }, [h('strong', { text: 'همه‌چیز طبق برنامه است' }), h('small', { text: 'فعلاً کاری از سمت شما لازم نیست؛ هر وقت چیزی برای بررسی آماده شد، همین‌جا می‌بینید.' })])]));
    list.forEach(function (a) {
      var btn = a.href ? h('a', { class: 'cp-act-btn', href: a.href, target: '_blank', rel: 'noopener', text: a.cta }) : h('button', { type: 'button', class: 'cp-act-btn', text: a.cta, onclick: a.run });
      box.append(h('div', { class: 'cp-act ' + a.tone }, [h('span', { class: 'cp-act-ico', html: icon(a.ic) }), h('div', { class: 'cp-act-copy' }, [h('strong', { text: a.title }), a.sub ? h('small', { text: a.sub }) : null]), btn]));
    });
    if (next) box.append(h('button', { type: 'button', class: 'cp-act soft', onclick: function () { go('meetings'); } }, [h('span', { class: 'cp-act-ico', html: icon('video') }), h('div', { class: 'cp-act-copy' }, [h('strong', { text: 'جلسه بعدی: ' + next.title }), h('small', { text: (next.date === t ? 'امروز' : jal(next.date)) + ' · ساعت ' + fa(next.time) })]), h('span', { class: 'cp-act-chev', html: icon('left') })]));
    return box;
  }

  /** Four tappable summary tiles. */
  function tiles(p, doneT, totalT) {
    var ok = data.designs.filter(function (d) { return d.status === 'approved'; }).length;
    var mdone = p.milestones.filter(function (m) { return m.status === 'done'; }).length;
    function tile(ic, label, value, sub, to) {
      return h(to ? 'button' : 'div', { type: to ? 'button' : null, class: 'cp-tile', onclick: to ? function () { go(to); } : null }, [
        h('span', { class: 'cp-tile-ico', html: icon(ic) }), h('b', { text: value }), h('small', { text: label }), sub ? h('i', { text: sub }) : null]);
    }
    return h('div', { class: 'cp-tiles' }, [
      tile('eye', 'طرح‌ها', fa(data.designs.length), data.designs.length ? fa(ok) + ' تأیید شده' : 'هنوز طرحی نیست', data.designs.length ? 'designs' : null),
      tile('download', 'فایل تحویلی', fa(data.files.length), data.files.length ? 'آماده دانلود' : '', data.files.length ? 'files' : null),
      tile('tasks', 'کار انجام‌شده', totalT ? fa(doneT) + '/' + fa(totalT) : '—', '', null),
      tile('target', 'مرحله', p.milestones.length ? fa(mdone) + '/' + fa(p.milestones.length) : '—', '', null)
    ]);
  }

  /* The team may let this client add tasks (group settings → «اجازه‌های مشتری»). */
  function canAddTask() { return !!(me && me.can_add_task); }
  function addTask() {
    var title = h('input', { name: 'title', maxlength: '200', required: '', placeholder: 'مثلاً نسخه انگلیسی کارت ویزیت' });
    var desc = h('textarea', { name: 'description', maxlength: '2000', placeholder: 'جزئیات، توضیح یا لینک (اختیاری)' });
    // Pictures (or any file): pick, paste or drop; they go up in pieces when the task is sent.
    var files = [], pick = h('input', { type: 'file', multiple: '', hidden: '' });
    var thumbs = h('div', { class: 'cp-tfiles' });
    var drop = h('button', { type: 'button', class: 'cp-tdrop', html: icon('image') + '<span>تصویر یا فایل را اینجا بکشید یا بزنید تا انتخاب کنید</span>', onclick: function () { pick.click(); } });
    function add(list) {
      Array.prototype.forEach.call(list || [], function (f) { if (files.length < 10) files.push({ f: f, url: /^image\//.test(f.type) ? URL.createObjectURL(f) : '' }); });
      if (list && list.length && files.length >= 10) toast('حداکثر ۱۰ پیوست');
      draw();
    }
    function draw() {
      thumbs.replaceChildren.apply(thumbs, files.map(function (x, i) {
        return h('div', { class: 'cp-tfile' }, [
          x.url ? h('img', { src: x.url, alt: '' }) : h('b', { text: (x.f.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase() }),
          h('small', { text: x.f.name }), h('i', { class: 'cp-tprog' }),
          h('button', { type: 'button', class: 'cp-tx', 'aria-label': 'حذف', html: icon('close'), onclick: function () { if (x.url) URL.revokeObjectURL(x.url); files.splice(i, 1); draw(); } })]);
      }));
    }
    pick.onchange = function () { add(pick.files); pick.value = ''; };
    var shade, sheet, f = h('form', { class: 'cp-taskform' }, [
      h('label', null, [document.createTextNode('عنوان کار'), title]),
      h('label', null, [document.createTextNode('توضیحات'), desc]),
      h('div', { class: 'cp-tattach' }, [h('span', { text: 'پیوست (اختیاری)' }), drop, pick, thumbs]),
      h('div', { class: 'cp-sheet-actions' }, [
        h('button', { type: 'button', class: 'btn btn-ghost', text: 'انصراف', onclick: function () { shade.remove(); } }),
        h('button', { type: 'submit', class: 'btn btn-primary', html: icon('plus') + 'ثبت کار' })])]);
    f.addEventListener('paste', function (e) { var l = e.clipboardData && e.clipboardData.files; if (l && l.length) { e.preventDefault(); add(l); } });
    f.onsubmit = function (e) {
      e.preventDefault();
      var b = f.querySelector('[type=submit]'); b.disabled = true;
      var bars = thumbs.querySelectorAll('.cp-tprog'), ids = [];
      files.reduce(function (p, x, i) {
        return p.then(function () { return chat.upload(x.f, function (v) { if (bars[i]) bars[i].style.width = Math.round(v * 100) + '%'; }).then(function (up) { ids.push(up.id); }); });
      }, Promise.resolve())
        .then(function () { return api('/tasks', { title: title.value, description: desc.value, file_ids: ids, name: myName() }); })
        .then(function () { shade.remove(); toast('کار ثبت شد؛ تیم مربع باخبر شد.'); refresh(); loadChat(false); })
        .catch(function (err) { b.disabled = false; toast(err.message || 'ثبت نشد'); });
    };
    sheet = h('div', { class: 'cp-sheet', role: 'dialog', 'aria-modal': 'true' }, [h('h3', { text: 'افزودن کار به پروژه' }), h('p', { text: 'کار به برنامه پروژه اضافه می‌شود و تیم مربع همان لحظه خبردار می‌شود.' }), f]);
    ['dragenter', 'dragover'].forEach(function (t) { sheet.addEventListener(t, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); sheet.classList.add('cp-drop'); } }); });
    sheet.addEventListener('dragleave', function (e) { if (!sheet.contains(e.relatedTarget)) sheet.classList.remove('cp-drop'); });
    sheet.addEventListener('drop', function (e) { sheet.classList.remove('cp-drop'); if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); add(e.dataTransfer.files); } });
    shade = h('div', { class: 'cp-sheet-shade', onclick: function (e) { if (e.target === shade) shade.remove(); } }, [sheet]);
    document.body.append(shade);
    setTimeout(function () { title.focus(); }, 50);
  }
  /* The project's tasks by schedule: status of each, filters, and the checklist on tap. */
  var taskFilter = 'all', taskMore = false;
  var TST = { todo: 'انجام نشده', doing: 'در حال انجام', done: 'انجام شد', late: 'عقب افتاده' };
  function taskState(x, t) { return x.status === 'done' ? 'done' : x.status === 'doing' ? 'doing' : x.date < t ? 'late' : 'todo'; }
  function taskBoard(all, t) {
    var card = h('article', { class: 'cp-card cp-tasks' });
    function draw() {
      var counts = { all: all.length, doing: 0, todo: 0, late: 0, done: 0 };
      all.forEach(function (x) { counts[taskState(x, t)]++; });
      var list = all.filter(function (x) { var s = taskState(x, t); return taskFilter === 'all' || s === taskFilter || (taskFilter === 'todo' && s === 'late'); });
      var LIMIT = 40, shown = taskMore ? list : list.slice(0, LIMIT);
      var filters = h('div', { class: 'cp-tfilters', role: 'tablist' }, [['all', 'همه'], ['doing', 'در حال انجام'], ['todo', 'باقی‌مانده'], ['done', 'انجام‌شده']].map(function (f) {
        var n = f[0] === 'todo' ? counts.todo + counts.late : counts[f[0]];
        return h('button', { type: 'button', role: 'tab', 'aria-selected': String(taskFilter === f[0]), onclick: function () { taskFilter = f[0]; taskMore = false; draw(); } }, [document.createTextNode(f[1] + ' '), h('span', { text: fa(n) })]);
      }));
      var rows = h('ol', { class: 'cp-tlist' }), lastDay = '';
      shown.forEach(function (x) {
        if (x.date !== lastDay) {
          lastDay = x.date;
          rows.append(h('li', { class: 'cp-tday' + (x.date === t ? ' today' : '') }, [h('span', { text: x.date === t ? 'امروز · ' + jal(x.date) : jal(x.date) })]));
        }
        var st = taskState(x, t), done = x.items.filter(function (i) { return i.done; }).length;
        var row = h('li', { class: 'cp-task ' + st });
        var head = h('button', { type: 'button', class: 'cp-task-head', 'aria-expanded': 'false', disabled: x.items.length ? null : '' }, [
          h('span', { class: 'cp-tdot', html: st === 'done' ? icon('check') : '' }),
          h('span', { class: 'cp-tcopy' }, [h('strong', null, [document.createTextNode(x.title), x.client ? h('span', { class: 'chip brand cp-by', text: 'درخواست شما' }) : null]), h('small', { text: [TST[st], x.time ? 'ساعت ' + fa(x.time) : '', x.section].filter(Boolean).join(' · ') })]),
          x.items.length ? h('span', { class: 'cp-tcheck', text: fa(done) + '/' + fa(x.items.length) }) : null,
          x.items.length ? h('span', { class: 'cp-tchev', html: icon('down') }) : null
        ]);
        row.append(head);
        if (x.items.length) {
          var box = h('ul', { class: 'cp-tchecklist', hidden: '' }, x.items.map(function (i) {
            return h('li', { class: i.done ? 'done' : '' }, [h('span', { class: 'cp-tcb', html: i.done ? icon('check') : '' }), h('span', { text: i.text })]);
          }));
          var bar = h('div', { class: 'cp-bar' }, [h('i', { style: 'width:' + Math.round(done / x.items.length * 100) + '%' })]);
          var wrap = h('div', { class: 'cp-tdetail', hidden: '' }, [bar, box]);
          box.hidden = false;
          head.onclick = function () { var open = wrap.hidden; wrap.hidden = !open; head.setAttribute('aria-expanded', String(open)); row.classList.toggle('open', open); };
          row.append(wrap);
        }
        rows.append(row);
      });
      card.replaceChildren(
        h('div', { class: 'cp-tasks-head' }, [h('h3', { class: 'cp-h', html: icon('tasks') + '<span>برنامه کارهای پروژه</span>' }), h('small', { text: fa(counts.done) + ' از ' + fa(counts.all) + ' کار انجام شده' + (counts.late ? ' · ' + fa(counts.late) + ' عقب افتاده' : '') }),
          canAddTask() ? h('button', { type: 'button', class: 'btn btn-primary btn-sm cp-sec-add', html: icon('plus') + 'افزودن کار', onclick: addTask }) : null]),
        filters,
        shown.length ? rows : h('p', { class: 'cp-tempty', text: 'کاری در این دسته نیست.' }),
        list.length > shown.length ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm cp-tmore', text: 'نمایش ' + fa(list.length - shown.length) + ' کار دیگر', onclick: function () { taskMore = true; draw(); } }) : null
      );
    }
    draw();
    return card;
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
    pane.replaceChildren(data.files.length ? h('div', { class: 'cp-list2' }, data.files.map(function (f) {
      return h('a', { class: 'cp-row', href: f.file.url, target: '_blank', rel: 'noopener', download: f.file.name }, [
        f.file.image ? h('img', { class: 'cp-row-ico', src: f.file.url, alt: '' }) : h('span', { class: 'cp-row-ico', text: ext(f.file.name) }),
        h('div', { class: 'cp-row-copy' }, [h('strong', { text: f.title }), h('small', { text: jal(f.created_at) + (f.note ? ' · ' + f.note : '') })]),
        h('span', { class: 'btn btn-secondary btn-sm', html: icon('download') + ' دانلود' })]);
    })) : empty('download', 'هنوز فایلی تحویل نشده', null));
  }
  /** Straight to Zibal / ZarinPal: the invoice page starts the payment and brings the client back to it. */
  function payNow(x) {
    var f = h('form', { method: 'post', action: x.url }, [h('input', { type: 'hidden', name: 'mp_pay', value: '1' })]);
    document.body.append(f); f.submit();
  }
  function invoices() {
    var pane = $('pane-invoices');
    pane.replaceChildren(data.invoices.length ? h('div', { class: 'cp-list2' }, data.invoices.map(function (x) {
      return h('a', { class: 'cp-row' + (x.status === 'paid' ? ' paid' : x.kind === 'invoice' && x.status === 'sent' ? ' due' : ''), href: x.url, target: '_blank', rel: 'noopener' }, [
        h('span', { class: 'cp-row-ico', html: icon('file') }),
        h('div', { class: 'cp-row-copy' }, [h('strong', { text: (x.kind === 'proforma' ? 'پیش‌فاکتور ' : 'فاکتور ') + fa(x.number) + (x.title ? ' — ' + x.title : '') }), h('small', { text: jal(x.date) })]),
        h('div', { class: 'cp-row-end' }, [h('b', { text: money(x.total) }), h('span', { class: 'chip ' + (x.status === 'paid' ? 'ok' : x.status === 'cancelled' ? 'danger' : 'brand'), text: x.kind === 'proforma' && x.status === 'sent' ? 'منتظر تأیید' : IST[x.status] || '' }),
          x.pay ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'پرداخت آنلاین', onclick: function (e) { e.preventDefault(); e.stopPropagation(); payNow(x); } }) : null])]);
    })) : empty('file', 'فاکتوری صادر نشده', null));
  }

  function contracts() {
    var pane = $('pane-contracts'), list = data.contracts || [];
    pane.replaceChildren(list.length ? h('div', { class: 'cp-list2' }, list.map(function (x) {
      var signed = x.status === 'signed', waiting = x.status === 'client_signed';
      return h('a', { class: 'cp-row' + (signed ? ' paid' : waiting ? '' : ' due'), href: x.url, target: '_blank', rel: 'noopener' }, [
        h('span', { class: 'cp-row-ico', html: icon('edit') }),
        h('div', { class: 'cp-row-copy' }, [h('strong', { text: 'قرارداد ' + fa(x.number) + (x.title ? ' — ' + x.title : '') }), h('small', { text: signed ? 'امضا شده توسط ' + x.signer + ' · ' + jal(x.signed_at) : 'ارسال شده ' + jal(x.sent_at) })]),
        h('div', { class: 'cp-row-end' }, [signed ? h('span', { class: 'chip ok', text: 'امضاشده ✓' }) : waiting ? h('span', { class: 'chip brand', text: 'منتظر امضای مجری' }) : h('span', { class: 'btn btn-primary btn-sm', text: 'مطالعه و امضا' })])]);
    })) : empty('edit', 'قراردادی ارسال نشده', null));
  }

  function meetings() {
    var pane = $('pane-meetings'), list = (data && data.meetings) || [];
    if (!pane) return;
    pane.replaceChildren(list.length ? h('div', { class: 'cp-list2' }, list.map(function (x) {
      var live = x.status === 'live';
      return h('a', { class: 'cp-row' + (live ? ' live' : ''), href: x.link, target: '_blank', rel: 'noopener' }, [
        h('span', { class: 'cp-row-ico', html: icon('video') }),
        h('div', { class: 'cp-row-copy' }, [h('strong', { text: x.title }), h('small', { text: jal(x.date) + ' · ساعت ' + fa(x.time) + (x.duration ? ' · ' + fa(x.duration) + ' دقیقه' : '') })]),
        h('div', { class: 'cp-row-end' }, [live ? h('span', { class: 'btn btn-primary btn-sm', text: 'ورود؛ جلسه شروع شده' }) : h('span', { class: 'btn btn-secondary btn-sm', text: 'ورود به جلسه' })])]);
    })) : empty('video', 'جلسه‌ای تنظیم نشده', null));
  }

  /* ------------------------------------------------------------ chat (assets/js/client-chat.js) */
  var form = $('client-form');
  function myName() { return me && me.name ? me.name : (form.elements.name.value.trim() || ''); }
  var SYS_ICON = { task: 'tasks', design: 'eye', file: 'download', invoice: 'file', join: 'user', contract: 'edit', meeting: 'video' };
  function sysCard(m) {
    var t = m.meta && m.meta.t, act = null;
    if (t === 'meeting') act = h('button', { type: 'button', class: 'sys-link', text: 'جلسات', onclick: function () { go('meetings'); } });
    else if (t === 'contract' && m.meta.url) act = h('a', { class: 'sys-link', href: m.meta.url, target: '_blank', rel: 'noopener', text: /امضا شد/.test(m.body) ? 'دیدن قرارداد' : 'مطالعه و امضا' });
    else if (t === 'invoice' && m.meta.url) act = h('a', { class: 'sys-link', href: m.meta.url, target: '_blank', rel: 'noopener', text: (/صادر شد/.test(m.body) ? 'مشاهده و پرداخت ' : 'مشاهده ') + (m.meta.k === 'proforma' || /^پیش‌فاکتور/.test(m.body) ? 'پیش‌فاکتور' : 'فاکتور') });
    else if ((t === 'design' || t === 'file') && data && data.project) act = h('button', { type: 'button', class: 'sys-link', text: t === 'design' ? 'دیدن طرح' : 'دانلود فایل', onclick: function () {
      var d = t === 'design' && data.designs.filter(function (x) { return x.id === m.meta.id; })[0];
      go(t === 'design' ? 'designs' : 'files'); if (d) review(d);
    } });
    return h('div', { class: 'sys-msg' }, [h('span', { class: 'sys-ico', html: icon(SYS_ICON[t] || 'bell') }), h('p', { text: m.body }), act, h('time', { text: hm(m.created_at) })]);
  }
  var chat = window.MPClientChat({
    base: base, h: h, icon: icon, fa: fa, jal: jal, today: today, toast: toast, sysCard: sysCard,
    myName: myName, isLogged: function () { return !!(me && me.logged_in); }, preview: function () { return false; },
    team: function () { return (me && me.team) || 'تیم مربع'; },
    empty: function () { return empty('chat', 'اولین پیام را بفرستید', 'تیم مربع همین‌جا پاسخ می‌دهد؛ عکس، ویس و هر نوع فایلی هم می‌توانید بفرستید.'); },
    onStale: function () { refresh(); },
    typing: function (list) {
      var sub = $('cp-chat-sub');
      if (!sub.dataset.base) sub.dataset.base = sub.textContent;
      var t = list[0];
      sub.textContent = t ? (t.name ? t.name.split(' ')[0] + ' ' : '') + (t.state === 'recording' ? 'در حال ضبط صدا…' : t.state === 'uploading' ? 'در حال فرستادن فایل…' : 'در حال نوشتن…') : sub.dataset.base;
      sub.classList.toggle('cp-typing', !!t);
    }
  });
  function loadChat(scroll) { return chat.load(scroll); }
  $('cp-chat-back').onclick = function () { go(prevTab === 'chat' ? 'progress' : prevTab); };

  function refresh() {
    return api('/portal').then(function (d) { data = d; if (d.project) { progress(); if (!reviewing) designs(); files(); invoices(); contracts(); } meetings(); tabs(); }).catch(function () {});
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
      logoInto($('cp-chat-client'), m.logo, m.client || m.title);
      $('cp-chat-sub').textContent = m.pv ? 'پشتیبانی · گفت‌وگوی خصوصی شما با تیم' : m.title + ' · پاسخ همین‌جا می‌آید'; $('cp-chat-sub').dataset.base = $('cp-chat-sub').textContent;
      var hr = new Date().getHours(), first = m.logged_in ? String(m.name).split(' ')[0] : '';
      $('cp-hello').textContent = (hr < 12 ? 'صبح بخیر' : hr < 17 ? 'روز بخیر' : 'عصر بخیر') + (first ? '، ' + first : '');
      $('cp-hello-sub').textContent = (m.client || '') + (m.client && m.title ? ' · ' : '') + m.title;
      var tj = j(today()); $('cp-today').textContent = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'][new Date().getDay()] + ' ' + fa(tj[2]) + ' ' + MONTHS[tj[1] - 1] + ' ' + fa(tj[0]);
      // Staff seeing the portal as this client: a banner, and nothing can be sent.
      if (m.preview) {
        $('cp-preview').hidden = false; document.body.classList.add('cp-previewing');
        $('cp-preview-who').textContent = 'از طرف مشتری: ' + (m.name || 'مشتری');
        $('cp-preview-end').onclick = function () { logout(); };
      }
      if (m.logged_in) { $('cp-logout').hidden = false; $('cp-me-avatar').hidden = false; $('cp-me-avatar').textContent = initials(m.name); $('cp-client-logo-m').hidden = true; }
      else { form.elements.name.hidden = false; try { form.elements.name.value = localStorage.getItem('mp-client-name') || ''; } catch (e) { /* private */ } }
      var sk = $('pane-progress'); sk.hidden = false;
      sk.replaceChildren(h('div', { class: 'cp-sk hero' }), h('div', { class: 'cp-sk act' }), h('div', { class: 'cp-sk-row' }, [h('div', { class: 'cp-sk tile' }), h('div', { class: 'cp-sk tile' }), h('div', { class: 'cp-sk tile' }), h('div', { class: 'cp-sk tile' })]), h('div', { class: 'cp-sk card' }));
      return api('/portal').then(function (d) {
        data = d;
        var want = (location.hash || '').slice(1);
        meetings();
        if (!d.project) tab = want === 'meetings' && (d.meetings || []).length ? 'meetings' : 'chat';
        else {
          progress(); designs(); files(); invoices(); contracts();
          tab = TABS.some(function (t) { return t[0] === want; }) ? want : 'progress'; // the home lists anything waiting (designs, invoices…)
        }
        go(tab);
        clearInterval(chatTimer);
        chatTimer = setInterval(function () { if (!document.hidden) loadChat(false); }, 4000);
        chat.start();
      });
    }).catch(function (e) {
      document.body.replaceChildren(h('main', { class: 'cp-login' }, [h('div', { class: 'cp-login-card' }, [h('img', { src: document.querySelector('.cp-studio-logo') ? document.querySelector('.cp-studio-logo').src : '', class: 'cp-studio-logo', alt: '' }), h('h1', { text: 'این لینک در دسترس نیست' }), h('p', { text: e.message || 'لینک را دوباره از تیم مربع بگیرید.' })])]));
    });
  }
  start();
})();
