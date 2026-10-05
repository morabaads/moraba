/* Home-screen widgets: pair the Android app, the iPhone (Scriptable) script and explain the Windows widgets. */
(function () {
  'use strict';
  var MP = window.MP, el = MP.el, $ = MP.$, icon = MP.icon, C = window.MP_CONFIG;
  var APK = C.assets + 'app/moraba.apk', IOS = C.assets + 'app/moraba-ios.js';

  function copy(text, done) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { MP.toast(done); }, function () { window.prompt('کپی کنید', text); });
  }
  function isAndroid() { return /android/i.test(navigator.userAgent); }

  /** Connected devices with a remove button. */
  function deviceList(box, list) {
    box.replaceChildren();
    if (!list.length) { box.append(el('p', { class: 'muted', text: 'هنوز دستگاهی وصل نشده است.' })); return; }
    list.forEach(function (d) {
      box.append(el('div', { class: 'wg-device' },
        el('span', { class: 'wg-device-ico', html: icon('grid') }),
        el('span', { class: 'wg-device-main' }, el('strong', { text: d.label }), el('small', { class: 'muted', text: 'وصل از ' + d.created + (d.used ? ' · آخرین به‌روزرسانی ' + d.used : '') })),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'قطع اتصال', onclick: function () {
          MP.confirm('قطع اتصال', 'ویجت‌های «' + d.label + '» دیگر به‌روز نمی‌شوند. ادامه می‌دهید؟', 'قطع اتصال', true).then(function (ok) {
            if (ok) MP.api('widget/devices/' + d.id, { method: 'DELETE' }).then(function (l) { deviceList(box, l); MP.toast('اتصال قطع شد'); }).catch(MP.soft);
          });
        } })));
    });
  }

  function step(n, title, body) {
    return el('li', { class: 'wg-step' }, el('span', { class: 'wg-num', text: MP.fa(n) }), el('div', null, el('strong', { text: title }), body ? el('div', { class: 'muted' }, body) : null));
  }

  function androidPane(devices) {
    var out = el('div', { class: 'wg-pair' });
    var pair = el('button', { type: 'button', class: 'btn btn-primary', html: icon('plus') + 'ساخت کد اتصال' });
    pair.onclick = function () {
      pair.disabled = true;
      MP.api('widget/devices', { method: 'POST', body: { label: 'اندروید' } }).then(function (r) {
        pair.hidden = true;
        deviceList(devices, r.list);
        var code = el('textarea', { class: 'wg-code', readonly: true, rows: 3, dir: 'ltr', text: r.code });
        out.replaceChildren(
          isAndroid() ? el('a', { class: 'btn btn-primary', href: r.link, html: icon('check') + 'باز کردن در اپ مربع و اتصال' }) : null,
          el('p', { class: 'muted', text: isAndroid() ? 'اگر اپ باز نشد، این کد را کپی و در اپ بچسبانید:' : 'این کد را کپی کنید و در اپ مربع روی گوشی بچسبانید:' }),
          code,
          el('button', { type: 'button', class: 'btn btn-ghost btn-sm', html: icon('clip') + 'کپی کد', onclick: function () { copy(r.code, 'کد کپی شد'); } }),
          el('p', { class: 'muted small', text: 'این کد فقط یک بار نمایش داده می‌شود و فقط ویجت‌ها را باز می‌کند (حضور، تسک‌ها، پیام‌ها، جلسه). اگر گوشی گم شد، از فهرست پایین اتصالش را قطع کنید.' }));
      }).catch(function (e) { pair.disabled = false; MP.soft(e); });
    };
    out.append(pair);
    return el('div', null,
      el('ol', { class: 'wg-steps' },
        step(1, 'اپ مربع را نصب کنید', el('span', null, el('a', { href: APK, download: 'moraba.apk', class: 'btn btn-ghost btn-sm', html: icon('download') + 'دانلود اپ اندروید' }), el('small', { text: ' اگر گوشی اجازه نداد، «نصب از منابع ناشناس» را برای مرورگر فعال کنید.' }))),
        step(2, 'گوشی را وصل کنید', out),
        step(3, 'ویجت را روی صفحه اصلی بگذارید', 'روی صفحه اصلی انگشت را نگه دارید ← ویجت‌ها ← «مربع». چهار ویجت دارید: تسک‌ها (همان کارت میز کار)، حضور با ساعت زنده، پیام‌های نخوانده و جلسه بعدی.')));
  }

  function iosPane(devices) {
    var out = el('div', { class: 'wg-pair' });
    var make = el('button', { type: 'button', class: 'btn btn-primary', html: icon('plus') + 'ساخت و کپی اسکریپت' });
    make.onclick = function () {
      make.disabled = true;
      Promise.all([MP.api('widget/devices', { method: 'POST', body: { label: 'آیفون' } }), fetch(IOS + '?ver=' + Date.now()).then(function (r) { return r.text(); })]).then(function (x) {
        var r = x[0], script = x[1].replace('__API__', r.api).replace('__TOKEN__', r.token);
        deviceList(devices, r.list);
        make.hidden = true;
        var btn = el('button', { type: 'button', class: 'btn btn-primary', html: icon('clip') + 'کپی اسکریپت', onclick: function () { copy(script, 'اسکریپت کپی شد؛ حالا در Scriptable بچسبانید'); } });
        out.replaceChildren(btn, el('p', { class: 'muted small', text: 'این اسکریپت کد اتصال شما را دارد؛ آن را برای کسی نفرستید.' }));
        copy(script, 'اسکریپت کپی شد؛ حالا در Scriptable بچسبانید');
      }).catch(function (e) { make.disabled = false; MP.soft(e); });
    };
    out.append(make);
    return el('div', null,
      el('ol', { class: 'wg-steps' },
        step(1, 'اپ رایگان Scriptable را از App Store نصب کنید', el('a', { href: 'https://apps.apple.com/app/scriptable/id1405459188', target: '_blank', rel: 'noopener', class: 'btn btn-ghost btn-sm', html: icon('download') + 'Scriptable در App Store' })),
        step(2, 'اسکریپت مربع را بسازید', out),
        step(3, 'در Scriptable بچسبانید', 'Scriptable را باز کنید ← دکمه + ← متن را بچسبانید ← نام را «مربع» بگذارید.'),
        step(4, 'ویجت را اضافه کنید', 'روی صفحه اصلی انگشت را نگه دارید ← + ← Scriptable ← اندازه متوسط یا بزرگ ← روی ویجت بزنید ← Script: «مربع». در «Parameter» می‌توانید tasks یا attendance بنویسید تا فقط همان را نشان دهد.')));
  }

  function windowsPane() {
    return el('div', null,
      el('ol', { class: 'wg-steps' },
        step(1, 'پنل را در مرورگر Microsoft Edge باز کنید', 'ویجت‌های ویندوز ۱۱ فقط از اپ‌های نصب‌شده با Edge پشتیبانی می‌کنند.'),
        step(2, 'پنل را به‌عنوان اپ نصب کنید', 'منوی ⋯ ← برنامه‌ها ← «نصب این سایت به‌عنوان برنامه». اگر قبلاً نصب کرده‌اید، یک بار اپ را باز کنید تا ویجت‌ها به‌روز شوند.'),
        step(3, 'ویجت را اضافه کنید', 'کلید Win+W ← دکمه + (افزودن ویجت) ← «مربع · تسک‌ها» یا «مربع · خلاصه امروز». ویجت با همان ورود پنل کار می‌کند و حدود هر ۱۵ دقیقه به‌روز می‌شود.')),
      el('p', { class: 'muted small', text: 'اگر در فهرست ویجت‌ها «مربع» را ندیدید، Edge و ویندوز را به‌روز کنید؛ این امکان در بعضی نسخه‌های ویندوز هنوز فعال نشده است.' }));
  }

  /* Windows widgets live in the service worker: nudge them after a punch or a task change here. */
  var nudge = null;
  function refreshWidgets() {
    clearTimeout(nudge);
    nudge = setTimeout(function () { var c = navigator.serviceWorker && navigator.serviceWorker.controller; if (c) c.postMessage({ type: 'widgets' }); }, 1500);
  }
  ['attendance', 'task-saved', 'tasks'].forEach(function (ev) { MP.on(ev, refreshWidgets); });

  MP.openWidgets = function () {
    var devices = el('div', { class: 'wg-devices' }, el('p', { class: 'muted', text: '…' }));
    var panes = { android: androidPane(devices), windows: windowsPane(), ios: iosPane(devices) };
    var body = el('div', { class: 'wg-body' });
    var first = MP.isIOS() ? 'ios' : /windows/i.test(navigator.userAgent) ? 'windows' : 'android';
    var seg = el('div', { class: 'seg', role: 'tablist' });
    [['android', 'اندروید'], ['windows', 'ویندوز'], ['ios', 'آیفون']].forEach(function (x) {
      seg.append(el('button', { type: 'button', role: 'tab', 'aria-selected': String(x[0] === first), text: x[1], onclick: function (e) {
        Array.prototype.forEach.call(seg.children, function (b) { b.setAttribute('aria-selected', String(b === e.currentTarget)); });
        body.replaceChildren(panes[x[0]]);
      } }));
    });
    body.append(panes[first]);
    MP.dialog.open('ویجت‌ها روی صفحه اصلی', el('div', { class: 'wg' },
      el('p', { class: 'muted', text: 'تسک‌ها، حضور با ساعت زنده، پیام‌های نخوانده و جلسه بعدی را بدون باز کردن پنل ببینید؛ تیک تسک و ثبت ورود/خروج هم از روی ویجت انجام می‌شود.' }),
      seg, body,
      el('h4', { class: 'wg-h', text: 'دستگاه‌های وصل‌شده' }), devices), { focus: false });
    MP.api('widget/devices').then(function (l) { deviceList(devices, l); }).catch(MP.soft);
  };
})();
