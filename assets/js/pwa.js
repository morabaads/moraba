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
  if (standalone) return;
  // Chrome may fire this before the page finishes loading, so listen right away.
  var pending = null;
  if (cfg.login) window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); pending = e; if (started && !dismissed()) showAndroid(e); });
  var started = false;

  function dismissed() { try { return Date.now() - (+localStorage.getItem(KEY) || 0) < WAIT; } catch (e) { return false; } }
  function dismiss() { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* private mode */ } }

  var SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var ADD = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function banner(inner, arrow) {
    var b = document.createElement('div');
    b.className = 'ios-install' + (arrow ? ' has-arrow' + (ipad ? ' arrow-top' : '') : '');
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'نصب اپلیکیشن');
    b.innerHTML = '<button type="button" class="ios-install-close" aria-label="بستن"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
      '<div class="ios-install-head"><img src="' + cfg.icon + '" alt=""><div><strong>' + (cfg.app ? 'پرتال پروژه را نصب کنید' : 'پنل مربع را نصب کنید') + '</strong><small>' + (cfg.app ? 'مثل یک اپ از صفحه اصلی باز می‌شود؛ پیشرفت، طرح‌ها و گفت‌وگو همیشه دم دست' : 'مثل یک اپ از صفحه اصلی باز می‌شود، تمام‌صفحه و با اعلان') + '</small></div></div>' + inner;
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
      '<li><span class="ios-ico ok"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><b>Add</b> را بزنید و ' + (cfg.app ? 'پرتال را از آیکون آن' : 'پنل را از آیکون «مربع»') + ' باز کنید' + (cfg.login && !cfg.app ? ' و همان‌جا وارد شوید' : '') + '</span></li>' +
      '</ol>', !otherBrowser);
  }

  function showAndroid(evt) {
    var b = banner('<button type="button" class="ios-install-btn">نصب اپلیکیشن</button>');
    b.querySelector('.ios-install-btn').onclick = function () {
      evt.prompt();
      evt.userChoice.then(function () { b.remove(); });
    };
  }

  function start() {
    started = true;
    if (dismissed()) return;
    if (ios) setTimeout(showIOS, cfg.login ? 600 : 2500);
    else if (pending) showAndroid(pending);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
