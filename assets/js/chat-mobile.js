/*
 * «مربع چت» on a phone (the Android app, and the web app installed on an iPhone or Android home screen), shaped
 * like Telegram's own phone apps:
 * - Android: a top bar (☰ drawer, the title that says «در حال اتصال…» / «در انتظار شبکه…», search), folder tabs
 *   with unread numbers, the round ✎ button for a new message, the drawer opens with a swipe from the edge;
 * - iPhone: a centred title with the ✎ button, the search field on top, and the tab bar at the bottom
 *   (مخاطبین · گفت‌وگوها · تنظیمات) with the unread number;
 * - contacts (colleagues with online / «در تماس» / last seen, a tap for a private chat, a call button);
 * - settings, the drawer and these pages close with the phone's back button;
 * - photos, files and text shared from other apps (Android app: the share sheet; installed web app: the manifest's
 *   share_target) go into a chat; the unread number on the app icon; a short first-run tour.
 * Everything else (swipe a chat for mute / pin / archive, long press, swipe a message to reply, swipe back from a
 * chat, passcode with fingerprint / Face ID) lives in messages.js and chat-shell.js and works the same here.
 */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, C = window.MP_CONFIG || {}, el = MP.el, $ = MP.$, $$ = MP.$$, fa = MP.fa, icon = MP.icon;
  var UA = navigator.userAgent;
  var IOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
  var APP = window.MorabaApp || null;
  var FINE = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  function appCall(fn) { if (!APP || typeof APP[fn] !== 'function') return undefined; try { return APP[fn].apply(APP, [].slice.call(arguments, 1)); } catch (e) { return undefined; } }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function wanted() {
    var b = document.body, w = window.innerWidth;
    return b.classList.contains('chat-app') && !b.classList.contains('chat-pop') && !(w >= 861 && (FINE || w >= 1024));
  }
  var built = false, booted = false;
  function sync() {
    var on = wanted(), b = document.body;
    if (b.classList.contains('tgm') !== on) {
      b.classList.toggle('tgm', on);
      document.documentElement.classList.toggle('tgm-ios', on && IOS);
      document.documentElement.classList.toggle('tgm-and', on && !IOS);
      if (MP.themeToHost) MP.themeToHost();
    }
    if (on && !built) build();
    if (on) { drawHead(); drawTabs(); }
  }

  /* ------------------------------------------------------------ Top bar */

  var head, fab, tabs;
  function title() {
    if (!navigator.onLine) return ['در انتظار شبکه…', true];
    if (MP.connState === 'connecting') return ['در حال اتصال…', true];
    if (!booted && C.chatApp) return ['در حال به‌روزرسانی…', true];
    return ['مربع چت', false];
  }
  function btn(ico, label, fn, cls) { return el('button', { type: 'button', class: 'icon-btn tgm-hbtn' + (cls ? ' ' + cls : ''), 'aria-label': label, title: label, html: icon(ico), onclick: fn }); }
  function fill(node, kids) { node.replaceChildren.apply(node, kids.filter(Boolean)); }
  /** Telegram (2025): a large title at the start, ⋮ (the menu) at the end; «در حال اتصال…» in its place. */
  function drawHead() {
    if (!head) return;
    var t = title();
    fill(head, [
      el('div', { class: 'tgm-title' + (t[1] ? ' busy' : ''), role: 'status' }, el('strong', { text: t[0] }), t[1] ? el('i', { class: 'tgm-spin' }) : null),
      MP.hasLock && MP.hasLock() ? btn('lock-key', 'قفل کردن', function () { MP.lockNow(); }, 'tgm-lockb') : null,
      IOS ? btn('edit', 'پیام جدید', function () { MP.chatDesk.newDirect(); }) : null,
      btn('more', 'منو', function () { MP.tgDrawer(); }, 'tgm-burger')
    ]);
  }

  /* ------------------------------------------------------------ The floating tab bar, the ✎ button */

  function unread() { return S.boot && S.boot.counts ? +S.boot.counts.messages || 0 : 0; }
  function activeTab() {
    var m = $('.tg-modal[open]');
    if (m) return 'settings';
    var pg = $$('.tgm-page[data-tab]:not(.out)').pop();
    return pg ? pg.dataset.tab : 'chats';
  }
  /** Leave whatever tab page is open (each closes its own history layer). */
  function closeTabs() {
    var m = $('.tg-modal[open]'); if (m) m.close();
    $$('.tgm-page[data-tab]:not(.out)').forEach(function (p) { if (p._close) p._close(); });
  }
  var TABS = {
    chats: function () { if (MP.chatDesk.current()) MP.chatDesk.close(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    contacts: function () { MP.contacts(); },
    settings: function () { MP.tgSettings(); },
    profile: function () { MP.myProfile(); }
  };
  function openTab(name) {
    var cur = activeTab();
    MP.haptic(8);
    if (cur === name) { if (name === 'chats') TABS.chats(); return; }
    closeTabs();
    if (name !== 'chats') setTimeout(TABS[name], 30);
  }
  MP.mobileTab = openTab;
  function drawTabs() {
    var n = unread(), on = activeTab();
    if (tabs) {
      var me = S.me;
      fill(tabs, [
        tab('chats', 'chat', 'گفت‌وگوها', on, n),
        tab('contacts', 'user-circle', 'مخاطبین', on),
        tab('settings', 'settings', 'تنظیمات', on),
        me ? el('button', { type: 'button', class: 'tgm-tab' + (on === 'profile' ? ' on' : ''), 'aria-current': on === 'profile' ? 'page' : null, onclick: function () { openTab('profile'); } },
          el('span', { class: 'tgm-tico tgm-tme' }, MP.avatar(me, 'sm')), el('small', { text: 'پروفایل' })) : null
      ]);
      document.body.classList.toggle('tgm-root', on === 'chats');
    }
    // the number on the app's icon (installed web app; the Android app's comes with its notifications)
    if (navigator.setAppBadge && !APP) { try { (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(function () {}); } catch (e) { /* unsupported */ } }
  }
  function tab(id, ico, text, on, n) {
    return el('button', { type: 'button', class: 'tgm-tab' + (on === id ? ' on' : ''), 'aria-current': on === id ? 'page' : null, onclick: function () { openTab(id); } },
      el('span', { class: 'tgm-tico', html: icon(ico) }, n ? el('i', { class: 'tgm-tbadge', text: n > 99 ? '۹۹+' : fa(n) }) : null), el('small', { text: text }));
  }

  function build() {
    built = true;
    var view = $('#view-messages');
    if (!view) return;
    head = el('header', { class: 'tgm-head', id: 'tgm-head' });
    view.prepend(head);
    tabs = el('nav', { class: 'tgm-tabs', id: 'tgm-tabs', 'aria-label': 'بخش‌ها' });
    document.body.append(tabs);
    // tab pages and settings come and go: the bar follows
    new MutationObserver(function () { drawTabs(); }).observe(document.body, { childList: true });
    if (!IOS) {
      fab = el('button', { type: 'button', class: 'tgm-fab', id: 'tgm-fab', 'aria-label': 'پیام جدید', title: 'پیام جدید', html: icon('edit'), onclick: function () { MP.haptic(8); MP.chatDesk.newDirect(); } });
      document.body.append(fab);
      var lastY = 0;
      window.addEventListener('scroll', function () {
        var y = window.scrollY;
        if (Math.abs(y - lastY) > 6) { fab.classList.toggle('away', y > lastY && y > 80); lastY = y; }
      }, { passive: true });
      edgeDrawer();
    }
  }

  /** Android: a swipe from the screen's right edge (the drawer's side) over the chat list opens the drawer. */
  function edgeDrawer() {
    var st = null;
    document.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      if (!document.body.classList.contains('tgm') || document.body.classList.contains('chat-full') || $('.tg-drawer') || $('.tgm-page') || $('.tg-modal[open]') || MP.isLocked && MP.isLocked()) return;
      if (t.clientX < window.innerWidth - 22) return;
      st = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!st) return;
      var t = e.touches[0], dx = st.x - t.clientX, dy = Math.abs(t.clientY - st.y);
      if (dy > 30) { st = null; return; }
      if (dx > 40) { st = null; MP.haptic(8); MP.tgDrawer(); }
    }, { passive: true });
    document.addEventListener('touchend', function () { st = null; }, { passive: true });
  }

  /* ------------------------------------------------------------ Tab pages (contacts, profile) */

  /** A page over the chat list, under the tab bar; the phone's back button returns to the chats. */
  function page(titleText, tabId, build) {
    var layer = null;
    var body = el('div', { class: 'tgm-pbody' });
    var p = el('section', { class: 'tgm-page', role: 'region', 'aria-label': titleText, dataset: { tab: tabId } },
      el('header', { class: 'tgm-phead' }, el('strong', { text: titleText }), el('span', { class: 'tgm-hgap' })), body);
    function close(fromHistory) {
      if (!p.isConnected || p.classList.contains('out')) return;
      if (layer && fromHistory !== true) MP.popLayer(layer);
      layer = null;
      p.classList.add('out');
      drawTabs();
      setTimeout(function () { p.remove(); }, 200);
    }
    p._close = close;
    document.body.append(p);
    layer = MP.pushLayer(function () { close(true); });
    build(body, close);
    MP.emojify(body);
    return close;
  }
  function card(kids, title) { return el('section', { class: 'tgm-card' }, title ? el('h4', { text: title }) : null, kids); }
  function crow(ico, text, fn, cls) {
    return el('button', { type: 'button', class: 'tgm-row', onclick: fn }, el('span', { class: 'tgm-rico ' + (cls || ''), html: icon(ico) }), el('span', { text: text }));
  }

  MP.contacts = function () {
    if (activeTab() === 'contacts') return;
    page('مخاطبین', 'contacts', function (b, close) {
      var q = el('input', { type: 'search', class: 'tgm-psearch', placeholder: 'جستجوی همکار…', 'aria-label': 'جستجوی همکار', autocomplete: 'off' });
      var list = el('div', { class: 'tgm-clist' });
      function seen(u) { return S.seen && S.seen[u.id] ? S.seen[u.id] : 0; }
      function draw() {
        var v = MP.norm(q.value);
        var people = (S.users || []).filter(function (u) { return u.id !== S.me.id && (!v || MP.norm(u.name + ' ' + (u.title || '')).indexOf(v) >= 0); });
        people.sort(function (a, c) { return (MP.isOnline(c.id) - MP.isOnline(a.id)) || seen(c) - seen(a) || String(a.name).localeCompare(String(c.name), 'fa'); });
        fill(list, people.length ? people.map(function (u) {
          var on = MP.isOnline(u.id), st = MP.lastSeenOf(u.id);
          return el('div', { class: 'tgm-crow' },
            el('button', { type: 'button', class: 'tgm-cmain', onclick: function () { close(); setTimeout(function () { MP.startDirect(u.id); }, 60); } },
              el('span', { class: 'tgm-cav' + (on ? ' on' : '') }, MP.avatar(u, 'md')),
              el('span', { class: 'tgm-ccopy' }, el('strong', { text: u.name }), el('small', { class: on || MP.statusOf(u.id) ? 'hot' : '', text: st + (u.title ? ' · ' + u.title : '') }))),
            MP.call ? btn('phone', 'تماس صوتی با ' + u.name, function () { close(); MP.call(u.id, false); }, 'tgm-ccall') : null);
        }) : [el('p', { class: 'tg-hint', text: 'همکاری پیدا نشد.' })]);
      }
      q.oninput = function () { quick.hidden = !!q.value; draw(); };
      draw();
      MP.on('live', function () { if (b.isConnected && !q.value) draw(); });
      var quick = card([
        crow('chat', 'پیام جدید', function () { close(); setTimeout(function () { MP.chatDesk.newDirect(); }, 60); }, 'c-blue'),
        S.manager ? crow('users', 'گروه تیم جدید', function () { close(); setTimeout(function () { var x = $('#new-team-group'); if (x) x.click(); }, 60); }, 'c-green') : null,
        crow('user', 'گروه مشتری جدید', function () { close(); setTimeout(function () { var x = $('#new-client-group'); if (x) x.click(); }, 60); }, 'c-orange')
      ].filter(Boolean));
      b.append(q, quick, card([list], 'به ترتیب آخرین بازدید'));
    });
  };

  /** «پروفایل» (Telegram's new profile tab): photo, name, status, actions, details. */
  MP.myProfile = function () {
    if (activeTab() === 'profile') return;
    page('پروفایل', 'profile', function (b, close) {
      var me = S.me, a = S.attendance && S.attendance.open;
      var later = function (fn) { return function () { close(); setTimeout(fn, 60); }; };
      b.append(
        el('div', { class: 'tgm-hero' },
          el('button', { type: 'button', class: 'tgm-hero-av', 'aria-label': 'عکس پروفایل', onclick: later(function () { MP.openProfile(me.id); }) }, MP.avatar(me, 'xl')),
          el('strong', { text: me.name }),
          el('small', { text: a ? (a.auto ? 'حاضر (خودکار) از ' : 'حاضر از ') + MP.timeFa(a.check_in || '') : 'آنلاین' })),
        el('div', { class: 'tgm-acts' },
          el('button', { type: 'button', onclick: later(function () { MP.openProfile(me.id); }) }, el('span', { html: icon('camera') }), el('small', { text: 'عکس' })),
          el('button', { type: 'button', onclick: later(function () { MP.openProfile(me.id); }) }, el('span', { html: icon('edit') }), el('small', { text: 'ویرایش' })),
          el('button', { type: 'button', onclick: function () { openTab('settings'); } }, el('span', { html: icon('settings') }), el('small', { text: 'تنظیمات' }))),
        card([
          me.title ? el('div', { class: 'tgm-info' }, el('b', { text: me.title }), el('small', { text: 'سمت' })) : null,
          S.boot.email ? el('div', { class: 'tgm-info' }, el('b', { text: S.boot.email, dir: 'ltr' }), el('small', { text: 'ایمیل' })) : null,
          el('div', { class: 'tgm-info' }, el('b', { text: a ? 'حاضر' : 'ثبت نشده' }), el('small', { text: 'حضور امروز' }))
        ].filter(Boolean)),
        card([
          crow('bookmark', 'پیام‌های ذخیره‌شده', later(function () { MP.chatDesk.saved(); }), 'c-sky'),
          crow('video', 'جلسه‌ها', later(function () { MP.showView('meetings'); }), 'c-purple'),
          crow('clock', 'حضور و مرخصی', later(function () { MP.showView('attendance'); }), 'c-green')
        ]));
    });
  };

  /* ------------------------------------------------------------ Shared from other apps */

  function fromApp() {
    var info = null;
    try { info = JSON.parse(appCall('shared') || 'null'); } catch (e) { info = null; }
    if (!info) return Promise.resolve(null);
    return Promise.all((info.files || []).map(function (f, i) {
      return fetch(location.origin + '/__mp_share/' + i, { cache: 'no-store' }).then(function (r) { return r.blob(); }).then(function (bl) { return new File([bl], f.name || 'file', { type: f.type || bl.type }); });
    })).then(function (files) { appCall('clearShared'); return { files: files, text: info.text || '' }; });
  }
  function fromCache() {
    if (!window.caches) return Promise.resolve(null);
    return caches.open('mp-share').then(function (c) {
      return c.match('/__mp_share/meta').then(function (m) {
        if (!m) return null;
        return m.json().then(function (meta) {
          var all = [];
          for (var i = 0; i < meta.n; i++) {
            all.push(c.match('/__mp_share/' + i).then(function (r) {
              if (!r) return null;
              var name = decodeURIComponent(r.headers.get('X-Name') || 'file'), type = r.headers.get('Content-Type') || '';
              return r.blob().then(function (bl) { return new File([bl], name, { type: type }); });
            }));
          }
          return Promise.all(all).then(function (files) {
            return c.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return c.delete(k); })); }).then(function () { return { files: files.filter(Boolean), text: meta.text || '' }; });
          });
        });
      });
    }).catch(function () { return null; });
  }
  function putText(text) {
    var t = $('#composer-text');
    if (!t) return;
    t.value = (t.value ? t.value + '\n' : '') + text;
    t.dispatchEvent(new Event('input', { bubbles: true }));
    t.focus();
  }
  /** Whatever another app shared into «مربع چت»: files go through the usual send sheet, text into the composer. */
  MP.takeShared = function () {
    (APP && typeof APP.shared === 'function' ? fromApp() : fromCache()).then(function (x) {
      if (!x || (!x.files.length && !x.text)) return;
      if (x.files.length) { MP.chatDesk.send(x.files); return; }
      MP.chatDesk.pick('ارسال به…', function (id) { MP.chatDesk.select(id); setTimeout(function () { putText(x.text); }, 700); });
    }).catch(MP.soft);
  };

  /* ------------------------------------------------------------ First run: what to do with your thumbs */

  MP.mobileTour = function () {
    if (read('mp_tour_done')) return;
    var steps = [
      ['.chat-tabs', 'پوشه‌ها', 'گفت‌وگوها دسته‌بندی شده‌اند؛ پوشه‌های خودتان را هم از تنظیمات بسازید.'],
      [IOS ? '#tgm-head .icon-btn:last-child' : '#tgm-fab', 'پیام جدید', IOS ? 'گفت‌وگوی خصوصی تازه؛ همکاران و وضعیتشان در «مخاطبین» پایین صفحه است.' : 'گفت‌وگوی خصوصی تازه؛ با کشیدن از لبه راست صفحه یا ☰ منو باز می‌شود.'],
      ['#chat-list .cs-wrap', 'کشیدن گفت‌وگو', 'گفت‌وگو را به چپ بکشید: بی‌صدا، سنجاق و بایگانی. نگه دارید تا پیش‌نمایش ببینید.'],
      [null, 'داخل گفت‌وگو', 'پیام را به راست بکشید تا پاسخ دهید، نگه دارید برای منو و واکنش، دوبار بزنید برای ❤️. از لبه چپ به راست بکشید تا برگردید.']
    ];
    var i = 0, tip = null;
    function end() { store('mp_tour_done', '1'); if (tip) tip.remove(); $$('.tour-on').forEach(function (e) { e.classList.remove('tour-on'); }); }
    function show() {
      $$('.tour-on').forEach(function (e) { e.classList.remove('tour-on'); });
      if (tip) tip.remove();
      if (i >= steps.length) { end(); return; }
      var t = steps[i][0] && $(steps[i][0]);
      if (t && t.offsetParent) t.classList.add('tour-on');
      tip = el('div', { class: 'tour-tip tgm-tip', role: 'dialog', 'aria-label': steps[i][1] },
        el('strong', { text: steps[i][1] }), el('p', { text: steps[i][2] }),
        el('div', { class: 'tour-acts' }, el('small', { text: fa(i + 1) + ' از ' + fa(steps.length) }),
          el('button', { type: 'button', class: 'link', text: 'بعداً', onclick: end }),
          el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: i === steps.length - 1 ? 'شروع' : 'بعدی', onclick: function () { i++; show(); } })));
      document.body.append(tip);
    }
    show();
  };

  /* ------------------------------------------------------------ Keep it current */

  MP.on('conn', drawHead);
  MP.on('lockcfg', drawHead);
  MP.on('booted', function () { booted = true; drawHead(); drawTabs(); });
  MP.on('chatlist', drawTabs);
  MP.on('live', function () { if (tabs) drawTabs(); });
  MP.on('view', function () { setTimeout(sync, 0); });
  window.addEventListener('online', drawHead);
  window.addEventListener('offline', drawHead);
  window.addEventListener('resize', function () { if (document.body.classList.contains('tgm') !== wanted()) sync(); });
  // the page was already loaded when the Android app received a share
  window.__mpShared = function () { if (MP.takeShared) MP.takeShared(); };
  // without the quick start (first time on this phone) the title stops saying «در حال به‌روزرسانی…» once loaded
  setTimeout(function () { if (!booted && !document.body.classList.contains('is-loading')) { booted = true; drawHead(); } }, 5000);
  if (document.readyState !== 'loading') sync(); else document.addEventListener('DOMContentLoaded', sync);
})();
