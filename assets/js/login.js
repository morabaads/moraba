/* Mobile-number login: ask for a code by SMS, then verify it. Works without the panel scripts. */
(function () {
  'use strict';
  var box = document.getElementById('otp'); if (!box) return;
  var root = box.dataset.root, mobile = '', timer = null;
  var fMobile = document.getElementById('otp-mobile'), fCode = document.getElementById('otp-code');
  var msg = document.getElementById('otp-msg'), resend = document.getElementById('otp-resend');
  var latin = function (s) { return String(s).replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }); };
  var fa = function (n) { return String(n).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); };
  function say(text, ok) { msg.hidden = !text; msg.textContent = text || ''; msg.classList.toggle('ok', !!ok); }
  function post(path, body) {
    return fetch(root + path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.message || 'خطا در ارتباط با سرور'); return j; }); });
  }
  function busy(form, on) { var b = form.querySelector('.login-btn'); b.disabled = on; }
  function countdown(sec) {
    clearInterval(timer); resend.disabled = true;
    timer = setInterval(function () {
      sec--; resend.textContent = sec > 0 ? 'ارسال دوباره (' + fa(sec) + ')' : 'ارسال دوباره';
      if (sec <= 0) { clearInterval(timer); resend.disabled = false; }
    }, 1000);
  }
  function request() {
    busy(fMobile, true); say('');
    return post('otp/request', { mobile: mobile }).then(function (r) {
      mobile = r.mobile; document.getElementById('otp-to').textContent = fa(mobile);
      fMobile.hidden = true; fCode.hidden = false; say('کد ارسال شد.', true);
      var c = document.getElementById('otp-c'); c.value = ''; c.focus(); countdown(r.wait || 60);
      // Android Chrome can fill the code straight from the SMS.
      if ('OTPCredential' in window) {
        navigator.credentials.get({ otp: { transport: ['sms'] } }).then(function (o) { if (o && o.code) { c.value = o.code; fCode.requestSubmit(); } }).catch(function () {});
      }
    }).catch(function (e) { say(e.message); }).then(function () { busy(fMobile, false); });
  }
  fMobile.addEventListener('submit', function (e) {
    e.preventDefault(); mobile = latin(document.getElementById('otp-m').value).replace(/\D/g, '');
    if (mobile.length < 10) { say('شماره موبایل را کامل وارد کنید.'); return; }
    request();
  });
  var boxes = document.querySelectorAll('.otp-box');
  function paintBoxes() {
    var v = latin(codeInput.value), focused = document.activeElement === codeInput;
    Array.prototype.forEach.call(boxes, function (b, i) {
      b.textContent = v[i] ? fa(v[i]) : '';
      b.classList.toggle('filled', !!v[i]);
      b.classList.toggle('active', focused && i === Math.min(v.length, 4));
    });
  }
  // Digits are shown in Persian while typing; they're converted back before sending.
  var mobileInput = document.getElementById('otp-m');
  mobileInput.addEventListener('input', function () { mobileInput.value = fa(latin(mobileInput.value).replace(/[^\d+]/g, '').slice(0, 14)); });
  var codeInput = document.getElementById('otp-c');
  ['focus', 'blur', 'keyup', 'click'].forEach(function (ev) { codeInput.addEventListener(ev, function () { setTimeout(paintBoxes); }); });
  codeInput.addEventListener('input', function () {
    var d = latin(codeInput.value).replace(/\D/g, '').slice(0, 5);
    codeInput.value = fa(d);
    paintBoxes();
    if (d.length === 5) fCode.requestSubmit();
  });
  fCode.addEventListener('submit', function (e) {
    e.preventDefault(); if (fCode.querySelector('.login-btn').disabled) return;
    busy(fCode, true); say('');
    post('otp/verify', { mobile: mobile, code: latin(codeInput.value), remember: document.getElementById('otp-r').checked })
      .then(function (r) { say('خوش آمدید…', true); location.href = r.redirect; })
      .catch(function (err) {
        say(err.message); busy(fCode, false);
        var wrap = document.querySelector('.otp-boxes'); wrap.classList.remove('shake'); void wrap.offsetWidth; wrap.classList.add('shake');
        codeInput.value = ''; codeInput.focus(); paintBoxes();
      });
  });
  resend.addEventListener('click', request);
  document.getElementById('otp-edit').addEventListener('click', function () { clearInterval(timer); fCode.hidden = true; fMobile.hidden = false; say(''); document.getElementById('otp-m').focus(); });
})();
