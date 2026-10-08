/*
 * The chat on a computer, made to feel like Telegram Desktop:
 * - keyboard: Ctrl+K quick switcher, Alt+↑/↓ · Ctrl+Tab · Ctrl+PgUp/PgDn next/previous chat, Ctrl+F search in the
 *   chat, Ctrl+0 saved messages, Esc closes the chat, typing anywhere goes to the composer, Ctrl+/ the list of keys;
 * - the chat list can be dragged wider or narrower; narrower than ~200px it becomes a column of pictures only;
 * - inside the Windows app «مربع چت» (window.__MP_DESKTOP, WebView2): unread count on the taskbar and tray,
 *   notifications while the window is hidden, the app's own settings, and a text menu in place of the browser's.
 * Loaded after messages.js; does nothing on touch screens except the bridge.
 */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, el = MP.el, $ = MP.$, fa = MP.fa, icon = MP.icon;
  var C = window.MP_CONFIG || {};
  var host = window.chrome && window.chrome.webview && window.__MP_DESKTOP ? window.chrome.webview : null;
  var fine = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (host) document.documentElement.classList.add('mp-desktop');

  function inField(t) { return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }
  function overlayOpen() { return MP.dialog && MP.dialog.isOpen && MP.dialog.isOpen() || !!document.querySelector('.ctx-menu, .qs-shade, .gallery, .mpv'); }
  function chatsView() { return MP.visible && MP.visible('messages'); }
  function step(dir) {
    var ids = MP.chatDesk.list(), cur = MP.openChannel(), i = ids.indexOf(cur);
    if (!ids.length) return;
    var n = i < 0 ? (dir > 0 ? 0 : ids.length - 1) : (i + dir + ids.length) % ids.length;
    MP.chatDesk.select(ids[n]);
  }

  /* ------------------------------------------------------------ Quick switcher (Ctrl+K) */
  function norm(s) { return MP.norm ? MP.norm(s) : String(s || '').toLowerCase(); }
  function quickSwitch() {
    if (document.querySelector('.qs-shade')) return;
    var input = el('input', { type: 'search', class: 'qs-input', placeholder: 'برو به گفت‌وگو… (نام گروه، همکار یا مشتری)', 'aria-label': 'جستجوی گفت‌وگو', autocomplete: 'off' });
    var list = el('div', { class: 'qs-list', role: 'listbox' }), at = 0, hits = [];
    var box = el('div', { class: 'qs-box', role: 'dialog', 'aria-label': 'رفتن سریع به گفت‌وگو' }, el('div', { class: 'qs-head', html: icon('search') }, input), list,
      el('div', { class: 'qs-foot' }, el('span', { html: '<kbd>↑</kbd><kbd>↓</kbd> انتخاب' }), el('span', { html: '<kbd>Enter</kbd> باز کردن' }), el('span', { html: '<kbd>Esc</kbd> بستن' })));
    var shade = el('div', { class: 'qs-shade', onclick: function (e) { if (e.target === shade) close(); } }, box);
    function score(c, q) {
      var t = norm(c.title + ' ' + (c.client_name || ''));
      if (!q) return 1;
      if (t.indexOf(q) === 0) return 3;
      if (t.indexOf(' ' + q) >= 0) return 2;
      return t.indexOf(q) >= 0 ? 1 : 0;
    }
    function draw() {
      var q = norm(input.value.trim());
      hits = (S.channels || []).filter(function (c) { return !c.archived; }).map(function (c) { return { c: c, s: score(c, q) + (c.unread ? .5 : 0) }; })
        .filter(function (x) { return x.s >= 1; })
        .sort(function (a, b) { return b.s - a.s || ((b.c.last && b.c.last.created_at) || '').localeCompare((a.c.last && a.c.last.created_at) || ''); })
        .slice(0, 12).map(function (x) { return x.c; });
      at = Math.min(at, Math.max(0, hits.length - 1));
      list.replaceChildren.apply(list, hits.length ? hits.map(function (c, i) {
        var row = el('button', { type: 'button', role: 'option', class: 'qs-row' + (i === at ? ' on' : ''), 'aria-selected': String(i === at), onclick: function () { go(c); } },
          el('span', { class: 'qs-ico', html: icon(c.type === 'direct' ? 'user' : c.type === 'saved' ? 'bookmark' : c.type === 'client' ? 'user' : c.type === 'group' ? 'chat' : 'folder') }),
          el('span', { class: 'qs-copy' }, el('strong', { text: c.title }), el('small', { text: c.type === 'direct' ? 'گفت‌وگوی خصوصی' : c.type === 'saved' ? 'پیام‌های ذخیره‌شده' : c.pv ? 'خصوصی با مشتری' : c.type === 'client' ? 'گروه مشتری' : c.type === 'group' ? 'گروه تیم' : 'گروه پروژه' })),
          c.unread ? el('span', { class: 'badge', text: fa(c.unread) }) : null);
        row.addEventListener('mousemove', function () { if (at !== i) { at = i; paint(); } });
        return row;
      }) : [el('p', { class: 'qs-none', text: 'گفت‌وگویی با این نام نیست' })]);
    }
    function paint() { Array.prototype.forEach.call(list.children, function (r, i) { r.classList.toggle('on', i === at); r.setAttribute('aria-selected', String(i === at)); if (i === at) r.scrollIntoView({ block: 'nearest' }); }); }
    function go(c) { close(); MP.chatDesk.select(c.id); }
    function close() { shade.remove(); }
    input.addEventListener('input', function () { at = 0; draw(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(hits.length - 1, at + 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (hits[at]) go(hits[at]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    document.body.append(shade);
    draw();
    input.focus();
  }

  /* ------------------------------------------------------------ Keys */
  var KEYS = [
    ['Ctrl + K', 'رفتن سریع به هر گفت‌وگو'],
    ['Alt + ↑ / ↓', 'گفت‌وگوی قبلی / بعدی'],
    ['Ctrl + Tab', 'گفت‌وگوی بعدی (با Shift قبلی)'],
    ['Ctrl + F', 'جستجو در همین گفت‌وگو'],
    ['Ctrl + 0', 'پیام‌های ذخیره‌شده'],
    ['↑ (کادر خالی)', 'ویرایش آخرین پیام خودتان'],
    ['دوبار کلیک روی پیام', 'پاسخ به آن'],
    ['Shift + Enter', 'خط جدید'],
    ['Esc', 'لغو پاسخ/ویرایش، یا بستن گفت‌وگو'],
    ['Ctrl + Shift + M', 'نمایش/پنهان کردن مربع چت از هر جای ویندوز (اپ ویندوز)'],
    ['Ctrl + /', 'همین فهرست']
  ];
  function keysHelp() {
    MP.dialog.open('میانبرهای صفحه‌کلید', el('div', { class: 'keys-list' }, KEYS.map(function (k) {
      return el('div', { class: 'keys-row' }, el('span', { text: k[1] }), el('kbd', { text: k[0], dir: 'ltr' }));
    })));
  }
  if (fine) document.addEventListener('keydown', function (e) {
    if (!chatsView() && !C.chatApp) return;
    var k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && !e.shiftKey && (k === 'k' || k === 'K' || k === 'ک')) { e.preventDefault(); quickSwitch(); return; }
    if (ctrl && (k === '/' || k === '؟')) { e.preventDefault(); keysHelp(); return; }
    if (overlayOpen()) return;
    if ((e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) || (ctrl && (k === 'PageUp' || k === 'PageDown'))) { e.preventDefault(); step(k === 'ArrowDown' || k === 'PageDown' ? 1 : -1); return; }
    if (ctrl && k === 'Tab') { e.preventDefault(); step(e.shiftKey ? -1 : 1); return; }
    if (ctrl && !e.shiftKey && (k === 'f' || k === 'F' || k === 'ب') && MP.openChannel()) { e.preventDefault(); MP.chatDesk.find(); return; }
    if (ctrl && k === '0') { e.preventDefault(); MP.chatDesk.saved(); return; }
    if (k === 'Escape' && !inField(e.target) && MP.openChannel()) { MP.chatDesk.close(); return; }
    // Typing anywhere in an open chat goes to the composer (like Telegram Desktop).
    if (!ctrl && !e.altKey && k.length === 1 && !inField(e.target) && MP.openChannel()) {
      var t = MP.chatDesk.text();
      if (t && !t.disabled && t.offsetParent) {
        e.preventDefault(); t.focus();
        var a = t.selectionStart || t.value.length;
        t.setRangeText(k, a, t.selectionEnd || a, 'end');
        t.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });

  /* ------------------------------------------------------------ Chat list width: drag; very narrow = pictures only */
  var KEY = 'mp_chatlist_w';
  function applyWidth(w) {
    var lay = document.getElementById('chat-layout'); if (!lay) return;
    if (!w) { lay.style.removeProperty('--chatlist-w'); lay.classList.remove('list-narrow', 'list-sized'); return; }
    var narrow = w < 200;
    lay.classList.add('list-sized');
    lay.classList.toggle('list-narrow', narrow);
    lay.style.setProperty('--chatlist-w', (narrow ? 76 : Math.max(240, Math.min(560, w))) + 'px');
  }
  function setupResize() {
    var lay = document.getElementById('chat-layout'), list = document.getElementById('chat-list');
    if (!lay || !list || !fine || lay.querySelector('.cl-grip')) return;
    var grip = el('div', { class: 'cl-grip', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'تغییر عرض فهرست گفت‌وگوها', title: 'برای تغییر عرض بکشید؛ دوبار کلیک: اندازه پیش‌فرض', tabindex: '0' });
    lay.append(grip);
    var saved = 0;
    try { saved = +localStorage.getItem(KEY) || 0; } catch (e) { /* private */ }
    applyWidth(saved);
    function place() { var r = list.getBoundingClientRect(), lr = lay.getBoundingClientRect(); grip.style.right = (lr.right - r.left - 5) + 'px'; }
    place();
    new ResizeObserver(place).observe(list);
    grip.addEventListener('pointerdown', function (e) {
      e.preventDefault(); grip.setPointerCapture(e.pointerId); lay.classList.add('resizing');
      var right = list.getBoundingClientRect().right;
      function move(ev) { saved = Math.round(right - ev.clientX); applyWidth(saved); }
      function up() { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); lay.classList.remove('resizing'); try { localStorage.setItem(KEY, String(saved)); } catch (er) { /* private */ } }
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
    });
    grip.addEventListener('dblclick', function () { saved = 0; applyWidth(0); try { localStorage.removeItem(KEY); } catch (e) { /* private */ } });
    grip.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); saved = (saved || list.offsetWidth) + (e.key === 'ArrowLeft' ? 20 : -20); applyWidth(saved);
      try { localStorage.setItem(KEY, String(saved)); } catch (er) { /* private */ }
    });
  }
  MP.on('view', function (v) { if (v === 'messages') setTimeout(setupResize, 0); });
  if (document.readyState !== 'loading') setTimeout(setupResize, 500); else document.addEventListener('DOMContentLoaded', function () { setTimeout(setupResize, 500); });

  /* ------------------------------------------------------------ The Windows app (WebView2 host) */
  if (C.pop) document.title = 'مربع چت';
  if (!host) { MP.desktop = null; return; }
  function post(o) { try { host.postMessage(o); } catch (e) { /* host gone */ } }
  MP.desktop = { post: post };

  // Unread messages on the taskbar button and the tray icon.
  var origBadges = MP.updateBadges;
  MP.updateBadges = function (c) { origBadges(c); if (C.pop) return; var n = (c || S.boot.counts || {}).messages || 0; post({ t: 'badge', n: n }); };

  // While the window is hidden the host wakes the page every few seconds: news become Windows notifications.
  var lastId = -1, busy = false, focused = true;
  function check() {
    if (busy || C.pop) return; busy = true;
    var u = C.chat && C.chat.feed ? C.chat.feed : '/?mp_push_feed=1&chat=1';
    fetch(u, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (n) {
      busy = false;
      post({ t: 'badge', n: n.count || 0 });
      if (!n.id) return;
      // Hidden, minimised, or behind other windows: a Windows notification (an open chat in front shows it anyway).
      if (lastId >= 0 && n.id > lastId && (document.hidden || !focused)) post({ t: 'notify', id: n.id, title: n.title, body: n.body, channel: n.channel || 0 });
      lastId = Math.max(lastId, n.id);
    }).catch(function () { busy = false; });
  }
  host.addEventListener('message', function (e) {
    var d = e.data || {};
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (er) { d = {}; } }
    if (d.t === 'tick') { check(); if (!document.hidden) MP.refreshCounts(); }
    else if (d.t === 'open' && d.channel) MP.chatDesk.select(+d.channel);
    else if (d.t === 'saved') MP.chatDesk.saved();
    else if (d.t === 'switch') quickSwitch();
    else if (d.t === 'settings') settingsDialog(d.v || {});
    else if (d.t === 'shown') MP.refreshCounts();
    else if (d.t === 'focus') { focused = !!d.on; if (focused) MP.refreshCounts(); }
    else if (d.t === 'panel') window.open(C.panel, '_blank');
    else if (d.t === 'activity') presence(d);
  });
  check();

  /* Automatic attendance: the app reports how long since the last keyboard/mouse input, lock, sleep, wake and
     shutdown (and whether a call keeps the screen on); the site turns that into attendance (MP_Presence). */
  var lastPresent = null;
  function presence(d) {
    fetch(C.root + 'presence', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': C.nonce },
      body: JSON.stringify({ idle: d.idle || 0, locked: d.locked ? 1 : 0, busy: d.busy ? 1 : 0, ev: d.ev || 'tick', device: d.device || '' }) })
      .then(function (r) { return r.json(); }).then(function (st) {
        post({ t: 'presence', on: st.enabled ? 1 : 0, present: st.present ? 1 : 0, since: st.since ? String(st.since).slice(11, 16) : '' });
        if (lastPresent !== null && lastPresent !== !!st.present && MP.loadAttendance) MP.loadAttendance();
        lastPresent = !!st.present;
      }).catch(function () { /* offline: the site ends the session at the last report */ });
  }

  /* The app's own settings (kept by the host in the Windows registry). */
  function settingsDialog(v) {
    function row(key, title, sub) {
      var cb = el('input', { type: 'checkbox', checked: !!v[key] });
      cb.onchange = function () { v[key] = cb.checked ? 1 : 0; post({ t: 'set', k: key, v: v[key] }); };
      return el('label', { class: 'desk-row' }, el('span', null, el('strong', { text: title }), el('small', { text: sub })), cb);
    }
    MP.dialog.open('تنظیمات مربع چت برای ویندوز', el('div', { class: 'desk-set' },
      row('autostart', 'اجرا با روشن شدن ویندوز', 'کنار ساعت و بی‌صدا باز می‌شود تا پیام‌ها را از دست ندهید'),
      row('tray', 'بستن پنجره = رفتن کنار ساعت', 'مثل تلگرام؛ برای خروج کامل از منوی آیکون کنار ساعت «خروج» را بزنید'),
      row('notify', 'اعلان پیام‌های تازه', 'وقتی پنجره پنهان یا کوچک است'),
      row('sound', 'صدای اعلان', 'صدای پیش‌فرض اعلان ویندوز'),
      row('preview', 'نشان دادن متن پیام در اعلان', 'خاموش: فقط «پیام تازه از …»'),
      row('hotkey', 'میانبر Ctrl + Shift + M', 'از هر برنامه‌ای مربع چت را جلو می‌آورد یا پنهان می‌کند'),
      el('p', { class: 'hint', text: 'نسخه برنامه ویندوز: ' + (window.__MP_DESKTOP.v || '') })));
  }
  MP.desktop.settings = function () { post({ t: 'settings?' }); };

  /* The browser's own right-click menu is off in the app; this one covers text and links. */
  document.addEventListener('contextmenu', function (e) {
    if (e.defaultPrevented) return;
    var t = e.target, a = t.closest && t.closest('a[href]'), field = inField(t) ? t : null, sel = String(window.getSelection() || '');
    var img = t.tagName === 'IMG' && !t.closest('.msg-row') ? t : null;
    var items = [];
    if (field) {
      items.push(['clip', 'بریدن', function () { field.focus(); document.execCommand('cut'); }, !field.value || field.selectionStart === field.selectionEnd]);
      items.push(['copy', 'کپی', function () { field.focus(); document.execCommand('copy'); }, !field.value || field.selectionStart === field.selectionEnd]);
      items.push(['file', 'چسباندن', function () { field.focus(); (navigator.clipboard && navigator.clipboard.readText ? navigator.clipboard.readText().then(function (x) { document.execCommand('insertText', false, x); }) : Promise.resolve(document.execCommand('paste'))).catch(function () {}); }]);
      items.push(['checks', 'انتخاب همه', function () { field.focus(); field.select(); }]);
    } else if (sel.trim()) items.push(['copy', 'کپی', function () { document.execCommand('copy'); }]);
    if (a) {
      items.push(['send', 'باز کردن لینک', function () { window.open(a.href, '_blank'); }]);
      items.push(['clip', 'کپی لینک', function () { navigator.clipboard.writeText(a.href).catch(function () {}); }]);
    }
    if (img) items.push(['download', 'ذخیره تصویر', function () { var l = el('a', { href: img.src, download: '' }); document.body.append(l); l.click(); l.remove(); }]);
    e.preventDefault();
    if (!items.length) return;
    var old = document.querySelector('.desk-ctx'); if (old) old.remove();
    var menu = el('div', { class: 'ctx-menu desk-ctx in', role: 'menu' }, items.map(function (it) {
      var b = el('button', { type: 'button', role: 'menuitem', html: icon(it[0]), disabled: it[3] ? '' : null, onmousedown: function (ev) { ev.preventDefault(); }, onclick: function () { menu.remove(); it[2](); } });
      b.append(el('span', { text: it[1] }));
      return b;
    }));
    document.body.append(menu);
    menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, e.clientX - menu.offsetWidth)) + 'px';
    menu.style.top = Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, e.clientY)) + 'px';
    setTimeout(function () {
      function out(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', out, true); } }
      document.addEventListener('pointerdown', out, true);
    }, 0);
  });
})();
