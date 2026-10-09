/*
 * «مربع چت» on a computer, shaped like Telegram Desktop:
 * - a folder rail beside the chat list (all, unread, private, groups, project folders, clients) with unread
 *   numbers, Ctrl+1…9 to jump between folders;
 * - the ☰ drawer: who I am (and whether attendance has me present), new chat/group, saved, archive, meetings,
 *   attendance, the panel, settings, night mode, version;
 * - Telegram-style settings in pages: notifications and sounds, chat settings (theme: day / night / tinted night /
 *   follow Windows, accent colour, default wallpaper, bubble colour, text size), advanced (the Windows app's own
 *   switches, animations) and the interface scale (100%…200%; in the Windows app the whole window zooms);
 * - the Windows title bar follows the theme.
 * The shell only shows in the chat app on a screen wider than a phone with a mouse; settings work everywhere.
 */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, C = window.MP_CONFIG || {}, el = MP.el, $ = MP.$, fa = MP.fa, icon = MP.icon;
  var FINE = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  var host = window.chrome && window.chrome.webview && window.__MP_DESKTOP ? window.chrome.webview : null;
  function post(o) { if (host) { try { host.postMessage(o); } catch (e) { /* host gone */ } } }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  if (host && window.__MP_DESKTOP.mica) document.documentElement.classList.add('mica');

  /* ------------------------------------------------------------ Interface scale */

  var SCALES = [1, 1.1, 1.25, 1.5, 1.75, 2];
  function scale() { return +read('mp_scale') || 1; }
  MP.setScale = function (z) {
    z = Math.max(0.8, Math.min(2, Math.round(z * 100) / 100));
    store('mp_scale', z === 1 ? null : String(z));
    var r = document.documentElement;
    if (host) { r.style.zoom = ''; r.style.removeProperty('--z'); post({ t: 'zoom', v: z }); }
    else if (z === 1) { r.style.zoom = ''; r.style.removeProperty('--z'); }
    else { r.style.zoom = String(z); r.style.setProperty('--z', String(z)); }
    MP.emit('scale', z);
  };
  if (host) post({ t: 'zoom', v: scale() }); // the app keeps the same zoom for its next start
  function stepScale(d) {
    var z = scale(), i = SCALES.indexOf(z);
    if (i < 0) i = SCALES.filter(function (x) { return x < z; }).length - (d > 0 ? 1 : 0);
    var n = SCALES[Math.max(0, Math.min(SCALES.length - 1, i + d))];
    MP.setScale(n);
    MP.toast('مقیاس رابط: ' + fa(Math.round(n * 100)) + '٪');
  }

  /* ------------------------------------------------------------ Theme → the Windows title bar */

  function themeToHost() {
    if (!host) return;
    var cs = getComputedStyle(document.documentElement);
    post({ t: 'theme', dark: document.documentElement.classList.contains('dark') ? 1 : 0, bg: cs.getPropertyValue('--surface').trim(), ink: cs.getPropertyValue('--ink').trim() });
  }
  MP.on('theme', function () { setTimeout(themeToHost, 0); });

  /* ------------------------------------------------------------ The Telegram-style shell */

  var FOLDER_ICONS = { all: 'chat', unread: 'checks', direct: 'user', group: 'users', project: 'folder', client: 'leave' };
  function wanted() {
    var b = document.body;
    return b.classList.contains('chat-app') && !b.classList.contains('chat-pop') && FINE && window.innerWidth >= 861;
  }
  function sync() {
    var on = wanted();
    document.body.classList.toggle('tg', on);
    if (on) drawRail();
  }
  function drawRail() {
    var lay = $('#chat-layout');
    if (!lay || !document.body.classList.contains('tg')) return;
    var rail = $('#tg-rail');
    if (!rail) { rail = el('nav', { id: 'tg-rail', class: 'tg-rail', 'aria-label': 'پوشه‌های گفت‌وگو' }); lay.prepend(rail); }
    if (!MP.chatDesk || !MP.chatDesk.folders || !S.channels) return;
    var cur = MP.chatDesk.folder(), fs = MP.chatDesk.folders();
    var dot = S.boot && S.boot.counts && S.boot.counts.notifications;
    rail.replaceChildren(
      el('button', { type: 'button', class: 'tg-burger', title: 'منو', 'aria-label': 'منو', onclick: openDrawer }, MP.iconEl('menu'), dot ? el('i', { class: 'tg-dot' }) : null),
      el('div', { class: 'tg-folders', role: 'tablist' }, fs.map(function (f, i) {
        var ico = FOLDER_ICONS[f.id] || 'folder';
        return el('button', { type: 'button', role: 'tab', class: 'tg-folder' + (f.id === cur ? ' on' : ''), 'aria-selected': String(f.id === cur), title: f.title + (i < 9 ? '  (Ctrl+' + (i + 1) + ')' : ''), onclick: function () { MP.chatDesk.folder(f.id); } },
          el('span', { class: 'tg-fico', html: icon(ico) }), el('small', { text: f.title }),
          f.unread && f.id !== 'unread' ? el('i', { class: 'tg-badge', text: f.unread > 99 ? '۹۹+' : fa(f.unread) }) : null);
      })),
      el('div', { class: 'tg-rail-foot' },
        lockCfg() ? el('button', { type: 'button', class: 'tg-folder', title: 'قفل کردن  (Ctrl+L)', onclick: function () { lock(); } }, el('span', { class: 'tg-fico', html: icon('lock-key') }), el('small', { text: 'قفل' })) : null,
        el('button', { type: 'button', class: 'tg-folder', title: 'پیام‌های ذخیره‌شده  (Ctrl+0)', onclick: function () { MP.chatDesk.saved(); } }, el('span', { class: 'tg-fico', html: icon('bookmark') }), el('small', { text: 'ذخیره' })),
        el('button', { type: 'button', class: 'tg-folder', title: 'تنظیمات', onclick: function () { MP.tgSettings(); } }, el('span', { class: 'tg-fico', html: icon('settings') }), el('small', { text: 'تنظیمات' }))));
  }
  MP.on('chatlist', drawRail);
  MP.on('view', function () { setTimeout(sync, 0); });
  window.addEventListener('resize', function () { if (document.body.classList.contains('tg') !== wanted()) sync(); });

  /* ------------------------------------------------------------ The ☰ drawer */

  var drawer = null;
  function closeDrawer() {
    if (!drawer) return;
    var d = drawer; drawer = null;
    d[0].classList.remove('in'); d[1].classList.remove('in');
    document.removeEventListener('keydown', drawerKey, true);
    setTimeout(function () { d[0].remove(); d[1].remove(); }, 200);
  }
  function drawerKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDrawer(); } }
  function presenceLine() {
    var a = S.attendance, o = a && a.open;
    if (!o) return '';
    return (o.auto ? 'حاضر (خودکار) از ' : 'حاضر از ') + MP.timeFa(o.check_in || '');
  }
  function version() { return host ? (window.__MP_DESKTOP.v || '') : (C.version || ''); }
  function openDrawer() {
    if (drawer) { closeDrawer(); return; }
    var me = S.me;
    function item(ico, text, fn, kbd) {
      return el('button', { type: 'button', class: 'tg-ditem', onclick: function () { closeDrawer(); fn(); } }, el('span', { class: 'tg-dico', html: icon(ico) }), el('span', { text: text }), kbd ? el('kbd', { text: kbd, dir: 'ltr' }) : null);
    }
    function click(sel) { var b = $(sel); if (b) b.click(); }
    var night = el('input', { type: 'checkbox', role: 'switch', checked: MP.isDarkTheme(), 'aria-label': 'حالت شب' });
    night.onchange = function () { var p = S.boot.prefs; p.auto = false; p.dark = night.checked; MP.savePrefs(); };
    var pres = presenceLine();
    var shade = el('div', { class: 'tg-shade', onclick: closeDrawer });
    var d = el('aside', { class: 'tg-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'منوی مربع چت' },
      el('button', { type: 'button', class: 'tg-dhead', onclick: function () { closeDrawer(); MP.openProfile(me.id); } }, MP.avatar(me, 'lg'),
        el('span', { class: 'tg-dwho' }, el('strong', { text: me.name }), el('small', { text: me.title || S.boot.email || '' }), pres ? el('small', { class: 'tg-pres', text: pres }) : null)),
      el('nav', { class: 'tg-dmenu' },
        item('chat', 'پیام جدید', function () { click('#new-dm'); }),
        S.manager ? item('users', 'گروه تیم جدید', function () { click('#new-team-group'); }) : null,
        item('user', 'گروه مشتری جدید', function () { click('#new-client-group'); }),
        item('bookmark', 'پیام‌های ذخیره‌شده', function () { MP.chatDesk.saved(); }, 'Ctrl+0'),
        item('folder', 'بایگانی', function () { MP.chatDesk.archive(); }),
        el('hr'),
        item('video', 'جلسه‌ها', function () { MP.showView('meetings'); }),
        item('clock', 'حضور و مرخصی', function () { MP.showView('attendance'); }),
        item('grid', 'پنل مربع', function () { window.open(C.panel, '_blank'); }),
        el('hr'),
        lockCfg() ? item('lock-key', 'قفل کردن', lock, 'Ctrl+L') : null,
        item('settings', 'تنظیمات', function () { MP.tgSettings(); }),
        item('help', 'میان‌برهای صفحه‌کلید', function () { if (MP.keysHelp) MP.keysHelp(); }, 'Ctrl+/'),
        el('label', { class: 'tg-ditem tg-dswitch' }, el('span', { class: 'tg-dico', html: icon('moon') }), el('span', { text: 'حالت شب' }), el('span', { class: 'switch' }, night, el('i')))),
      el('div', { class: 'tg-dfoot' }, el('b', { text: host ? 'مربع چت برای ویندوز' : 'مربع چت' }),
        el('button', { type: 'button', class: 'link', text: 'نسخه ' + MP.faDigits(version()) + ' – درباره', onclick: function () { closeDrawer(); about(); } })));
    document.body.append(shade, d);
    drawer = [shade, d];
    document.addEventListener('keydown', drawerKey, true);
    requestAnimationFrame(function () { shade.classList.add('in'); d.classList.add('in'); });
    var first = d.querySelector('.tg-ditem'); if (first) first.focus({ preventScroll: true });
  }
  MP.tgDrawer = openDrawer;
  function about() {
    MP.dialog.open('درباره مربع چت', el('div', { class: 'tg-about' },
      el('img', { src: C.assets + 'img/chat-192.png', alt: '' }),
      el('strong', { text: 'مربع چت' }),
      el('small', { text: (host ? 'برنامه ویندوز نسخه ' + MP.faDigits(version()) + ' · ' : '') + 'پنل مربع نسخه ' + MP.faDigits(C.version || '') }),
      el('p', { text: 'گفت‌وگوی تیم، پروژه‌ها و مشتری‌های استودیو مربع؛ با اعلان، پاسخ از داخل اعلان، پنجره جدا برای هر گفت‌وگو و حضور خودکار.' }),
      el('div', { class: 'dialog-actions' }, el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('help') + 'میان‌برهای صفحه‌کلید', onclick: function () { MP.dialog.close(); if (MP.keysHelp) MP.keysHelp(); } }))), { focus: false });
  }

  /* ------------------------------------------------------------ Settings, in pages (Telegram Desktop) */

  var modal = null, stack = [];
  function sw(on, fn, label) {
    var cb = el('input', { type: 'checkbox', role: 'switch', checked: !!on, 'aria-label': label || '' });
    cb.onchange = function () { fn(cb.checked); };
    return el('span', { class: 'switch' }, cb, el('i'));
  }
  function row(ico, title, sub, opts) {
    opts = opts || {};
    var tag = opts.end ? 'label' : 'button';
    return el(tag, { type: tag === 'button' ? 'button' : null, class: 'tg-srow' + (opts.danger ? ' danger' : ''), onclick: opts.onclick || null },
      el('span', { class: 'tg-sico', html: icon(ico) }),
      el('span', { class: 'tg-scopy' }, el('b', { text: title }), sub ? el('small', { text: sub }) : null),
      opts.end || (opts.value ? el('span', { class: 'tg-sval', text: opts.value }) : null));
  }
  function sec(title) { var s = el('section', { class: 'tg-ssec' }); if (title) s.append(el('h4', { text: title })); return s; }
  function show(title, build) {
    if (!modal) {
      modal = el('dialog', { class: 'tg-modal', 'aria-label': 'تنظیمات' });
      modal.addEventListener('close', function () { modal.remove(); modal = null; stack = []; });
      modal.addEventListener('click', function (e) { if (e.target === modal) modal.close(); });
      document.body.append(modal);
      modal.showModal();
    }
    var body = el('div', { class: 'tg-mbody' });
    modal.replaceChildren(
      el('header', { class: 'tg-mhead' },
        stack.length > 1 ? el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'بازگشت', html: icon('right'), onclick: back }) : null,
        el('h2', { text: title }),
        el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'بستن', html: icon('close'), onclick: function () { modal.close(); } })),
      body);
    build(body);
    MP.emojify(body);
  }
  function go(page, arg) { stack.push([page, arg]); PAGES[page](arg); }
  function back() { stack.pop(); var top = stack[stack.length - 1]; if (top) PAGES[top[0]](top[1]); else modal.close(); }
  function closeFor(fn) { return function () { if (modal) modal.close(); fn(); }; }

  var PAGES = {
    home: function () {
      show('تنظیمات', function (b) {
        var me = S.me;
        b.append(
          el('button', { type: 'button', class: 'tg-me', onclick: closeFor(function () { MP.openProfile(me.id); }) }, MP.avatar(me, 'xl'),
            el('span', null, el('strong', { text: me.name }), el('small', { class: 'online', text: presenceLine() || 'آنلاین' }), el('small', { text: me.title || S.boot.email || '' }))),
          (function () {
            var s = sec();
            s.append(
              row('user', 'ویرایش پروفایل', 'عکس، نام، سمت', { onclick: closeFor(function () { MP.openProfile(me.id); }) }),
              row('bell', 'اعلان‌ها و صداها', host ? 'اعلان ویندوز، صدا، پیش‌نمایش' : 'اعلان مرورگر', { onclick: function () { go('notify'); } }),
              row('lock-key', 'حریم خصوصی و امنیت', lockCfg() ? 'رمز محلی روشن است' : 'رمز محلی، قفل خودکار', { onclick: function () { go('privacy'); } }),
              row('folder', 'پوشه‌های گفت‌وگو', (S.chatFolders || []).length ? MP.fa((S.chatFolders || []).length) + ' پوشه' : 'گفت‌وگوها را دسته‌بندی کنید', { onclick: function () { go('folders'); } }),
              row('palette', 'تنظیمات گفت‌وگو', 'تم، رنگ، پس‌زمینه، اندازه متن', { onclick: function () { go('chat'); } }),
              row('monitor', 'پیشرفته', host ? 'یکپارچگی با ویندوز، کارایی' : 'کارایی', { onclick: function () { go('advanced'); } }),
              row('edit', 'حساب کاربری', 'ایمیل، تلگرام، بله، پیامک', { onclick: closeFor(function () { MP.openAccount(); }) }),
              row('help', 'میان‌برهای صفحه‌کلید', '', { onclick: closeFor(function () { if (MP.keysHelp) MP.keysHelp(); }) }),
              row('info', 'درباره مربع چت', '', { onclick: closeFor(about), value: MP.faDigits(version()) }));
            return s;
          })(),
          scaleSec());
      });
    },
    notify: function () {
      show('اعلان‌ها و صداها', function (b) {
        var s = sec('اعلان‌های پیام');
        b.append(s);
        if (host) {
          s.append(MP.skeleton(2));
          MP.desktop.ask(function (v) {
            s.replaceChildren(el('h4', { text: 'اعلان‌های پیام' }),
              row('bell', 'اعلان پیام‌های تازه', 'وقتی پنجره پنهان، کوچک یا پشت برنامه‌های دیگر است', { end: sw(v.notify, function (on) { MP.desktop.set('notify', on); }) }),
              row('speaker', 'صدای اعلان', 'صدای پیش‌فرض اعلان ویندوز', { end: sw(v.sound, function (on) { MP.desktop.set('sound', on); }) }),
              row('eye', 'نشان دادن متن پیام', 'خاموش: فقط «پیام تازه از …»', { end: sw(v.preview, function (on) { MP.desktop.set('preview', on); }) }),
              el('p', { class: 'tg-hint', text: 'در خود اعلان می‌توانید پاسخ بنویسید یا «خوانده شد» بزنید. «مزاحم نشو» (یک ساعت، هشت ساعت، تا فردا صبح) در منوی آیکون کنار ساعت است.' }));
          });
        } else {
          var perm = window.Notification ? Notification.permission : 'unsupported';
          s.append(row('bell', 'اعلان مرورگر', perm === 'granted' ? 'روشن است' : perm === 'denied' ? 'در تنظیمات مرورگر بسته شده' : 'هنوز اجازه داده نشده',
            { onclick: perm === 'default' ? function () { Notification.requestPermission().then(function () { PAGES.notify(); }); } : null, value: perm === 'default' ? 'روشن کردن' : '' }));
        }
        var muted = (S.channels || []).filter(function (c) { return c.muted; });
        b.append(el('p', { class: 'tg-hint', text: muted.length ? fa(muted.length) + ' گفت‌وگو بی‌صداست؛ برای هر گفت‌وگو از ستون اطلاعات آن، اعلان را روشن یا خاموش کنید.' : 'برای هر گفت‌وگو جداگانه هم می‌توانید از ستون اطلاعات آن، اعلان را خاموش کنید.' }));
      });
    },
    chat: function () {
      show('تنظیمات گفت‌وگو', function (b) {
        var p = S.boot.prefs;
        var THEMES = [
          ['day', 'روز', { dark: false, tint: false, auto: false }],
          ['night', 'شب', { dark: true, tint: false, auto: false }],
          ['tinted', 'آبی شب', { dark: true, tint: true, auto: false }],
          ['auto', 'مثل ویندوز', { auto: true }]
        ];
        var curTheme = p.auto ? 'auto' : p.dark ? (p.tint ? 'tinted' : 'night') : 'day';
        var themes = sec('تم');
        themes.append(el('div', { class: 'tg-themes' }, THEMES.map(function (t) {
          return el('button', { type: 'button', class: 'tg-theme th-' + t[0] + (curTheme === t[0] ? ' on' : ''), 'aria-pressed': String(curTheme === t[0]), onclick: function () { Object.assign(p, t[2]); if (t[0] === 'auto') p.dark = MP.isDarkTheme(Object.assign({}, p, { auto: true })); MP.savePrefs(); PAGES.chat(); } },
            el('span', { class: 'tg-tprev' }, el('i', { class: 'a' }), el('i', { class: 'b' }), el('em')), el('small', { text: t[1] }));
        })));
        var ACC = ['', '#3390ec', '#2fa36b', '#8e5be8', '#e0559b', '#e5484d', '#d79b1b', '#6b7280'];
        themes.append(el('div', { class: 'tg-accents', role: 'radiogroup', 'aria-label': 'رنگ اصلی' }, ACC.map(function (a) {
          return el('button', { type: 'button', role: 'radio', class: 'tg-acc' + ((p.accent || '') === a ? ' on' : ''), 'aria-checked': String((p.accent || '') === a), title: a ? a : 'نارنجی مربع (پیش‌فرض)', style: { background: a || '#f28a24' }, onclick: function () { p.accent = a; MP.savePrefs(); PAGES.chat(); } });
        })));
        if (host && window.__MP_DESKTOP.micaok) themes.append(row('monitor', 'پشت پنجره: دسکتاپ (Acrylic ویندوز ۱۱)', 'پنجره نیمه‌شفاف روی دسکتاپ؛ با باز کردن دوباره برنامه اعمال می‌شود', { end: sw(window.__MP_DESKTOP.mica, function (on) {
          MP.desktop.set('mica', on);
          MP.confirm('باز کردن دوباره', 'برای اعمال، مربع چت بسته و دوباره باز شود؟', 'باز کردن دوباره').then(function (ok) { if (ok) post({ t: 'restart' }); });
        }) }));
        themes.append(row('palette', 'شیشه‌ای (مات و محو)', 'ستون‌ها و پنجره‌ها نیمه‌شفاف با پس‌زمینه محو؛ خاموش برای کامپیوترهای کند', { end: sw(p.glass !== false, function (on) { p.glass = on; MP.savePrefs(); }) }));
        b.append(themes);
        var L = MP.chatLooks;
        if (L) {
          var wall = sec('پس‌زمینه گفت‌وگوها');
          wall.append(el('div', { class: 'lk-walls tg-walls' }, L.walls.map(function (x) {
            return el('button', { type: 'button', class: 'lk-wall' + (L.wall() === x[0] ? ' on' : '') + (x[2] ? '' : ' def'), style: x[2] && x[2] !== 'none' ? { background: x[2] } : null, title: x[1], onclick: function () { L.set('mp_chat_wall', x[0]); PAGES.chat(); } }, el('small', { text: x[1] }));
          })), el('p', { class: 'tg-hint', text: 'برای هر گفت‌وگو جداگانه هم از «ظاهر گفت‌وگو» در ستون اطلاعات قابل تغییر است.' }));
          var bub = sec('رنگ پیام‌های من');
          bub.append(el('div', { class: 'tg-accents' }, L.accents.map(function (a) {
            return el('button', { type: 'button', class: 'tg-acc' + (L.accent() === a ? ' on' : ''), title: a || 'هم‌رنگ تم', style: { background: a || 'var(--bub-me)' }, onclick: function () { L.set('mp_chat_bub', a); PAGES.chat(); } });
          })));
          var size = sec('اندازه متن پیام‌ها');
          size.append(el('div', { class: 'seg tg-seg' }, L.fonts.slice(1).map(function (x) {
            return el('button', { type: 'button', 'aria-selected': String((L.font() || 2) === x[0]), text: x[1], onclick: function () { L.set('mp_chat_font', String(x[0])); PAGES.chat(); } });
          })));
          b.append(wall, bub, size);
        }
        var motion = sec('کارایی');
        motion.append(row('repeat', 'انیمیشن‌ها', 'حرکت‌های رابط؛ خاموش برای کامپیوترهای کند', { end: sw(!p.motion, function (on) { p.motion = !on; MP.savePrefs(); }) }));
        b.append(motion);
      });
    },
    advanced: function () {
      show('پیشرفته', function (b) {
        if (host) {
          var s = sec('یکپارچگی با ویندوز');
          s.append(MP.skeleton(2));
          b.append(s);
          MP.desktop.ask(function (v) {
            s.replaceChildren(el('h4', { text: 'یکپارچگی با ویندوز' }),
              row('repeat', 'اجرا با روشن شدن ویندوز', 'کنار ساعت و بی‌صدا باز می‌شود', { end: sw(v.autostart, function (on) { MP.desktop.set('autostart', on); }) }),
              row('close', 'بستن پنجره = رفتن کنار ساعت', 'برای خروج کامل از منوی آیکون کنار ساعت «خروج»', { end: sw(v.tray, function (on) { MP.desktop.set('tray', on); }) }),
              row('menu', 'میانبر Ctrl + Shift + M', 'از هر برنامه‌ای مربع چت را جلو می‌آورد یا پنهان می‌کند', { end: sw(v.hotkey, function (on) { MP.desktop.set('hotkey', on); }) }),
              row('monitor', 'قاب پنجره ویندوز', 'نوار عنوان معمولی ویندوز به‌جای نوار هم‌رنگ تم', { end: sw(v.sysframe, function (on) { MP.desktop.set('sysframe', on); }) }));
          });
        }
        var typing = sec('نوشتن');
        typing.append(row('spell', 'غلط‌یاب املایی', 'زیر کلمه‌های اشتباه خط می‌کشد؛ کلیک راست روی آن، پیشنهادها را نشان می‌دهد', { end: sw(MP.spellOn(), function (on) { store('mp_spell', on ? null : '0'); applySpell(); }) }));
        b.append(typing);
        var p = S.boot.prefs, perf = sec('کارایی');
        perf.append(row('repeat', 'انیمیشن‌ها', '', { end: sw(!p.motion, function (on) { p.motion = !on; MP.savePrefs(); }) }),
          row('download', 'پاک کردن حافظه این دستگاه', 'نسخه ذخیره‌شده گفت‌وگوها برای باز شدن سریع؛ دوباره ساخته می‌شود', { onclick: function () {
            try { indexedDB.deleteDatabase('moraba-panel'); } catch (e) { /* none */ }
            MP.toast('حافظه پاک شد؛ با باز کردن دوباره، از سرور خوانده می‌شود');
          } }));
        b.append(perf, scaleSec());
        if (host) b.append(el('p', { class: 'tg-hint', text: 'برنامه ویندوز نسخه ' + MP.faDigits(version()) + ' · به‌روزرسانی خودکار از سایت' }));
      });
    }
  };
  var AFTER = [[0, 'خاموش'], [1, '۱ دقیقه'], [5, '۵ دقیقه'], [15, '۱۵ دقیقه'], [60, '۱ ساعت'], [300, '۵ ساعت']];
  PAGES.privacy = function () {
    show('حریم خصوصی و امنیت', function (b) {
      var c = lockCfg(), s = sec('رمز محلی');
      if (!c) {
        s.append(row('lock-key', 'روشن کردن رمز محلی', 'کسی پشت این کامپیوتر بدون رمز، پیام‌ها را نمی‌بیند', { onclick: function () { go('passcode'); } }));
      } else {
        s.append(row('edit', 'تغییر رمز محلی', '', { onclick: function () { go('passcode'); } }),
          row('lock-key', 'الان قفل کن', 'Ctrl + L', { onclick: closeFor(lock) }),
          row('close', 'خاموش کردن رمز محلی', '', { danger: true, onclick: function () { saveLock(null); MP.toast('رمز محلی خاموش شد'); drawRail(); PAGES.privacy(); } }));
        var auto = sec('قفل خودکار بعد از بی‌کاری');
        auto.append(el('div', { class: 'tg-scale' }, AFTER.map(function (a) {
          return el('button', { type: 'button', class: (c.after || 0) === a[0] ? 'on' : '', 'aria-pressed': String((c.after || 0) === a[0]), text: a[1], onclick: function () { c.after = a[0]; saveLock(c); PAGES.privacy(); } });
        })));
        b.append(s, auto);
      }
      if (!c) b.append(s);
      b.append(el('p', { class: 'tg-hint', text: 'رمز فقط روی همین دستگاه نگه داشته می‌شود. با هر بار باز شدن برنامه، با Ctrl + L و بعد از مدت بی‌کاری، مربع چت قفل می‌شود و اعلان‌ها هم بدون نام و متن می‌آیند. اگر رمز را فراموش کنید، با خروج از حساب پاک می‌شود.' }));
    });
  };
  PAGES.folders = function () {
    show('پوشه‌های گفت‌وگو', function (b) {
      var s = sec('پوشه‌های من');
      (S.chatFolders || []).forEach(function (f) {
        s.append(row('folder', f.name, MP.fa(f.chats.length) + ' گفت‌وگو', { onclick: closeFor(function () { MP.chatFolderEdit(f); }) }));
      });
      s.append(row('plus', 'پوشه تازه', 'مثلاً «فوری»، «چاپ» یا «مشتری‌های VIP»', { onclick: closeFor(function () { MP.chatFolderEdit(null); }) }));
      b.append(s, el('p', { class: 'tg-hint', text: 'پوشه‌ها کنار فهرست گفت‌وگوها می‌آیند (Ctrl+1 تا Ctrl+9). از منوی هر گفت‌وگو هم «افزودن به پوشه» هست.' }));
    });
  };
  PAGES.passcode = function () {
    show('رمز محلی', function (b) {
      var a = el('input', { type: 'password', class: 'input', autocomplete: 'new-password', inputmode: 'numeric', 'aria-label': 'رمز تازه', placeholder: 'رمز تازه (دست‌کم ۴ نویسه)' });
      var r = el('input', { type: 'password', class: 'input', autocomplete: 'new-password', inputmode: 'numeric', 'aria-label': 'تکرار رمز', placeholder: 'تکرار رمز' });
      var err = el('small', { class: 'tg-lock-err' });
      var f = el('form', { class: 'tg-pass' }, a, r, err, el('button', { type: 'submit', class: 'btn btn-primary', text: 'ذخیره رمز' }));
      f.onsubmit = function (e) {
        e.preventDefault();
        var v = MP.faDigits ? a.value.replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }) : a.value;
        var v2 = r.value.replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); });
        if (v.length < 4) { err.textContent = 'رمز دست‌کم ۴ نویسه باشد'; return; }
        if (v !== v2) { err.textContent = 'دو رمز یکی نیستند'; return; }
        var salt = Array.from(crypto.getRandomValues(new Uint8Array(12))).map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
        digest(v, salt).then(function (h) {
          var old = lockCfg();
          saveLock({ salt: salt, hash: h, after: old ? old.after : 15 });
          MP.toast('رمز محلی ذخیره شد');
          drawRail();
          back();
        });
      };
      b.append(el('section', { class: 'tg-ssec' }, el('h4', { text: lockCfg() ? 'رمز تازه' : 'یک رمز برای این دستگاه' }), f));
      setTimeout(function () { a.focus(); }, 50);
    });
  };

  /** «مقیاس رابط»: default switch + steps, like Telegram's «Default interface scale». */
  function scaleSec() {
    var s = sec('مقیاس رابط'), z = scale();
    s.append(row('zoom', 'مقیاس پیش‌فرض', 'Ctrl + = و Ctrl + − هم کار می‌کند', { end: sw(z === 1, function (on) { MP.setScale(on ? 1 : 1.25); redraw(); }) }),
      el('div', { class: 'tg-scale' }, SCALES.map(function (x) {
        return el('button', { type: 'button', class: z === x ? 'on' : '', 'aria-pressed': String(z === x), text: fa(Math.round(x * 100)) + '٪', onclick: function () { MP.setScale(x); redraw(); } });
      })));
    function redraw() { var t = stack[stack.length - 1]; if (t) PAGES[t[0]](t[1]); }
    return s;
  }
  /** Settings: MP.tgSettings() home, or a page: 'notify' | 'chat' | 'advanced'. */
  MP.tgSettings = function (page) {
    stack = [];
    if (page && PAGES[page] && page !== 'home') { stack.push(['home']); }
    go(page && PAGES[page] ? page : 'home');
  };

  /* ------------------------------------------------------------ Keys: folders and scale */

  document.addEventListener('keydown', function (e) {
    var ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl || e.altKey || !(C.chatApp || host)) return;
    // The Windows app, like Telegram Desktop: Ctrl+W hides the window beside the clock (closes a separate chat
    // window), Ctrl+Q quits.
    if (host && !e.shiftKey && (e.code === 'KeyW' || e.code === 'KeyQ')) { e.preventDefault(); post({ t: e.code === 'KeyW' ? 'hide' : 'quit' }); return; }
    // Ctrl+Shift+S: Windows' snipping, the picture comes into the chat
    if (host && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); post({ t: 'snip' }); return; }
    if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') { e.preventDefault(); stepScale(1); return; }
    if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') { e.preventDefault(); stepScale(-1); return; }
    if (!document.body.classList.contains('tg') || e.shiftKey) return;
    var n = /^Digit([1-9])$/.exec(e.code || '');
    if (n && MP.chatDesk && MP.chatDesk.folders) {
      var f = MP.chatDesk.folders()[+n[1] - 1];
      if (f) { e.preventDefault(); MP.chatDesk.folder(f.id); }
    }
  });

  /* ------------------------------------------------------------ The title bar says when the network is gone */

  function netState() {
    var off = !navigator.onLine;
    post({ t: 'status', text: off ? 'در انتظار شبکه…' : '' });
    document.documentElement.classList.toggle('mp-offline', off);
  }
  window.addEventListener('online', netState);
  window.addEventListener('offline', netState);
  if (!navigator.onLine) netState();

  /* ------------------------------------------------------------ Local passcode (Telegram's «رمز محلی») */

  var LKEY = 'mp_lock_' + (C.user || 'u');
  function lockCfg() { try { return JSON.parse(read(LKEY) || 'null'); } catch (e) { return null; } }
  function saveLock(c) { store(LKEY, c ? JSON.stringify(c) : null); if (!c) { store('mp_locked_at', null); } }
  function digest(code, salt) {
    var data = salt + ':' + code;
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)).then(function (b) {
        return Array.from(new Uint8Array(b)).map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      });
    }
    var h = 0x811c9dc5; // no secure context (plain http): FNV-1a
    for (var i = 0; i < data.length; i++) { h ^= data.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return Promise.resolve('f' + h.toString(16));
  }
  var locked = false, lastAct = Date.now(), lockEl = null;
  MP.isLocked = function () { return locked; };
  ['pointerdown', 'keydown', 'wheel'].forEach(function (ev) { document.addEventListener(ev, function () { if (!locked) lastAct = Date.now(); }, true); });
  setInterval(function () { var c = lockCfg(); if (c && c.after && !locked && Date.now() - lastAct > c.after * 60000) lock(); }, 15000);
  function lock() {
    var c = lockCfg();
    if (!c || locked || !C.chatApp) return;
    locked = true;
    store('mp_locked_at', String(Date.now())); // other «مربع چت» windows lock too
    document.documentElement.classList.add('mp-locked');
    var app = $('.app'); if (app) app.inert = true;
    if (modal) modal.close();
    closeDrawer();
    if (MP.dialog && MP.dialog.close) MP.dialog.close();
    var input = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', class: 'input tg-lock-in', 'aria-label': 'رمز محلی', maxlength: 64 });
    var err = el('small', { class: 'tg-lock-err', role: 'alert' });
    var box = el('form', { class: 'tg-lock-box' },
      el('img', { src: C.assets + 'img/chat-192.png', alt: '' }),
      el('strong', { text: 'مربع چت قفل است' }), el('small', { text: 'رمز محلی را وارد کنید' }),
      input, err, el('button', { type: 'submit', class: 'btn btn-primary', text: 'باز کردن' }),
      el('button', { type: 'button', class: 'link tg-lock-forgot', text: 'رمز را فراموش کرده‌اید؟ خروج از حساب', onclick: forgot }));
    box.onsubmit = function (e) {
      e.preventDefault();
      var v = input.value.replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); });
      digest(v, lockCfg().salt).then(function (h) {
        if (h === lockCfg().hash) { unlock(); store('mp_locked_at', null); return; }
        err.textContent = 'رمز درست نیست';
        box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
        input.select();
      });
    };
    lockEl = el('div', { class: 'tg-lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'مربع چت قفل است' }, box);
    document.body.append(lockEl);
    setTimeout(function () { input.focus(); }, 60);
    MP.emit('lock', true);
  }
  function unlock() {
    if (!locked) return;
    locked = false; lastAct = Date.now();
    document.documentElement.classList.remove('mp-locked');
    var app = $('.app'); if (app) app.inert = false;
    if (lockEl) lockEl.remove();
    lockEl = null;
    MP.emit('lock', false);
  }
  function forgot() {
    MP.confirm('خروج از حساب', 'رمز محلی پاک می‌شود و باید دوباره با نام کاربری و رمز حساب وارد شوید.', 'خروج', true).then(function (ok) {
      if (!ok) return;
      saveLock(null);
      MP.api('auth/logout', { method: 'POST' }).then(function () { location.replace(C.chat && C.chat.url ? C.chat.url : '/'); }, function () { location.href = S.boot && S.boot.logoutUrl ? S.boot.logoutUrl : '/'; });
    });
  }
  MP.lockNow = lock;
  window.addEventListener('storage', function (e) {
    if (e.key !== 'mp_locked_at') return;
    if (e.newValue) lock(); else unlock();
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyL' && C.chatApp) {
      e.preventDefault();
      if (lockCfg()) lock(); else MP.tgSettings('privacy');
    }
  });

  /* ------------------------------------------------------------ Spell checking in the composer */

  MP.spellOn = function () { return read('mp_spell') !== '0'; };
  function applySpell() {
    var t = document.getElementById('composer-text');
    if (!t) return;
    t.spellcheck = MP.spellOn();
    t.setAttribute('lang', 'fa');
  }
  applySpell();

  // A passcode: «مربع چت» opens locked (a separate chat window only while the others are locked).
  if (lockCfg() && C.chatApp && (!C.pop || read('mp_locked_at'))) lock();

  if (document.readyState !== 'loading') sync(); else document.addEventListener('DOMContentLoaded', sync);
})();
