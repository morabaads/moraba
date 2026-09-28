/* Moraba panel — core: helpers, API, state, dialogs, toasts, pickers, navigation, popovers, account.
   Feature modules (tasks.js, dashboard.js, …) register views on window.MP; app.js boots. */
(function () {
  'use strict';

  var C = window.MP_CONFIG, J = window.Jalali;
  var MP = window.MP = { C: C, J: J };

  /* ------------------------------------------------------------ DOM helpers */

  var $ = MP.$ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = MP.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /** el('div', {class, text, html(trusted only), onclick, dataset, attr…}, ...children) */
  var el = MP.el = function (tag, props) {
    var node = document.createElement(tag), i, child;
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'class') node.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else if (k === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) node.value = v;
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    for (i = 2; i < arguments.length; i++) {
      child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c !== null && c !== undefined && c !== false) node.append(c); });
      else node.append(child);
    }
    return node;
  };
  var icon = MP.icon = function (name) { return '<svg class="icon" aria-hidden="true"><use href="#' + name + '"></use></svg>'; };
  MP.iconEl = function (name) { var s = document.createElement('span'); s.innerHTML = icon(name); return s.firstChild; };

  var fa = MP.fa = J.fa;
  MP.faDigits = J.faDigits;
  MP.money = function (n) { return (n < 0 ? '−' : '') + Math.abs(Number(n) || 0).toLocaleString('fa-IR'); };
  MP.timeFa = function (t) { return t ? J.faDigits(t) : ''; };
  MP.duration = function (sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
    return h ? fa(h) + ' ساعت' + (m ? ' و ' + fa(m) + ' دقیقه' : '') : fa(m) + ' دقیقه';
  };
  MP.clock = function (sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return J.faDigits((h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s);
  };
  MP.relTime = function (mysql) {
    if (!mysql) return '';
    var d = mysql.slice(0, 10), t = mysql.slice(11, 16);
    if (d === S.today) return 'امروز، ' + MP.timeFa(t);
    if (d === J.addDays(S.today, -1)) return 'دیروز، ' + MP.timeFa(t);
    return J.format(d, d.slice(0, 4) !== S.today.slice(0, 4)) + '، ' + MP.timeFa(t);
  };
  MP.norm = function (text) {
    return String(text || '').normalize('NFKC').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[‌‎‏]/g, ' ')
      .replace(/[ًٌٍَُِّْ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  };
  MP.fileSize = function (b) { return b > 1048576 ? fa((b / 1048576).toFixed(1)) + ' مگابایت' : fa(Math.max(1, Math.round(b / 1024))) + ' کیلوبایت'; };

  MP.PRIORITY = { high: 'زیاد', medium: 'متوسط', low: 'کم' };
  MP.STATUS = { todo: 'انجام نشده', doing: 'در حال انجام', done: 'انجام شده', waiting: 'در انتظار' };
  MP.RECUR = { none: 'بدون تکرار', daily: 'هر روز', weekdays: 'روزهای کاری (بدون جمعه)', weekly: 'هر هفته', monthly: 'هر ماه' };

  /* ------------------------------------------------------------ API */

  function errorFrom(res, data) {
    var err = new Error(data && data.message ? data.message : 'ارتباط با سرور برقرار نشد.');
    err.code = data && data.code; err.status = res.status;
    if (res.status === 401 || (data && data.code === 'rest_cookie_invalid_nonce')) err.message = 'نشست شما منقضی شده است؛ صفحه را دوباره باز کنید.';
    return err;
  }
  MP.api = function (path, opts) {
    opts = opts || {};
    var url = C.root + path;
    if (opts.query) {
      var q = Object.keys(opts.query).filter(function (k) { var v = opts.query[k]; return v !== undefined && v !== null && v !== ''; })
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(opts.query[k]); }).join('&');
      if (q) url += (url.indexOf('?') >= 0 ? '&' : '?') + q;
    }
    return fetch(url, {
      method: opts.method || 'GET', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': C.nonce },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { if (!res.ok) throw errorFrom(res, data); return data; });
    }, function () { throw new Error('اتصال اینترنت برقرار نیست.'); });
  };
  /** Multipart upload with progress: MP.upload('files', file, {context, context_id}, onProgress) */
  MP.upload = function (path, file, fields, onProgress) {
    return new Promise(function (resolve, reject) {
      if (file.size > 10485760) { reject(new Error('حجم فایل باید کمتر از ۱۰ مگابایت باشد.')); return; }
      var fd = new FormData(); fd.append('file', file);
      Object.keys(fields || {}).forEach(function (k) { fd.append(k, fields[k]); });
      var xhr = new XMLHttpRequest();
      xhr.open('POST', C.root + path);
      xhr.setRequestHeader('X-WP-Nonce', C.nonce);
      xhr.withCredentials = true;
      if (onProgress) xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = function () {
        var data = {}; try { data = JSON.parse(xhr.responseText); } catch (e) { /* not json */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(errorFrom({ status: xhr.status }, data));
      };
      xhr.onerror = function () { reject(new Error('بارگذاری فایل انجام نشد.')); };
      xhr.send(fd);
    });
  };
  MP.fail = function (err) { MP.toast(err && err.message ? err.message : 'خطایی رخ داد.', { error: true }); throw err; };
  MP.soft = function (err) { MP.toast(err && err.message ? err.message : 'خطایی رخ داد.', { error: true }); };

  /* ------------------------------------------------------------ State & events */

  var S = MP.S = {
    boot: null, me: null, today: '', now: '', users: [], userMap: {}, manager: false,
    tasks: [], projects: [], folders: [], channels: [], notifications: [], reminders: [], meetingsToday: [], attendance: null, leaves: [],
    view: '', projectId: 0
  };
  var listeners = {};
  MP.on = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
  MP.emit = function (ev, data) { (listeners[ev] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); };

  MP.user = function (id) { return S.userMap[id] || { id: id, name: 'کاربر حذف‌شده', title: '', avatar: '', status: 'busy' }; };
  MP.project = function (id) { return S.projects.filter(function (p) { return p.id === id; })[0] || null; };
  MP.section = function (id) { var f = null; S.projects.forEach(function (p) { p.sections.forEach(function (s) { if (s.id === id) f = s; }); }); return f; };
  MP.taskById = function (id) { return S.tasks.filter(function (t) { return t.id === id; })[0] || null; };
  MP.myTasks = function () { return S.tasks.filter(function (t) { return t.user_id === S.me.id; }); };
  MP.loadTasks = function () { return MP.api('tasks').then(function (l) { S.tasks = l; MP.emit('tasks'); }); };
  MP.applyProjects = function (data) {
    S.projects = data.projects || []; S.folders = data.folders || [];
    if (!MP.project(S.projectId)) S.projectId = S.projects.length ? S.projects[0].id : 0;
    MP.emit('projects');
  };
  MP.loadProjects = function () { return MP.api('projects').then(MP.applyProjects); };
  MP.upsertTask = function (t, silent) {
    var i = S.tasks.findIndex(function (x) { return x.id === t.id; });
    if (t.user_id !== S.me.id) { if (i >= 0) S.tasks.splice(i, 1); }
    else if (i >= 0) S.tasks[i] = t; else S.tasks.push(t);
    if (!silent) MP.emit('tasks', t);
  };
  MP.inRange = function (date, range) {
    if (range === 'all') return true;
    if (range === 'today') return date === S.today;
    if (range === 'overdue') return date < S.today;
    if (range === 'week') { var ws = J.weekStart(S.today); return date >= ws && date <= J.addDays(ws, 6); }
    if (range === 'month') { var a = J.fromIso(S.today), b = J.fromIso(date); return a.jy === b.jy && a.jm === b.jm; }
    return true;
  };

  /* ------------------------------------------------------------ Toasts (with undo) */

  var toastBox = $('#toasts');
  MP.toast = function (message, opts) {
    opts = opts || {};
    var t = el('div', { class: 'toast' + (opts.error ? ' error' : '') }, opts.icon ? el('span', { class: 'toast-ico', html: icon(opts.icon) }) : null, el('span', { text: message }));
    var timer, closed = false;
    function close() { if (closed) return; closed = true; clearTimeout(timer); t.classList.add('leaving'); setTimeout(function () { t.remove(); }, 250); }
    if (opts.action) t.append(el('button', { type: 'button', text: opts.action, onclick: function () { close(); opts.onAction(); } }));
    toastBox.append(t);
    while (toastBox.children.length > 3) toastBox.firstChild.remove();
    timer = setTimeout(function () { close(); if (opts.onExpire) opts.onExpire(); }, opts.duration || (opts.action ? 5500 : 3200));
    return close;
  };
  /**
   * Optimistic removal with "undo": apply() runs now, commit() after the toast expires,
   * revert() if the user presses بازگردانی or commit fails.
   */
  MP.undoable = function (message, apply, revert, commit) {
    apply();
    var undone = false;
    MP.toast(message, {
      action: 'بازگردانی',
      onAction: function () { undone = true; revert(); },
      onExpire: function () { if (!undone) Promise.resolve().then(commit).catch(function (err) { revert(); MP.soft(err); }); }
    });
    window.addEventListener('beforeunload', function flush() { if (!undone) { undone = true; commit(); } }, { once: true });
  };

  /* ------------------------------------------------------------ Dialog */

  var dialog = $('#dialog'), restoreFocus = null, onClose = null, closeTimer = null, root = document.documentElement, dialogLayer = null;
  MP.isMobile = function () { return window.matchMedia('(max-width: 760px)').matches; };
  MP.haptic = function (pattern) { try { if (navigator.vibrate && !root.classList.contains('reduced-motion')) navigator.vibrate(pattern || 10); } catch (e) { /* unsupported */ } };
  function finishClose() {
    clearTimeout(closeTimer); closeTimer = null;
    dialog.classList.remove('closing'); dialog.style.transform = ''; dialog.style.transition = '';
    if (dialog.open) dialog.close();
    root.classList.remove('dialog-open');
    if (dialogLayer) { var layer = dialogLayer; dialogLayer = null; MP.popLayer(layer); }
    var cb = onClose; onClose = null; if (cb) cb();
    if (restoreFocus && restoreFocus.isConnected && restoreFocus.focus) restoreFocus.focus({ preventScroll: true });
  }
  MP.dialog = {
    open: function (title, content, opts) {
      opts = opts || {};
      if (closeTimer) finishClose();
      if (!dialog.open) restoreFocus = document.activeElement;
      else if (onClose) { var prev = onClose; onClose = null; prev(); }
      $('#dialog-title').textContent = title;
      var body = $('#dialog-body'); body.replaceChildren();
      if (typeof content === 'string') body.innerHTML = content; else body.append(content);
      dialog.classList.toggle('wide', !!opts.wide);
      onClose = opts.onClose || null;
      if (!dialog.open) {
        dialog.showModal(); root.classList.add('dialog-open');
        dialogLayer = MP.pushLayer(function () { dialogLayer = null; MP.dialog.close(); });
      }
      body.scrollTop = 0;
      // On phones only focus explicit [autofocus] fields so the keyboard doesn't cover the sheet.
      var first = opts.focus === false ? null : $(MP.isMobile() ? '[autofocus]' : '[autofocus],input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]),textarea,select', body);
      if (first) setTimeout(function () { first.focus(); }, 60);
      return body;
    },
    close: function () {
      if (!dialog.open || closeTimer) return;
      if (root.classList.contains('reduced-motion')) { finishClose(); return; }
      // Release the history entry now, so a navigation right after close isn't undone by a late back().
      if (dialogLayer) { var layer = dialogLayer; dialogLayer = null; MP.popLayer(layer); }
      dialog.classList.add('closing');
      closeTimer = setTimeout(finishClose, 190);
    },
    isOpen: function () { return dialog.open && !closeTimer; }
  };
  $('.dialog-close').onclick = MP.dialog.close;
  dialog.addEventListener('cancel', function (e) { e.preventDefault(); MP.dialog.close(); });
  dialog.addEventListener('click', function (e) {
    if (e.target !== dialog) return;
    var r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) MP.dialog.close();
  });
  // Drag the sheet's handle or header down to dismiss it (phones).
  (function () {
    var start = null;
    dialog.addEventListener('pointerdown', function (e) {
      if (!MP.isMobile() || e.pointerType === 'mouse' || !e.target.closest('.dialog-head,.sheet-handle') || e.target.closest('button')) return;
      start = { y: e.clientY, t: Date.now(), id: e.pointerId };
      dialog.setPointerCapture(e.pointerId);
      dialog.style.transition = 'none';
    });
    dialog.addEventListener('pointermove', function (e) {
      if (!start || e.pointerId !== start.id) return;
      var dy = e.clientY - start.y;
      dialog.style.transform = 'translateY(' + (dy > 0 ? dy : dy / 6) + 'px)';
    });
    function end(e) {
      if (!start || e.pointerId !== start.id) return;
      var dy = e.clientY - start.y, v = dy / Math.max(1, Date.now() - start.t);
      start = null;
      dialog.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)';
      if (dy > 110 || (dy > 30 && v > 0.55)) {
        dialog.style.transform = 'translateY(105%)'; MP.haptic(8);
        clearTimeout(closeTimer); closeTimer = setTimeout(finishClose, 210);
      } else dialog.style.transform = '';
    }
    dialog.addEventListener('pointerup', end);
    dialog.addEventListener('pointercancel', end);
  })();
  MP.confirm = function (title, message, okText, danger) {
    return new Promise(function (resolve) {
      var done = false;
      MP.dialog.open(title, el('div', null,
        el('p', { text: message, style: { marginBottom: '18px' } }),
        el('div', { class: 'dialog-actions' },
          el('button', { class: 'btn ' + (danger === false ? 'btn-primary' : 'btn-danger'), type: 'button', text: okText || 'تأیید', autofocus: true, onclick: function () { done = true; MP.dialog.close(); resolve(true); } }),
          el('button', { class: 'btn btn-ghost', type: 'button', text: 'انصراف', onclick: MP.dialog.close }))), { onClose: function () { if (!done) resolve(false); } });
    });
  };
  MP.field = function (label, input, hint) { return el('label', { class: 'field' }, label, input, hint ? el('small', { text: hint }) : null); };
  MP.actions = function (submitText, extra) {
    return el('div', { class: 'dialog-actions' },
      el('button', { type: 'submit', class: 'btn btn-primary', text: submitText }),
      el('button', { type: 'button', class: 'btn btn-ghost', text: 'انصراف', onclick: MP.dialog.close }),
      extra ? el('span', { class: 'spacer' }) : null, extra || null);
  };
  MP.busy = function (form, on) {
    $$('button,input,select,textarea', form).forEach(function (x) { x.disabled = on; });
    var submit = $('[type=submit]', form);
    if (submit) { if (on) { submit.dataset.label = submit.textContent; submit.textContent = 'در حال ذخیره…'; } else if (submit.dataset.label) submit.textContent = submit.dataset.label; }
  };
  MP.detailRow = function (label, value) { return el('div', { class: 'detail-row' }, el('span', { text: label }), el('strong', { text: value })); };
  MP.empty = function (iconName, title, text, action, small) {
    return el('div', { class: 'empty' + (small ? ' sm' : '') },
      el('div', { class: 'empty-art', html: icon(iconName) }), el('strong', { text: title }), text ? el('p', { text: text }) : null,
      action ? el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: action.text, onclick: action.onclick }) : null);
  };
  MP.skeleton = function (rows) { var w = el('div'); for (var i = 0; i < (rows || 4); i++) w.append(el('span', { class: 'sk sk-row' })); return w; };

  /* ------------------------------------------------------------ Avatars */

  var PALETTE = ['#f28a24', '#6b4bd8', '#1f9d55', '#2f6fed', '#d64545', '#0f8b8d', '#b1569a', '#8a6d3b'];
  MP.initials = function (u, size) {
    var name = String(u && u.name || '؟').trim(), text = name.split(/\s+/).slice(0, 2).map(function (v) { return v[0]; }).join('');
    var hash = 0; for (var i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return el('span', { class: 'initials' + (size ? ' ' + size : ''), text: text, title: name, style: { background: PALETTE[hash % PALETTE.length] }, 'aria-hidden': 'true' });
  };
  MP.avatar = function (u, size) {
    if (!u || !u.avatar) return MP.initials(u, size);
    var img = el('img', { class: 'avatar' + (size ? ' ' + size : ''), src: u.avatar, alt: u.name, loading: 'lazy' });
    img.addEventListener('error', function () { img.replaceWith(MP.initials(u, size)); });
    return img;
  };

  /* ------------------------------------------------------------ Jalali date picker */

  MP.datePicker = function (input, trigger, onChange) {
    var box = el('div', { class: 'picker', hidden: true, role: 'dialog', 'aria-label': 'انتخاب تاریخ شمسی' }), view;
    trigger.after(box);
    function label() { $('span', trigger).textContent = input.value ? J.formatLong(input.value) : 'انتخاب تاریخ'; }
    input.mpLabel = label;
    function step(n) { view.jm += n; if (view.jm < 1) { view.jm = 12; view.jy--; } if (view.jm > 12) { view.jm = 1; view.jy++; } render(); }
    function render() {
      box.replaceChildren();
      box.append(el('div', { class: 'picker-head' },
        el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'ماه قبل', html: icon('right'), onclick: function () { step(-1); } }),
        el('span', { text: J.months[view.jm - 1] + ' ' + fa(view.jy) }),
        el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'ماه بعد', html: icon('left'), onclick: function () { step(1); } })));
      box.append(el('div', { class: 'picker-week' }, J.weekdays.map(function (w) { return el('span', { text: w.slice(0, 1) }); })));
      var days = el('div', { class: 'picker-days' }), first = J.toIso(view.jy, view.jm, 1), i;
      for (i = 0; i < J.weekday(first); i++) days.append(el('span'));
      for (i = 1; i <= J.monthLength(view.jy, view.jm); i++) {
        (function (d) {
          var iso = J.toIso(view.jy, view.jm, d);
          days.append(el('button', {
            type: 'button', text: fa(d), 'aria-label': J.formatLong(iso), 'aria-pressed': String(iso === input.value),
            class: [iso === input.value ? 'chosen' : '', iso === S.today ? 'today' : '', J.weekday(iso) === 6 ? 'fri' : ''].join(' '),
            onclick: function () { input.value = iso; label(); close(); if (onChange) onChange(iso); input.dispatchEvent(new Event('change')); }
          }));
        })(i);
      }
      box.append(days);
    }
    function close() { box.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
    trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', function () {
      if (!box.hidden) { close(); return; }
      var j = J.fromIso(input.value || S.today); view = { jy: j.jy, jm: j.jm }; render();
      box.hidden = false; trigger.setAttribute('aria-expanded', 'true');
      var c = $('.chosen', box) || $('.today', box); if (c) c.focus();
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); trigger.focus(); }
      var map = { ArrowLeft: 1, ArrowRight: -1, ArrowUp: -7, ArrowDown: 7 }, btns = $$('.picker-days button', box), i = btns.indexOf(document.activeElement);
      if (e.key in map && i >= 0) { e.preventDefault(); var n = btns[i + map[e.key]]; if (n) n.focus(); }
    });
    label();
    return { refresh: label, close: close };
  };
  /* ------------------------------------------------------------ Time picker (replaces every <input type=time>) */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function period(h) { return h < 5 ? 'بامداد' : h < 12 ? 'صبح' : h < 14 ? 'ظهر' : h < 18 ? 'بعدازظهر' : h < 21 ? 'عصر' : 'شب'; }
  MP.timeLabel = function (v) { if (!v) return ''; var h = +v.slice(0, 2); return MP.faDigits(v.slice(0, 5)) + ' ' + period(h); };
  /**
   * Turns a time input into a button + popup: 24 hours (grouped morning/afternoon/evening), minutes in
   * 5-minute steps, quick picks and a clear button. The input stays in the form (type=hidden) so every
   * form keeps reading .value, and code that sets .value + fires 'change' updates the label.
   */
  MP.enhanceTime = function (input) {
    if (input.dataset.tp) return;
    input.dataset.tp = '1';
    var optional = !input.required, placeholder = input.getAttribute('aria-label') ? 'انتخاب ساعت' : 'انتخاب ساعت';
    input.type = 'hidden';
    var label = el('span', { class: 'tp-label' });
    var trigger = el('button', { type: 'button', class: 'date-trigger time-trigger' }, label, MP.iconEl('clock'));
    input.before(trigger);
    function paint() { label.textContent = input.value ? MP.timeLabel(input.value) : placeholder; trigger.classList.toggle('tp-empty', !input.value); }
    input.addEventListener('change', paint); input.addEventListener('input', paint); paint();
    var box = null, layer = null;
    function set(v, keep) { input.value = v; paint(); input.dispatchEvent(new Event('change', { bubbles: true })); if (!keep) close(); else draw(); }
    function close() {
      if (!box) return;
      box.classList.add('closing'); var b = box; box = null; setTimeout(function () { b.remove(); }, 160);
      document.removeEventListener('pointerdown', outside, true); document.body.classList.remove('tp-open');
      if (layer) { var l = layer; layer = null; MP.popLayer(l); }
    }
    function outside(e) { if (box && !box.contains(e.target) && !trigger.contains(e.target)) close(); }
    var hSel = null, mSel = null;
    function draw() {
      var cur = input.value || '', h = hSel !== null ? hSel : (cur ? +cur.slice(0, 2) : null), m = mSel !== null ? mSel : (cur ? +cur.slice(3, 5) : null);
      var head = el('div', { class: 'tp-head' },
        el('div', { class: 'tp-big', dir: 'ltr' },
          el('span', { class: 'tp-h' + (h === null ? ' dim' : ''), text: h === null ? '--' : MP.faDigits(pad2(h)) }), el('i', { text: ':' }),
          el('span', { class: 'tp-m' + (m === null ? ' dim' : ''), text: m === null ? '--' : MP.faDigits(pad2(m)) })),
        el('small', { text: h === null ? 'اول ساعت را انتخاب کنید' : period(h) }));
      var hours = el('div', { class: 'tp-hours' });
      [['صبح', 6, 11], ['ظهر و بعدازظهر', 12, 17], ['عصر و شب', 18, 23], ['بامداد', 0, 5]].forEach(function (g) {
        var row = el('div', { class: 'tp-group' }, el('span', { class: 'tp-gl', text: g[0] }));
        var cells = el('div', { class: 'tp-cells' });
        for (var x = g[1]; x <= g[2]; x++) (function (x) {
          cells.append(el('button', { type: 'button', class: 'tp-cell' + (x === h ? ' on' : ''), text: MP.faDigits(x), onclick: function () { hSel = x; if (mSel === null) mSel = m === null ? 0 : m; draw(); } }));
        })(x);
        row.append(cells); hours.append(row);
      });
      var mins = el('div', { class: 'tp-mins' });
      for (var k = 0; k < 60; k += 5) (function (k) {
        mins.append(el('button', { type: 'button', class: 'tp-cell' + (k === m ? ' on' : ''), text: MP.faDigits(pad2(k)), disabled: h === null, onclick: function () { mSel = k; set(pad2(h) + ':' + pad2(k)); } }));
      })(k);
      var now = new Date(), nowV = pad2(now.getHours()) + ':' + pad2(Math.round(now.getMinutes() / 5) * 5 % 60);
      var quick = el('div', { class: 'tp-quick' }, [['اکنون', nowV], ['۹ صبح', '09:00'], ['۱۲ ظهر', '12:00'], ['۱۵', '15:00'], ['۱۸ عصر', '18:00']].map(function (q) {
        return el('button', { type: 'button', class: 'chip-btn', text: q[0], onclick: function () { hSel = null; mSel = null; set(q[1]); } });
      }));
      var foot = el('div', { class: 'tp-foot' },
        optional ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'بدون ساعت', onclick: function () { hSel = null; mSel = null; set(''); } }) : el('span'),
        el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'تأیید', disabled: h === null, onclick: function () { set(pad2(h) + ':' + pad2(m || 0)); } }));
      box.replaceChildren(el('div', { class: 'tp-grab' }), head, quick, el('div', { class: 'tp-sec', text: 'ساعت' }), hours, el('div', { class: 'tp-sec', text: 'دقیقه' }), mins, foot);
    }
    trigger.onclick = function () {
      if (box) { close(); return; }
      hSel = null; mSel = null;
      box = el('div', { class: 'time-picker', role: 'dialog', 'aria-label': 'انتخاب ساعت' });
      // Fields are <label>s: without this, any click inside would be forwarded to the trigger and close the picker.
      box.addEventListener('click', function (e) { e.preventDefault(); });
      if (MP.isMobile()) { (trigger.closest('dialog') || document.body).append(box); box.classList.add('as-sheet'); document.body.classList.add('tp-open'); layer = MP.pushLayer(function () { layer = null; close(); }); }
      else { trigger.after(box); }
      draw();
      setTimeout(function () { document.addEventListener('pointerdown', outside, true); });
    };
  };
  // Enhance time inputs as soon as any form renders them.
  function enhanceAll(root) { (root.querySelectorAll ? root : document).querySelectorAll('input[type=time]').forEach(MP.enhanceTime); }
  new MutationObserver(function (list) { list.forEach(function (r) { r.addedNodes.forEach(function (n) { if (n.nodeType === 1) { if (n.matches && n.matches('input[type=time]')) MP.enhanceTime(n); else enhanceAll(n); } }); }); })
    .observe(document.body, { childList: true, subtree: true });
  enhanceAll(document);

  /** Set a date field from code (smart input) and refresh its visible label. */
  MP.setDate = function (input, iso) {
    input.value = iso; if (input.mpLabel) input.mpLabel();
    input.dispatchEvent(new Event('change'));
    var w = input.closest('.field'); if (w) { w.classList.remove('filled'); void w.offsetWidth; w.classList.add('filled'); }
  };
  MP.dateField = function (name, value, labelText, onChange) {
    var input = el('input', { type: 'hidden', name: name, value: value || S.today });
    var trigger = el('button', { type: 'button', class: 'date-trigger' }, el('span'), MP.iconEl('calendar'));
    var wrap = el('div', { class: 'field' }, el('span', { text: labelText || 'تاریخ' }), trigger, input);
    MP.datePicker(input, trigger, onChange);
    return wrap;
  };

  /* ------------------------------------------------------------ Selects & pickers */

  MP.select = function (name, options, selected) {
    var s = el('select', { name: name });
    options.forEach(function (o) { s.append(el('option', { value: o[0], text: o[1], selected: String(o[0]) === String(selected) })); });
    return s;
  };
  MP.userSelect = function (name, selected, opts) {
    opts = opts || {};
    var list = S.users.filter(function (u) { return opts.includeMe !== false || u.id !== S.me.id; });
    return MP.select(name, (opts.any ? [['', opts.any]] : []).concat(list.map(function (u) { return [u.id, u.name + (u.id === S.me.id ? ' (خودم)' : '') + (u.title ? ' — ' + u.title : '')]; })), selected);
  };
  MP.projectSelect = function (name, selected, none) {
    return MP.select(name, [[0, none || 'بدون پروژه']].concat(S.projects.map(function (p) { return [p.id, p.name]; })), selected);
  };
  MP.sectionSelect = function (name, projectId, selected) {
    var s = el('select', { name: name });
    s.fill = function (pid) {
      s.replaceChildren(el('option', { value: 0, text: 'بدون بخش' }));
      var p = MP.project(+pid);
      if (p) p.sections.forEach(function (x) { s.append(el('option', { value: x.id, text: x.title, selected: x.id === selected })); });
    };
    s.fill(projectId);
    return s;
  };
  /** `already`: people shown ticked and disabled (e.g. current project members), so the list is complete. */
  MP.peoplePicker = function (name, selected, exclude, already) {
    var box = el('div', { class: 'people-picker' });
    S.users.forEach(function (u) {
      if (exclude && exclude.indexOf(u.id) >= 0) return;
      if (already && already.indexOf(u.id) >= 0) {
        box.append(el('label', { class: 'person-opt is-member' }, el('input', { type: 'checkbox', checked: true, disabled: true }),
          MP.avatar(u, 'sm'), el('span', { text: u.name + ' · عضو است' })));
        return;
      }
      box.append(el('label', { class: 'person-opt' },
        el('input', { type: 'checkbox', name: name, value: u.id, checked: !!(selected && selected.indexOf(u.id) >= 0) }),
        MP.avatar(u, 'sm'), el('span', { text: u.name + (u.id === S.me.id ? ' (خودم)' : '') })));
    });
    if (!$('input:not(:disabled)', box)) box.append(el('p', { class: 'hint', text: $('input', box) ? 'همه همکاران پنل عضو هستند. برای افراد جدید، از پیشخوان ← پنل مربع کارمند اضافه کنید.' : S.manager
      ? 'همکار دیگری در پنل نیست. فقط کاربرانی اینجا می‌آیند که دسترسی «کارمند» یا «ناظر» پنل داشته باشند؛ از پیشخوان وردپرس ← پنل مربع، دسترسی همکاران را تعیین کنید یا کارمند جدید اضافه کنید.'
      : 'همکار دیگری برای انتخاب وجود ندارد.' }));
    return box;
  };
  MP.checked = function (form, name) { return $$('input[name="' + name + '"]:checked', form).map(function (x) { return +x.value; }); };

  /** A file drop/select area; calls onFile(File). */
  MP.dropzone = function (label, onFile, accept) {
    var input = el('input', { type: 'file', class: 'visually-hidden', accept: accept || '' });
    var zone = el('label', { class: 'dropzone' }, MP.iconEl('clip'), el('span', { text: label }), input);
    input.onchange = function () { if (input.files[0]) onFile(input.files[0]); input.value = ''; };
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('over'); });
    zone.addEventListener('drop', function (e) { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });
    return zone;
  };
  MP.fileChip = function (f) {
    return el('a', { class: 'file-chip', href: f.url, target: '_blank', rel: 'noopener' }, MP.iconEl(f.image ? 'eye' : 'file'), el('span', { text: f.name }), el('small', { class: 'muted', text: MP.fileSize(f.size) }));
  };
  MP.lightbox = function (f) {
    MP.dialog.open(f.name, el('div', { style: { textAlign: 'center' } },
      el('img', { src: f.url, alt: f.name, style: { maxWidth: '100%', maxHeight: '70vh', borderRadius: '14px' } }),
      el('div', { class: 'dialog-actions', style: { justifyContent: 'center' } }, el('a', { class: 'btn btn-secondary', href: f.url + '&download=1', text: 'دانلود' }))), { wide: true, focus: false });
  };

  /* ------------------------------------------------------------ History layers (phone back button closes sheets, chats, search) */

  var layers = [], ignorePop = 0, afterPop = [];
  /** History writes must wait until a layer's history.back() has landed, or the back would undo them. */
  function whenSettled(fn) { if (ignorePop) afterPop.push(fn); else fn(); }
  MP.pushLayer = function (close) {
    if (!MP.isMobile()) return null;
    layers.push(close);
    whenSettled(function () { try { history.pushState({ view: S.view, layer: layers.length }, '', '#' + S.view); } catch (e) { /* ignore */ } });
    return close;
  };
  MP.popLayer = function (close) {
    var i = layers.lastIndexOf(close);
    if (!close || i < 0) return;
    layers.splice(i, 1);
    ignorePop++;
    history.back();
  };
  window.addEventListener('popstate', function (e) {
    if (ignorePop) { ignorePop--; if (!ignorePop) afterPop.splice(0).forEach(function (fn) { fn(); }); return; }
    if (layers.length) { layers.pop()(true); return; }
    var v = (e.state && e.state.view) || location.hash.slice(1) || 'dashboard';
    if (v !== S.view) MP.showView(v, { fromHistory: true });
  });
  window.addEventListener('scroll', function () { document.body.classList.toggle('scrolled', window.scrollY > 4); }, { passive: true });
  if (window.visualViewport) {
    var vv = function () {
      var h = window.visualViewport.height;
      root.style.setProperty('--vvh', h + 'px');
      document.body.classList.toggle('keyboard', window.innerHeight - h > 140);
    };
    window.visualViewport.addEventListener('resize', vv); vv();
  }

  /* ------------------------------------------------------------ Navigation */

  var views = {}, app = $('.app');
  var ORDER = ['dashboard', 'calendar', 'mytasks', 'projects', 'messages', 'attendance', 'reminders', 'accounting', 'reports'];
  MP.view = function (name, def) { views[name] = def; };
  MP.showView = function (name, opts) {
    if (!views[name]) name = 'dashboard';
    closePopover(); closeSearch();
    var changed = S.view !== name, from = ORDER.indexOf(S.view);
    S.view = name;
    document.body.dataset.page = name;
    $$('.view').forEach(function (v) {
      v.hidden = v.dataset.view !== name;
      if (!v.hidden && changed && from >= 0) {
        v.dataset.enter = ORDER.indexOf(name) > from ? 'fwd' : 'back';
        setTimeout(function () { delete v.dataset.enter; }, 360);
      }
    });
    var label = $('.view[data-view="' + name + '"]').getAttribute('aria-label') || '';
    $('#page-title').textContent = label;
    $$('[data-view]').forEach(function (b) {
      if (b.classList.contains('view')) return;
      var on = b.dataset.view === name;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (views[name].open) views[name].open(opts || {});
    if (changed) {
      if (!(opts && opts.fromHistory)) whenSettled(function () {
        try {
          if (from < 0) history.replaceState({ view: name }, '', '#' + name);
          else history.pushState({ view: name }, '', '#' + name);
        } catch (e) { /* ignore */ }
      });
      window.scrollTo({ top: 0, behavior: 'auto' });
      document.title = label + ' | MORABA';
    }
  };
  MP.visible = function (name) { return S.view === name; };
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]:not(.view),[data-go],[data-action]');
    if (!b || b.closest('.view') && b.dataset.view) return;
    if (b.dataset.go) { MP.showView(b.dataset.go); return; }
    if (b.dataset.view) { MP.showView(b.dataset.view); return; }
    var a = b.dataset.action;
    if (a === 'voice-tasks') MP.voiceTasks();
    if (a === 'templates') MP.templates();
    if (a === 'task-io') MP.taskIO();
    if (a === 'payroll') MP.reportTab('payroll');
    else if (a === 'settings') openAppearance();
    else if (a === 'help') openHelp();
    else if (a === 'logout') logout();
    else if (a === 'more') MP.openMenu();
    else if (a === 'create') MP.quickCreate();
  });
  var collapse = $('.collapse');
  collapse.onclick = function () {
    var closed = app.classList.toggle('collapsed');
    collapse.setAttribute('aria-expanded', String(!closed));
    collapse.setAttribute('aria-label', closed ? 'باز کردن منو' : 'جمع کردن منو');
    try { localStorage.setItem('mp-collapsed', closed ? '1' : ''); } catch (e) { /* ignore */ }
  };
  try { if (localStorage.getItem('mp-collapsed')) { app.classList.add('collapsed'); collapse.setAttribute('aria-expanded', 'false'); } } catch (e) { /* ignore */ }
  MP.reveal = function (selector) {
    var t = $(selector); if (!t) return;
    t.scrollIntoView({ behavior: 'smooth', block: 'center' });
    t.animate([{ boxShadow: '0 0 0 0 rgba(242,138,36,.6)' }, { boxShadow: '0 0 0 10px rgba(242,138,36,0)' }], { duration: 900, iterations: 2 });
  };
  /** Phone menu: profile, every section, settings. Opened from the avatar or «بیشتر». */
  MP.openMenu = function () {
    var grid = el('div', { class: 'more-sheet' });
    $$('.sidebar .nav .nav-item').forEach(function (b) {
      // Tab-bar pages are one tap away already; settings/help/logout live in the list below.
      if (b.closest('.nav-bottom') || ['dashboard', 'calendar', 'mytasks', 'messages'].indexOf(b.dataset.view) >= 0) return;
      var badge = $('.badge', b);
      grid.append(el('button', { type: 'button', onclick: function () { MP.dialog.close(); if (b.dataset.view) MP.showView(b.dataset.view); else b.click(); } },
        MP.iconEl($('use', b).getAttribute('href').slice(1)), el('span', { text: $('.nav-label', b).textContent }),
        badge && !badge.hidden ? el('span', { class: 'badge', text: badge.textContent }) : null));
    });
    var me = S.me;
    MP.dialog.open('منو', el('div', null,
      el('button', { type: 'button', class: 'menu-profile', onclick: function () { MP.openProfile(me.id); } }, MP.avatar(me, 'lg'),
        el('span', { class: 'mp-copy' }, el('strong', { text: me.name }), el('small', { text: me.title || S.boot.email })), MP.iconEl('left')),
      grid,
      el('div', { class: 'menu menu-list' },
        el('button', { type: 'button', html: icon('edit'), onclick: openAccount }, 'حساب کاربری و اعلان‌ها'),
        el('button', { type: 'button', html: icon('settings'), onclick: openAppearance }, 'ظاهر پنل'),
        el('button', { type: 'button', html: icon('help'), onclick: openHelp }, 'راهنما'),
        !MP.standalone() ? el('button', { type: 'button', html: icon('download'), onclick: MP.install }, 'نصب اپلیکیشن روی گوشی') : null,
        el('button', { type: 'button', class: 'danger', html: icon('logout'), onclick: logout }, 'خروج از حساب'))), { focus: false });
  };
  MP.standalone = function () { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; };
  var CREATE = [
    ['tasks', 'تسک جدید', function () { MP.taskForm(); }],
    ['video', 'جلسه', function () { MP.meetingForm(); }],
    ['wallet', 'دخل و خرج', function () { MP.showView('accounting'); setTimeout(function () { var a = $('#acc-form-card input[name=amount]'); if (a) { a.scrollIntoView({ block: 'center' }); a.focus(); } }, 350); }],
    ['clock', 'ورود / خروج', function () { var c = $('#punch-chip'); if (c) c.click(); }],
    ['leave', 'مرخصی', function () { MP.showView('attendance'); setTimeout(function () { $('#leave-new').click(); }, 250); }],
    ['alarm', 'یادآوری', function () { MP.showView('reminders'); setTimeout(function () { var t = $('#reminder-form-card input[name=title]'); if (t) t.focus(); }, 300); }],
    ['chat', 'پیام جدید', function () { MP.showView('messages'); setTimeout(function () { $('#new-dm').click(); }, 250); }],
    ['folder', 'یادداشت پروژه', function () { MP.showView('projects'); }]
  ];
  MP.quickCreate = function () {
    MP.haptic(10);
    var list = S.manager ? [['list', 'از روی قالب', function () { MP.templates(); }], ['mic', 'تسک گروهی با صدا', function () { MP.voiceTasks(); }]].concat(CREATE) : CREATE;
    MP.dialog.open('ایجاد سریع', el('div', { class: 'more-sheet create-sheet' }, list.map(function (c) {
      return el('button', { type: 'button', onclick: function () { MP.dialog.close(); setTimeout(c[2], 200); } }, MP.iconEl(c[0]), el('span', { text: c[1] }));
    })), { focus: false });
  };
  /** Sign out inside the panel (no WordPress screens), then go to the site's home page. */
  function logout() {
    MP.confirm('خروج از حساب', 'می‌خواهید از پنل خارج شوید؟', 'خروج').then(function (ok) {
      if (!ok) return;
      document.body.classList.add('is-loading');
      MP.api('auth/logout', { method: 'POST' })
        .then(function (r) { location.replace(r.redirect || '/'); })
        .catch(function () { location.href = S.boot.logoutUrl; });
    });
  }
  MP.logout = logout;

  /* ------------------------------------------------------------ Popovers */

  var popovers = { profile: $('#profile-popover'), notifications: $('#notifications-popover'), search: $('#search-popover') };
  var triggers = { profile: $('.profile-btn'), notifications: $('.notif-btn'), search: $('.search input') };
  var activePopover = null, popLayer = null;
  function closePopover(focus) {
    if (!activePopover) return;
    var k = activePopover; popovers[k].hidden = true; triggers[k].setAttribute('aria-expanded', 'false'); activePopover = null;
    document.body.classList.remove('sheet-open');
    if (popLayer) { var l = popLayer; popLayer = null; MP.popLayer(l); }
    if (focus) triggers[k].focus();
  }
  function openPopover(k) {
    if (activePopover !== k) closePopover();
    activePopover = k; popovers[k].hidden = false; triggers[k].setAttribute('aria-expanded', 'true');
    // On phones these popovers are bottom sheets: hide the tab bar and let the back button close them.
    if (k !== 'search' && MP.isMobile()) {
      document.body.classList.add('sheet-open');
      if (!popLayer) popLayer = MP.pushLayer(function () { popLayer = null; closePopover(); });
    }
  }
  MP.closePopover = closePopover;
  triggers.profile.onclick = function () { if (MP.isMobile()) { MP.openMenu(); return; } if (activePopover === 'profile') closePopover(); else openPopover('profile'); };
  document.addEventListener('pointerdown', function (e) {
    if (activePopover && !popovers[activePopover].contains(e.target) && !triggers[activePopover].contains(e.target) && !e.target.closest('.search')) closePopover();
  });
  document.addEventListener('keydown', function (e) {
    var typing = e.target.closest('input,textarea,select,[contenteditable]');
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openSearch(); return; }
    if (!typing && !MP.dialog.isOpen() && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === '/') { e.preventDefault(); openSearch(); return; }
      if (e.key === 'n' || e.key === 'ض') { e.preventDefault(); MP.taskForm(); return; }
      if (e.key === '?') { e.preventDefault(); openHelp(); return; }
    }
    if (!activePopover) return;
    if (e.key === 'Escape') { e.preventDefault(); closePopover(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      var items = $$('button:not(:disabled)', popovers[activePopover]); if (!items.length) return;
      e.preventDefault();
      var i = items.indexOf(document.activeElement);
      items[i === -1 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
  });

  /* ---- Notifications */
  var NOTE_ICON = { task: 'tasks', comment: 'chat', message: 'chat', meeting: 'video', reminder: 'alarm', project: 'folder', leave: 'leave' };
  MP.renderNotifications = function () {
    var list = $('#notification-list'); list.replaceChildren();
    if (!S.notifications.length) { list.append(MP.empty('bell', 'اعلانی ندارید', 'اعلان‌های تسک، پیام و جلسه اینجا نمایش داده می‌شوند.', null, true)); return; }
    S.notifications.forEach(function (n) {
      list.append(el('button', { type: 'button', class: 'pop-item' + (n.read ? '' : ' unread'), onclick: function () { openNotification(n); } },
        el('span', { class: 'pop-ico', html: icon(NOTE_ICON[n.type] || 'bell') }),
        el('span', null, el('strong', { text: n.title }), n.detail ? el('small', { text: J.faDigits(n.detail) }) : null, el('small', { text: MP.relTime(n.created_at) }))));
    });
  };
  function openNotification(n) {
    closePopover();
    if (!n.read) MP.api('notifications/read', { method: 'POST', body: { id: n.id } }).then(function (l) { S.notifications = l; MP.renderNotifications(); MP.refreshCounts(); });
    var go = {
      calendar: function () { var t = MP.taskById(n.ref_id); MP.showView('calendar', { date: t ? t.date : S.today }); },
      task: function () { MP.openTask(n.ref_id); },
      messages: function () { MP.showView('messages', { channel: n.ref_id }); },
      meeting: function () { MP.showView('dashboard'); MP.reveal('.meetings-card'); },
      projects: function () { if (n.ref_id) S.projectId = n.ref_id; MP.showView('projects'); },
      reminders: function () { MP.showView('reminders'); },
      attendance: function () { MP.showView('attendance'); },
      reports: function () { MP.showView('reports'); }
    }[n.target];
    if (go) go();
  }
  triggers.notifications.onclick = function () {
    if (activePopover === 'notifications') { closePopover(); return; }
    openPopover('notifications');
    MP.api('notifications').then(function (l) { S.notifications = l; MP.renderNotifications(); });
  };
  $('#mark-all-read').onclick = function () {
    MP.api('notifications/read', { method: 'POST', body: {} }).then(function (l) { S.notifications = l; MP.renderNotifications(); MP.refreshCounts(); });
  };

  /* ---- Search & command palette */
  var searchInput = triggers.search, searchLayer = null;
  function openSearch() {
    if (MP.isMobile() && !document.body.classList.contains('search-open')) {
      document.body.classList.add('search-open');
      searchLayer = MP.pushLayer(function () { searchLayer = null; closeSearch(); });
    }
    searchInput.focus();
    renderSearch();
  }
  function closeSearch() {
    document.body.classList.remove('search-open');
    if (searchLayer) { var l = searchLayer; searchLayer = null; MP.popLayer(l); }
    if (activePopover === 'search') closePopover();
  }
  MP.openSearch = openSearch;
  function paletteActions() {
    var list = CREATE.slice(0, 7).map(function (c) { return { icon: c[0], title: c[1], detail: 'ایجاد سریع', go: c[2] }; });
    ORDER.forEach(function (v) {
      var b = $('.sidebar [data-view="' + v + '"]');
      list.push({ icon: $('use', b).getAttribute('href').slice(1), title: 'رفتن به ' + $('.nav-label', b).textContent, detail: 'صفحه', go: function () { MP.showView(v); } });
    });
    return list;
  }
  function renderSearch() {
    var value = searchInput.value.trim(), list = $('#search-results');
    list.replaceChildren();
    var q = MP.norm(value), count = 0, groups;
    if (!value) {
      groups = [['کارهای سریع', null, paletteActions()]];
    } else {
      groups = [
        ['تسک‌ها', 'tasks', MP.myTasks().filter(function (t) { return MP.norm(t.title + ' ' + t.description).indexOf(q) >= 0; }).slice(0, 8).map(function (t) {
          return { title: t.title, detail: J.format(t.date) + ' · ' + MP.STATUS[t.status], go: function () { MP.openTask(t.id, t); } }; })],
        ['پروژه‌ها', 'folder', S.projects.filter(function (p) { return MP.norm(p.name).indexOf(q) >= 0; }).map(function (p) {
          return { title: p.name, detail: fa(p.sections.length) + ' بخش · ' + fa(p.members.length) + ' عضو', go: function () { S.projectId = p.id; MP.showView('projects'); } }; })],
        ['افراد', 'user', S.users.filter(function (u) { return MP.norm(u.name + ' ' + u.title).indexOf(q) >= 0; }).map(function (u) {
          return { title: u.name, detail: u.title || u.role, go: function () { MP.openProfile(u.id); } }; })],
        ['گفت‌وگوها', 'chat', S.channels.filter(function (c) { return MP.norm(c.title).indexOf(q) >= 0; }).map(function (c) {
          return { title: c.title, detail: 'پیام‌ها', go: function () { MP.showView('messages', { channel: c.id }); } }; })],
        ['کارها', null, paletteActions().filter(function (a) { return MP.norm(a.title).indexOf(q) >= 0; })]
      ];
    }
    groups.forEach(function (g) {
      if (!g[2].length) return;
      list.append(el('div', { class: 'pop-group', text: g[0] }));
      g[2].forEach(function (item) {
        count++;
        list.append(el('button', { type: 'button', class: 'pop-item', onclick: function () { searchInput.value = ''; searchInput.blur(); closeSearch(); item.go(); } },
          el('span', { class: 'pop-ico', html: icon(item.icon || g[1]) }), el('span', null, el('strong', { text: item.title }), el('small', { text: item.detail }))));
      });
    });
    if (!count) list.append(MP.empty('search', 'نتیجه‌ای پیدا نشد', 'عبارت دیگری را امتحان کنید.', null, true));
    $('#search-status').textContent = value && count ? fa(count) + ' نتیجه' : (MP.isMobile() ? '' : 'Ctrl+K');
    openPopover('search');
  }
  searchInput.addEventListener('input', renderSearch);
  searchInput.addEventListener('focus', function () { if (MP.isMobile()) openSearch(); else renderSearch(); });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); var r = $('#search-results .pop-item'); if (r) r.click(); }
    if (e.key === 'Escape') { searchInput.value = ''; searchInput.blur(); closeSearch(); }
  });
  $('.search-cancel').onclick = function () { searchInput.value = ''; searchInput.blur(); closeSearch(); };
  $('.search-btn').onclick = openSearch;

  /* ------------------------------------------------------------ Profile, account, appearance, help */

  $$('[data-user-action]').forEach(function (b) {
    b.onclick = function () {
      closePopover();
      ({ profile: function () { MP.openProfile(S.me.id); }, account: openAccount, appearance: openAppearance, logout: logout, install: MP.install })[b.dataset.userAction]();
    };
  });
  MP.renderMe = function () {
    var me = S.me;
    $('#hello-name').textContent = MP.greeting() + '، ' + me.name.split(' ')[0];
    $('#hello-role').textContent = me.title || me.role;
    $('#profile-name').textContent = me.name;
    $('#profile-role').textContent = me.title || S.boot.email;
    $('#me-avatar').replaceChildren(MP.avatar(me));
    $('#profile-avatar').replaceChildren(MP.avatar(me, 'lg'));
    $('#today-label').textContent = J.formatLong(S.today);
    $('#today-label').setAttribute('datetime', S.today);
    document.body.classList.toggle('is-manager', S.manager);
  };
  MP.greeting = function () {
    var h = parseInt((S.now || new Date().toTimeString()).slice(0, 2), 10);
    return h >= 5 && h < 12 ? 'صبح بخیر' : h < 15 && h >= 12 ? 'ظهر بخیر' : h >= 15 && h < 19 ? 'عصر بخیر' : 'شب بخیر';
  };
  MP.openProfile = function (id) {
    var u = MP.user(id), mine = id === S.me.id;
    var box = el('div', { style: { textAlign: 'center' } },
      el('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: '10px' } }, MP.avatar(u, 'xl')),
      el('h3', { text: u.name, style: { fontSize: '20px' } }), el('p', { class: 'muted', text: u.title || u.role }),
      el('div', { style: { textAlign: 'right', marginTop: '16px' } },
        MP.detailRow('نقش', u.role),
        MP.detailRow('وضعیت', { online: 'آنلاین', away: 'اخیراً فعال', busy: 'آفلاین' }[u.status] || ''),
        u.phone ? MP.detailRow('تلفن', J.faDigits(u.phone)) : null,
        mine ? MP.detailRow('ایمیل', S.boot.email) : null),
      el('div', { class: 'dialog-actions', style: { justifyContent: 'center', marginTop: '18px' } },
        mine ? el('button', { class: 'btn btn-primary', type: 'button', text: 'ویرایش حساب', onclick: openAccount })
          : el('button', { class: 'btn btn-primary', type: 'button', text: 'ارسال پیام', onclick: function () { MP.dialog.close(); MP.startDirect(id); } }),
        !mine && u.phone ? el('a', { class: 'btn btn-secondary', href: 'tel:' + u.phone.replace(/[^0-9+]/g, ''), text: 'تماس' }) : null,
        !mine && S.manager ? el('button', { class: 'btn btn-secondary', type: 'button', text: 'تعیین تسک', onclick: function () { MP.taskForm({ userId: id }); } }) : null));
    MP.dialog.open(mine ? 'پروفایل من' : u.name, box, { focus: false });
  };
  /**
   * Square crop for profile photos: drag to move, slider / wheel / pinch to zoom.
   * Resolves with a 512×512 JPEG blob, or null if cancelled.
   */
  MP.cropImage = function (file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), img = new Image(), done = false;
      img.onerror = function () { URL.revokeObjectURL(url); MP.toast('این فایل عکس قابل خواندن نیست.', { error: true }); resolve(null); };
      img.onload = function () {
        var stage = el('div', { class: 'crop-stage' }), pic = el('img', { src: url, alt: '', draggable: 'false' });
        stage.append(pic, el('div', { class: 'crop-ring' }));
        var zoom = el('input', { type: 'range', min: 1, max: 4, step: 0.01, value: 1, 'aria-label': 'بزرگ‌نمایی', class: 'crop-zoom' });
        var S0 = 0, z = 1, x = 0, y = 0, W = img.naturalWidth, H = img.naturalHeight, box = 0;
        function clamp() {
          var s = S0 * z, mx = Math.max(0, (W * s - box) / 2), my = Math.max(0, (H * s - box) / 2);
          x = Math.min(mx, Math.max(-mx, x)); y = Math.min(my, Math.max(-my, y));
        }
        function draw() { clamp(); pic.style.transform = 'translate(-50%,-50%) translate(' + x + 'px,' + y + 'px) scale(' + (S0 * z) + ')'; }
        function setZoom(v) { z = Math.min(4, Math.max(1, v)); zoom.value = z; draw(); }
        zoom.oninput = function () { setZoom(+zoom.value); };
        var pts = {}, last = null, pinch0 = 0, z0 = 1;
        stage.addEventListener('pointerdown', function (e) { try { stage.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ } pts[e.pointerId] = [e.clientX, e.clientY]; last = [e.clientX, e.clientY];
          var k = Object.keys(pts); if (k.length === 2) { pinch0 = Math.hypot(pts[k[0]][0] - pts[k[1]][0], pts[k[0]][1] - pts[k[1]][1]); z0 = z; } });
        stage.addEventListener('pointermove', function (e) {
          if (!pts[e.pointerId]) return; pts[e.pointerId] = [e.clientX, e.clientY];
          var k = Object.keys(pts);
          if (k.length === 2 && pinch0) { setZoom(z0 * Math.hypot(pts[k[0]][0] - pts[k[1]][0], pts[k[0]][1] - pts[k[1]][1]) / pinch0); return; }
          x += e.clientX - last[0]; y += e.clientY - last[1]; last = [e.clientX, e.clientY]; draw();
        });
        function up(e) { delete pts[e.pointerId]; pinch0 = 0; var k = Object.keys(pts); last = k.length ? pts[k[0]] : null; }
        stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
        stage.addEventListener('wheel', function (e) { e.preventDefault(); setZoom(z * (e.deltaY < 0 ? 1.08 : 0.93)); }, { passive: false });
        var form = el('form', { class: 'form crop-form' },
          el('p', { class: 'hint', text: 'عکس را جابه‌جا کنید و با اسلایدر یا دو انگشت بزرگ‌نمایی کنید.' }),
          stage, el('div', { class: 'crop-zoom-row' }, MP.iconEl('user'), zoom, MP.iconEl('user')),
          MP.actions('ذخیره عکس'));
        form.onsubmit = function (e) {
          e.preventDefault();
          var out = document.createElement('canvas'); out.width = out.height = 512;
          var s = S0 * z, ctx = out.getContext('2d');
          // Map the visible box back to source pixels.
          var sw = box / s, sx = W / 2 - (box / 2 + x) / s, sy = H / 2 - (box / 2 + y) / s;
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 512, 512);
          ctx.drawImage(img, sx, sy, sw, sw, 0, 0, 512, 512);
          out.toBlob(function (blob) { done = true; URL.revokeObjectURL(url); MP.dialog.close(); resolve(blob ? new File([blob], 'avatar.jpg', { type: 'image/jpeg' }) : null); }, 'image/jpeg', 0.9);
        };
        MP.dialog.open('برش عکس پروفایل', form, { focus: false, onClose: function () { if (!done) { URL.revokeObjectURL(url); resolve(null); } } });
        requestAnimationFrame(function () { box = stage.clientWidth; S0 = Math.max(box / W, box / H); draw(); });
      };
      img.src = url;
    });
  };

  function openAccount() {
    var ch = S.boot.channels, p = S.boot.prefs, avatarSlot = el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } });
    function drawAvatar() {
      avatarSlot.replaceChildren(MP.avatar(S.me, 'lg'),
        el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          el('label', { class: 'btn btn-secondary btn-sm' }, 'بارگذاری عکس', el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', onchange: function (e) {
            var f = e.target.files[0]; e.target.value = ''; if (!f) return;
            // The crop dialog replaces this one; reopen the account sheet when done.
            MP.cropImage(f).then(function (cropped) {
              if (!cropped) { openAccount(); return null; }
              return MP.upload('me/avatar', cropped, {}).then(function (me) { S.me = me; S.userMap[me.id] = me; MP.renderMe(); openAccount(); MP.toast('عکس پروفایل به‌روز شد'); });
            }).catch(MP.soft);
          } })),
          S.me.avatar ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'حذف عکس', onclick: function () {
            MP.api('me/avatar', { method: 'DELETE' }).then(function (me) { S.me = me; S.userMap[me.id] = me; MP.renderMe(); drawAvatar(); }).catch(MP.soft);
          } }) : null));
    }
    drawAvatar();
    var form = el('form', { class: 'form' },
      avatarSlot,
      el('div', { class: 'row' },
        MP.field('نام نمایشی', el('input', { name: 'name', required: true, maxlength: 80, value: S.me.name })),
        MP.field('عنوان شغلی', el('input', { name: 'title', maxlength: 80, value: S.me.title }))),
      MP.field('موبایل', el('input', { name: 'phone', maxlength: 20, dir: 'ltr', value: S.me.phone, inputmode: 'tel', placeholder: '09…' }), ch.sms ? 'با این شماره وارد پنل می‌شوید و اعلان‌های مهم به آن پیامک می‌شود.' : ''),
      el('h3', { text: 'کانال‌های اعلان', style: { fontSize: '15px', marginTop: '6px' } }),
      (function () {
        var row = switchRow('pref-device', 'اعلان روی این دستگاه', 'اعلان سیستم حتی وقتی پنل بسته است', false);
        var input = $('input', row);
        MP.push.status().then(function (st) {
          input.checked = st === 'on';
          if (st === 'unsupported' || st === 'denied' || st === 'install-first') {
            input.disabled = true;
            $('small', row).textContent = st === 'denied' ? 'اعلان در تنظیمات مرورگر مسدود شده است.' : st === 'install-first' ? 'در آیفون ابتدا پنل را روی صفحه اصلی نصب کنید.' : 'این مرورگر اعلان پوش ندارد.';
          }
        });
        input.onchange = function () {
          (input.checked ? MP.push.enable() : MP.push.disable()).catch(function (err) { input.checked = !input.checked; MP.soft(err); });
        };
        return row;
      })(),
      el('div', { class: 'row' },
        MP.field('شناسه چت تلگرام', el('input', { name: 'telegram_chat', dir: 'ltr', value: ch.telegram_chat, placeholder: 'مثلاً 123456789', disabled: !ch.telegram }), ch.telegram ? 'به ربات سایت پیام دهید و شناسه عددی خود را (مثلاً از ‎@userinfobot) وارد کنید.' : 'ناظر سایت هنوز ربات تلگرام را تنظیم نکرده است.'),
        MP.field('شناسه چت بله', el('input', { name: 'bale_chat', dir: 'ltr', value: ch.bale_chat, placeholder: 'مثلاً 123456789', disabled: !ch.bale }), ch.bale ? 'به ربات سایت در بله پیام دهید و شناسه عددی خود را وارد کنید.' : 'ناظر سایت هنوز ربات بله را تنظیم نکرده است.')),
      switchRow('pref-emails', 'اعلان ایمیلی', 'تسک تعیین‌شده، دعوت جلسه، یادآوری و مرخصی', p.emails),
      ch.telegram ? switchRow('pref-telegram', 'تلگرام', 'ارسال همه اعلان‌ها به تلگرام', p.telegram) : null,
      ch.bale ? switchRow('pref-bale', 'بله', 'ارسال همه اعلان‌ها به بله', p.bale) : null,
      ch.sms ? switchRow('pref-sms', 'پیامک', 'فقط اعلان‌های مهم', p.sms) : null,
      MP.actions('ذخیره', (ch.telegram || ch.bale || ch.sms) ? el('button', { type: 'button', class: 'btn btn-secondary', text: 'ارسال پیام آزمایشی', onclick: function () {
        MP.api('me/test-notify', { method: 'POST' }).then(function (r) { MP.toast('ارسال شد به: ' + r.channels.map(function (c) { return { telegram: 'تلگرام', bale: 'بله', sms: 'پیامک' }[c]; }).join('، ')); }).catch(MP.soft);
      } }) : null));
    form.onsubmit = function (e) {
      e.preventDefault(); MP.busy(form, true);
      var f = form.elements, prefs = Object.assign({}, S.boot.prefs, { emails: $('#pref-emails', form).checked });
      ['telegram', 'bale', 'sms'].forEach(function (k) { var x = $('#pref-' + k, form); if (x) prefs[k] = x.checked; });
      MP.api('me', { method: 'POST', body: { name: f.name.value, title: f.title.value, phone: f.phone.value, telegram_chat: f.telegram_chat.value, bale_chat: f.bale_chat.value, prefs: prefs } })
        .then(function (boot) { MP.applyBoot(boot); MP.dialog.close(); MP.toast('حساب کاربری ذخیره شد'); })
        .catch(function (err) { MP.busy(form, false); MP.soft(err); });
    };
    MP.dialog.open('حساب کاربری و اعلان‌ها', form, { wide: true });
  }
  MP.openAccount = openAccount;
  function switchRow(id, title, hint, checked) {
    return el('label', { class: 'switch-row', for: id },
      el('span', null, el('strong', { text: title }), el('small', { text: hint })),
      el('span', { class: 'switch' }, el('input', { id: id, type: 'checkbox', role: 'switch', checked: !!checked }), el('i')));
  }
  function openAppearance() {
    var p = S.boot.prefs;
    var box = el('div', null,
      switchRow('dark-setting', 'حالت تیره', 'رنگ‌های تیره برای کار در شب', p.dark),
      switchRow('motion-setting', 'کاهش انیمیشن‌ها', 'حرکت کمتر برای تجربه‌ای آرام‌تر', p.motion));
    MP.dialog.open('ظاهر پنل', box, { focus: false });
    $$('input', box).forEach(function (i) {
      i.onchange = function () {
        S.boot.prefs.dark = $('#dark-setting').checked; S.boot.prefs.motion = $('#motion-setting').checked;
        MP.applyPrefs();
        MP.api('me', { method: 'POST', body: { prefs: S.boot.prefs } }).then(function () { MP.toast('ذخیره شد'); }).catch(MP.soft);
      };
    });
  }
  MP.applyPrefs = function () {
    var p = S.boot.prefs;
    document.documentElement.classList.toggle('dark', !!p.dark);
    document.documentElement.classList.toggle('reduced-motion', !!p.motion);
    try { localStorage.setItem('mp-prefs', JSON.stringify({ dark: !!p.dark, motion: !!p.motion })); } catch (e) { /* ignore */ }
    var meta = $('meta[name=theme-color]'); if (meta) meta.content = p.dark ? '#0e0f10' : '#161616';
  };
  function openHelp() {
    var items = [
      ['calendar', 'تقویم', 'تسک‌هایی که ناظر تعیین کرده با قفل بنفش مشخص‌اند؛ عنوان، تاریخ و ساعتشان قابل تغییر نیست ولی وضعیت، تیک چک‌لیست، تایمر و نظر روی آن‌ها کار می‌کند. با «دیدم» دریافت تسک را تأیید کنید.'],
      ['tasks', 'تسک‌ها', 'برای هر تسک می‌توانید چک‌لیست، فایل، نظر و زمان کار ثبت کنید. تسک‌های تکرارشونده (روزانه، هفتگی، ماهانه) هم ممکن است.'],
      ['clock', 'حضور و مرخصی', 'با دکمه بالای صفحه ورود و خروج را ثبت کنید. درخواست مرخصی روزانه یا ساعتی به ناظر می‌رسد.'],
      ['wallet', 'حسابداری', 'هر دخل و خرج را با دسته، پروژه و عکس رسید ثبت کنید؛ خروجی اکسل و PDF دارد.'],
      ['chat', 'پیام‌ها', 'Enter ارسال و Shift+Enter خط جدید. فایل و عکس هم می‌فرستید و تیک دوتایی یعنی دیده شده.'],
      ['search', 'میان‌برها', 'Ctrl+K یا / : جستجو و کارهای سریع · N : تسک جدید · ? : همین راهنما. در گوشی: ردیف تسک را به راست بکشید تا انجام شود، به چپ برای جزئیات؛ صفحه را پایین بکشید تا به‌روز شود.']
    ];
    if (S.manager) items.splice(1, 0, ['user', 'ناظر', 'در تقویم، نمای «تیم» برنامه هفتگی همه را نشان می‌دهد. یک تسک را هم‌زمان برای چند نفر و با تکرار تعیین کنید. تاریخچه تغییرات در گزارش‌هاست.']);
    MP.dialog.open('راهنما', el('div', null, items.map(function (i) {
      return el('div', { class: 'audit-item' }, el('span', { class: 'pop-ico', html: icon(i[0]) }), el('div', null, el('strong', { text: i[1] }), el('p', { text: i[2] })));
    })), { focus: false });
  }

  /* ------------------------------------------------------------ PWA install */

  var deferredInstall = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; var b = $('[data-user-action=install]'); if (b) b.hidden = false; });
  MP.install = function () {
    if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; $('[data-user-action=install]').hidden = true; return; }
    var ios = MP.isIOS();
    MP.dialog.open('نصب اپلیکیشن', el('div', { class: 'install-steps' },
      el('div', { class: 'install-hero' }, el('img', { src: C.assets + 'img/icon-192.png', alt: '' }), el('strong', { text: 'پنل مربع' }), el('small', { text: 'روی صفحه اصلی گوشی، تمام‌صفحه و با اعلان' })),
      el('ol', null, (ios ? [
        ['send', 'در Safari دکمه اشتراک‌گذاری (مربع با فلش رو به بالا) را بزنید.'],
        ['plus', 'گزینه «Add to Home Screen» را انتخاب کنید.'],
        ['check', '«Add» را بزنید؛ آیکون مربع روی صفحه اصلی می‌آید. برای اعلان‌ها، پنل را از همین آیکون باز کنید.']
      ] : [
        ['menu', 'در Chrome منوی سه‌نقطه بالای صفحه را باز کنید.'],
        ['download', '«نصب برنامه» یا «Add to Home screen» را بزنید.'],
        ['check', 'تأیید کنید؛ پنل مثل یک اپ از صفحه اصلی باز می‌شود.']
      ]).map(function (s) { return el('li', null, el('span', { html: icon(s[0]) }), s[1]); }))), { focus: false });
  };
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
    window.addEventListener('load', function () { navigator.serviceWorker.register(C.sw, { scope: C.scope }).catch(function () { /* optional */ }); });
  }

  /* ------------------------------------------------------------ Pull to refresh & connectivity */

  MP.refreshAll = function () {
    return Promise.all([
      MP.loadTasks(), MP.loadProjects(), MP.refreshCounts(),
      MP.loadMeetings ? MP.loadMeetings() : null, MP.loadAttendance ? MP.loadAttendance() : null, MP.loadChannels ? MP.loadChannels() : null
    ]).then(function () { MP.showView(S.view); });
  };
  (function () {
    var ind = $('#ptr'), startY = null, dist = 0, busy = false;
    function reset() { ind.style.transform = ''; ind.style.opacity = ''; ind.classList.remove('ready', 'spinning'); }
    window.addEventListener('touchstart', function (e) {
      startY = null;
      if (!MP.isMobile() || busy || window.scrollY > 2 || MP.dialog.isOpen() || document.body.classList.contains('search-open')) return;
      if (e.target.closest('.chat-layout.open,.timeline,.team-scroll,.picker,input,textarea,select')) return;
      startY = e.touches[0].clientY; dist = 0;
    }, { passive: true });
    window.addEventListener('touchmove', function (e) {
      if (startY === null) return;
      dist = Math.min(96, Math.max(0, (e.touches[0].clientY - startY) * 0.5));
      ind.style.transform = 'translate(-50%,' + dist + 'px) rotate(' + dist * 4 + 'deg)';
      ind.style.opacity = Math.min(1, dist / 40);
      var ready = dist >= 64;
      if (ready && !ind.classList.contains('ready')) MP.haptic(8);
      ind.classList.toggle('ready', ready);
    }, { passive: true });
    window.addEventListener('touchend', function () {
      if (startY === null) return;
      startY = null;
      if (!ind.classList.contains('ready')) { reset(); return; }
      busy = true; ind.classList.add('spinning'); ind.style.transform = 'translate(-50%,64px)';
      MP.refreshAll().then(function () { busy = false; reset(); }, function () { busy = false; reset(); });
    });
  })();
  function connectivity() {
    var off = !navigator.onLine;
    document.body.classList.toggle('is-offline', off);
    $('#offline-bar').hidden = !off;
  }
  window.addEventListener('online', function () { connectivity(); MP.toast('اتصال برقرار شد'); MP.refreshAll(); });
  window.addEventListener('offline', connectivity);
  connectivity();

  /* ------------------------------------------------------------ Push notifications & install prompts */

  function b64ToBytes(s) {
    var pad = '='.repeat((4 - s.length % 4) % 4), raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  MP.isIOS = function () { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); };
  MP.push = {
    supported: function () { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; },
    status: function () {
      if (!MP.push.supported()) return Promise.resolve(MP.isIOS() && !MP.standalone() ? 'install-first' : 'unsupported');
      if (Notification.permission === 'denied') return Promise.resolve('denied');
      return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (s) { return s ? 'on' : 'off'; });
    },
    enable: function () {
      return Notification.requestPermission().then(function (p) {
        if (p !== 'granted') throw new Error('اجازه نمایش اعلان داده نشد؛ از تنظیمات مرورگر آن را فعال کنید.');
        return MP.api('push');
      }).then(function (k) {
        if (!k.supported) throw new Error('سرور سایت از اعلان پوش پشتیبانی نمی‌کند (افزونه OpenSSL).');
        return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(k.key) }); });
      }).then(function (sub) { return MP.api('push', { method: 'POST', body: { endpoint: sub.endpoint } }); })
        .then(function () { MP.toast('اعلان‌ها روی این دستگاه روشن شد', { icon: 'bell' }); MP.haptic([10, 40, 10]); });
    },
    disable: function () {
      return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
        if (!sub) return null;
        var endpoint = sub.endpoint;
        return sub.unsubscribe().then(function () { return MP.api('push', { method: 'DELETE', query: { endpoint: endpoint } }); });
      }).then(function () { MP.toast('اعلان‌های این دستگاه خاموش شد'); });
    }
  };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      var d = e.data || {};
      if (d.type === 'open' && d.url) { var v = d.url.split('#')[1]; if (v) MP.showView(v); MP.refreshCounts(); }
      if (d.type === 'refresh') MP.refreshCounts();
    });
  }
  function osNotify(n) {
    if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function (reg) {
      reg.showNotification(n.title, { body: J.faDigits(n.detail || ''), tag: 'mp-' + n.id, icon: C.assets + 'img/icon-192.png', dir: 'rtl', lang: 'fa', data: { url: location.href.split('#')[0] + '#dashboard' } });
    }).catch(function () {});
  }
  function dismissed(k) { try { return !!localStorage.getItem('mp-dismiss-' + k); } catch (e) { return false; } }
  function dismiss(k) { try { localStorage.setItem('mp-dismiss-' + k, '1'); } catch (e) { /* ignore */ } }
  /** Small cards on the home screen: install the app, turn on notifications. */
  MP.renderPrompts = function () {
    var box = $('#prompts'); if (!box) return;
    box.replaceChildren();
    function card(key, iconName, title, text, action, run) {
      var c = el('div', { class: 'prompt-card rise' },
        el('span', { class: 'prompt-ico', html: icon(iconName) }),
        el('div', { class: 'prompt-copy' }, el('strong', { text: title }), el('small', { text: text })),
        el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: action, onclick: function () { run(c); } }),
        el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'بستن', html: icon('close'), onclick: function () { dismiss(key); c.remove(); } }));
      box.append(c);
    }
    // iPhone gets the step-by-step banner from pwa.js instead of this card.
    if (MP.isMobile() && !MP.standalone() && !MP.isIOS() && !dismissed('install')) {
      card('install', 'download', 'پنل را مثل اپ نصب کنید', 'باز شدن سریع از صفحه اصلی گوشی، تمام‌صفحه و با اعلان.', 'نصب', function () { MP.install(); });
    }
    MP.push.status().then(function (st) {
      if (st === 'off' && Notification.permission === 'default' && !dismissed('push')) {
        card('push', 'bell', 'اعلان‌ها را روشن کنید', 'تسک جدید، پیام و جلسه را حتی وقتی پنل بسته است ببینید.', 'روشن کردن', function (c) {
          MP.push.enable().then(function () { c.remove(); }).catch(MP.soft);
        });
      }
    });
  };

  /* ------------------------------------------------------------ Badges & heartbeat */

  function setBadge(name, n) { $$('[data-count="' + name + '"]').forEach(function (b) { b.hidden = !n; b.textContent = n > 99 ? '۹۹+' : fa(n); }); }
  MP.updateBadges = function (c) {
    c = c || S.boot.counts; S.boot.counts = c;
    setBadge('tasks', c.tasks); setBadge('messages', c.messages); setBadge('reminders', c.reminders); setBadge('leaves', c.leaves);
    setBadge('more', c.leaves + c.reminders);
    $('.notif-dot').hidden = !c.notifications;
    triggers.notifications.setAttribute('aria-label', 'اعلان‌ها' + (c.notifications ? '، ' + fa(c.notifications) + ' خوانده‌نشده' : ''));
    var total = (c.notifications || 0) + (c.messages || 0);
    try { if (navigator.setAppBadge) { if (total) navigator.setAppBadge(total); else navigator.clearAppBadge(); } } catch (e) { /* ignore */ }
  };
  var lastNotes = -1;
  MP.refreshCounts = function () {
    return MP.api('heartbeat').then(function (h) {
      var dayChanged = h.today !== S.today;
      S.today = h.today; S.now = h.now;
      MP.updateBadges(h.counts);
      if (lastNotes >= 0 && h.counts.notifications > lastNotes) {
        MP.api('notifications').then(function (list) {
          S.notifications = list; MP.renderNotifications();
          var fresh = list.filter(function (n) { return !n.read; })[0];
          // A message in the chat that is open right now arrives with its own animation; no toast for it.
          var inChat = fresh && fresh.type === 'message' && MP.visible('messages') && MP.openChannel && MP.openChannel() === +fresh.ref_id && !document.hidden;
          if (fresh && !inChat) MP.toast(fresh.title, { icon: 'bell', action: 'مشاهده', onAction: function () { openNotification(fresh); } });
          if (fresh) { MP.emit('notification', fresh); if (!inChat) osNotify(fresh); }
        });
      }
      lastNotes = h.counts.notifications;
      if (dayChanged) { MP.renderMe(); MP.emit('day'); }
    }).catch(function () { /* offline: try later */ });
  };
  MP.applyBoot = function (boot) {
    S.boot = boot; S.me = boot.me; S.today = boot.today; S.now = boot.now; S.manager = boot.manager;
    S.users = boot.users; S.userMap = {};
    S.users.forEach(function (u) { S.userMap[u.id] = u; });
    if (!S.userMap[S.me.id]) { S.users.push(S.me); S.userMap[S.me.id] = S.me; }
    if (lastNotes < 0) lastNotes = boot.counts.notifications;
    MP.renderMe(); MP.applyPrefs(); MP.updateBadges(boot.counts);
  };
})();
