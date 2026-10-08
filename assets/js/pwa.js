/*
 * Install as an app.
 * - iPhone/iPad: Safari has no install prompt, so show a banner that walks through Share → Add to Home Screen,
 *   pointing at the Share button. Other iOS browsers and in-app browsers (Instagram, Telegram…) are told to open Safari.
 * - Android/desktop on the login page: a real «نصب» button from beforeinstallprompt (the panel itself handles this in core.js).
 * Dismissing hides the banner for 3 days; it never shows inside the installed app.
 */
(function () {
  'use strict';
  var me = document.currentScript || document.querySelector('script[data-sw]');
  var cfg = me ? me.dataset : {};
  var KEY = 'mp-install-dismissed', WAIT = 3 * 864e5;
  var ua = navigator.userAgent;
  var ios = /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var standalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  var inApp = /FBAN|FBAV|Instagram|Line\/|Telegram|WhatsApp|Snapchat|; wv\)/i.test(ua);
  var otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/.test(ua);
  var ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  if (cfg.login && cfg.sw && 'serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
    navigator.serviceWorker.register(cfg.sw, { scope: cfg.scope }).catch(function () { /* optional */ });
  }
  // Inside the Android app (its WebView says «MorabaApp/» in the user agent): no install banners at all.
  var nativeApp = !!window.MorabaApp || /MorabaApp\//.test(ua);
  if (standalone || nativeApp) return;
  // Chrome may fire this before the page finishes loading, so listen right away.
  var pending = null;
  if (cfg.login) window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); pending = e; if (started && !dismissed()) showAndroid(e); });
  var started = false;

  function dismissed() { try { return Date.now() - (+localStorage.getItem(KEY) || 0) < WAIT; } catch (e) { return false; } }
  function dismiss() { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* private mode */ } }

  var SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var ADD = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function banner(inner, arrow, head) {
    var b = document.createElement('div');
    b.className = 'ios-install' + (arrow ? ' has-arrow' + (ipad ? ' arrow-top' : '') : '');
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'نصب اپلیکیشن');
    b.innerHTML = '<button type="button" class="ios-install-close" aria-label="بستن"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
      '<div class="ios-install-head"><img src="' + cfg.icon + '" alt=""><div><strong>' + (head ? head[0] : cfg.app ? 'پرتال پروژه را نصب کنید' : cfg.chat ? 'مربع چت را نصب کنید' : 'پنل مربع را نصب کنید') + '</strong><small>' + (head ? head[1] : cfg.app ? 'مثل یک اپ از صفحه اصلی باز می‌شود؛ پیشرفت، طرح‌ها و گفت‌وگو همیشه دم دست' : cfg.chat ? 'پیام‌رسان تیم، جدا از پنل؛ با آیکون و اعلان خودش' : 'مثل یک اپ از صفحه اصلی باز می‌شود، تمام‌صفحه و با اعلان') + '</small></div></div>' + inner;
    b.querySelector('.ios-install-close').onclick = function () { dismiss(); b.classList.add('out'); setTimeout(function () { b.remove(); }, 250); };
    document.body.appendChild(b);
    document.body.classList.add('has-ios-install');
    return b;
  }

  function showIOS() {
    if (inApp || otherBrowser && !/CriOS|EdgiOS/.test(ua)) {
      var b = banner('<p class="ios-install-note">برای نصب، این صفحه را در <b>Safari</b> باز کنید: لینک را کپی کنید و در Safari بچسبانید.</p><button type="button" class="ios-install-btn">کپی لینک</button>');
      b.querySelector('.ios-install-btn').onclick = function (e) {
        var btn = e.currentTarget, url = location.href.split('#')[0];
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> کپی شد'; }, function () { window.prompt('این لینک را در Safari باز کنید:', url); });
      };
      return;
    }
    banner('<ol class="ios-install-steps">' +
      '<li><span class="ios-ico">' + SHARE + '</span><span>دکمه <b>اشتراک‌گذاری</b> ' + (ipad || otherBrowser ? 'بالای صفحه' : 'پایین صفحه') + ' را بزنید</span></li>' +
      '<li><span class="ios-ico">' + ADD + '</span><span>گزینه <b dir="ltr">Add to Home Screen</b> را انتخاب کنید (اگر نبود، فهرست را بالا بکشید)</span></li>' +
      '<li><span class="ios-ico ok"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><b>Add</b> را بزنید و ' + (cfg.app ? 'پرتال را از آیکون آن' : cfg.chat ? 'چت را از آیکون «مربع چت»' : 'پنل را از آیکون «مربع»') + ' باز کنید' + (cfg.login && !cfg.app ? ' و همان‌جا وارد شوید' : '') + '</span></li>' +
      '</ol>', !otherBrowser);
  }

  function showAndroid(evt) {
    var b = banner('<button type="button" class="ios-install-btn">نصب اپلیکیشن</button>');
    b.querySelector('.ios-install-btn').onclick = function () {
      evt.prompt();
      evt.userChoice.then(function () { b.remove(); });
    };
  }

  /** Android phones: the real app (panel and portal in one, with widgets and notifications). */
  /** «مربع چت» on Windows: the small app (opens in its own window, Start menu entry) or the browser's own install. */
  function showExe() {
    var b = banner('<a class="ios-install-btn" href="' + cfg.exe + '" download="MorabaChat.exe">دانلود برای ویندوز</a>' + (pending ? '<button type="button" class="ios-install-btn ghost">نصب از مرورگر</button>' : ''), false,
      ['مربع چت برای ویندوز', 'یک فایل کوچک؛ بعد از اجرا به منوی استارت و دسکتاپ اضافه می‌شود و چت را در پنجره جدا باز می‌کند']);
    b.querySelector('a').addEventListener('click', function () { dismiss(); setTimeout(function () { b.remove(); }, 400); });
    var g = b.querySelector('button.ghost');
    if (g) g.onclick = function () { pending.prompt(); pending.userChoice.then(function () { b.remove(); }); };
  }
  function showApk() {
    var b = banner('<p class="ios-install-note">' + (cfg.chat ? 'بعد از نصب، با حساب کارمندی خود وارد شوید؛ اپ کنار اپ اصلی مربع نصب می‌شود.' : 'بعد از نصب، آدرس همین سایت را یک بار وارد کنید و با شماره موبایل وارد شوید؛ اپ خودش تشخیص می‌دهد کارمند هستید یا مشتری.') + ' اگر گوشی اجازه نصب نداد، «نصب از منابع ناشناس» را برای مرورگر روشن کنید.</p><a class="ios-install-btn" href="' + cfg.apk + '" download="' + (cfg.chat ? 'moraba-chat.apk' : 'moraba.apk') + '">دانلود اپ (APK)</a>', false,
      cfg.chat ? ['مربع چت برای اندروید', 'گفت‌وگوهای تیم و مشتری‌ها با اعلان پیام‌ها'] : ['اپ اندروید مربع', cfg.app ? 'پرتال پروژه، گفت‌وگو با تیم و اعلان پیام‌ها' : 'پنل، گفت‌وگو، اعلان‌ها و ویجت‌های صفحه اصلی']);
    b.querySelector('a').addEventListener('click', function () { dismiss(); setTimeout(function () { b.remove(); }, 400); });
  }
  function start() {
    started = true;
    if (dismissed()) return;
    if (ios) setTimeout(showIOS, cfg.login ? 600 : 2500);
    else if (/Android/i.test(ua) && cfg.apk) setTimeout(showApk, cfg.login ? 600 : 2500);
    else if (cfg.chat && cfg.exe && /Windows/i.test(ua)) setTimeout(showExe, cfg.login ? 600 : 2500);
    else if (pending) showAndroid(pending);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
