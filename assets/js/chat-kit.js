/*
 * Chat tools used by messages.js: text formatting (render and the toolbar), the photo editor, polls, place
 * and contact pickers, «send later», the round video recorder and voice waveforms.
 * Everything here works on its inputs only; messages.js decides when to call it.
 */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J || window.Jalali, el = MP.el, $ = MP.$, fa = MP.fa, icon = MP.icon;
  var K = MP.chatKit = {};

  /* ------------------------------------------------------------ Formatted text */

  // Marks, as Telegram writes them: **bold** __italic__ ~~strike~~ `code` ```block``` ||spoiler|| [text](link)
  var MARKS = [
    ['pre', /```\n?([\s\S]+?)\n?```/],
    ['code', /`([^`\n]+)`/],
    ['link', /\[([^\]\n]+)\]\(((?:https?:\/\/|task:|project:)[^)\s]+)\)/],
    ['b', /\*\*([\s\S]+?)\*\*/],
    ['i', /__([\s\S]+?)__/],
    ['s', /~~([\s\S]+?)~~/],
    ['spoiler', /\|\|([\s\S]+?)\|\|/]
  ];
  /**
   * Message text → nodes (never HTML): formatting, links, @mentions, #hashtags and #task / #project links.
   * opts: {onTag(tag), onTask(id), onProject(id)}
   */
  K.format = function (body, parent, opts) {
    opts = opts || {};
    var text = String(body || '');
    while (text) {
      var best = null;
      MARKS.forEach(function (mk) { var m = mk[1].exec(text); if (m && (!best || m.index < best.m.index)) best = { k: mk[0], m: m }; });
      if (!best) { plain(text, parent, opts); break; }
      if (best.m.index) plain(text.slice(0, best.m.index), parent, opts);
      var m = best.m, node;
      if (best.k === 'pre') node = el('pre', { class: 'f-pre', dir: 'ltr', text: m[1] });
      else if (best.k === 'code') node = el('code', { class: 'f-code', text: m[1] });
      else if (best.k === 'link') {
        var href = m[2], tm = /^(task|project):(\d+)$/.exec(href);
        if (tm) {
          node = el('a', { class: 'f-ref f-' + tm[1], href: '#', onclick: function (e) { e.preventDefault(); e.stopPropagation(); if (tm[1] === 'task') { if (opts.onTask) opts.onTask(+tm[2]); } else if (opts.onProject) opts.onProject(+tm[2]); } }, MP.iconEl(tm[1] === 'task' ? 'tasks' : 'folder'), el('span', { text: m[1] }));
        } else {
          node = el('a', { href: href, target: '_blank', rel: 'noopener' });
          K.format(m[1], node, opts);
        }
      } else if (best.k === 'spoiler') {
        node = el('span', { class: 'f-spoiler', title: 'برای دیدن بزنید', onclick: function (e) { if (!this.classList.contains('open')) { e.stopPropagation(); this.classList.add('open'); } } });
        K.format(m[1], node, opts);
      } else {
        node = el({ b: 'strong', i: 'em', s: 'del' }[best.k]);
        K.format(m[1], node, opts);
      }
      parent.append(node);
      text = text.slice(m.index + m[0].length);
    }
    return parent;
  };
  /** Plain text: links, @Name (a colleague) and #hashtag. */
  function plain(body, p, opts) {
    var re = /(https?:\/\/[^\s<>"']+)|(@[^\s@،,.!؟?:]+(?:\s[^\s@،,.!؟?:]+)?)|(#[\p{L}\p{N}_‌]*\p{L}[\p{L}\p{N}_‌]*)/gu, last = 0, m;
    var names = {}; (S.users || []).forEach(function (u) { names[u.name] = 1; names[u.name.split(' ')[0]] = 1; });
    while ((m = re.exec(body))) {
      if (m.index > last) p.append(body.slice(last, m.index));
      if (m[1]) { var url = m[1].replace(/[.,،)!؟?]+$/, ''); p.append(el('a', { href: url, target: '_blank', rel: 'noopener', dir: 'ltr', text: url })); last = m.index + url.length; re.lastIndex = last; continue; }
      if (m[3]) {
        var tag = m[3];
        p.append(el('a', { class: 'b-tag', href: '#', text: tag, onclick: function (e) { e.preventDefault(); e.stopPropagation(); if (opts.onTag) opts.onTag(this.textContent); } }));
        last = m.index + tag.length; continue;
      }
      var at = m[2], full = at.slice(1), first = full.split(' ')[0];
      if (names[full]) { p.append(el('span', { class: 'b-mention', text: at })); last = m.index + at.length; }
      else if (names[first]) { p.append(el('span', { class: 'b-mention', text: '@' + first })); last = m.index + first.length + 1; re.lastIndex = last; }
      else { p.append(at); last = m.index + at.length; }
    }
    if (last < body.length) p.append(body.slice(last));
  }

  /** Wraps the textarea's selection in a mark (or takes it off when it is already there). */
  K.wrap = function (ta, kind) {
    var a = ta.selectionStart, b = ta.selectionEnd, v = ta.value, sel = v.slice(a, b);
    var mk = { b: ['**', '**'], i: ['__', '__'], s: ['~~', '~~'], code: [sel.indexOf('\n') >= 0 ? '```\n' : '`', sel.indexOf('\n') >= 0 ? '\n```' : '`'], spoiler: ['||', '||'] }[kind];
    if (kind === 'link') {
      var url = prompt('آدرس لینک:', 'https://');
      if (!url || !/^https?:\/\/\S+$/.test(url.trim())) return;
      var label = sel || url.trim();
      ta.setRangeText('[' + label + '](' + url.trim() + ')', a, b, 'end');
    } else if (kind === 'clear') {
      ta.setRangeText(sel.replace(/\*\*|__|~~|\|\||```\n?|\n?```|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'), a, b, 'select');
    } else if (mk) {
      if (!sel) { ta.setRangeText(mk[0] + mk[1], a, b, 'end'); ta.setSelectionRange(a + mk[0].length, a + mk[0].length); }
      else if (v.slice(a - mk[0].length, a) === mk[0] && v.slice(b, b + mk[1].length) === mk[1]) { ta.setRangeText(sel, a - mk[0].length, b + mk[1].length, 'select'); }
      else ta.setRangeText(mk[0] + sel + mk[1], a, b, 'select');
    }
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  };
  K.FORMATS = [['b', 'پررنگ', 'B', 'Ctrl+B'], ['i', 'کج', 'I', 'Ctrl+I'], ['s', 'خط‌خورده', 'S', 'Ctrl+Shift+X'], ['code', 'کد', '</>', 'Ctrl+Shift+M'], ['spoiler', 'اسپویلر', '▒', 'Ctrl+Shift+P'], ['link', 'لینک', '🔗', 'Ctrl+K'], ['clear', 'بدون قالب', '⌫', '']];
  /** The bar that appears while text is selected in the composer. */
  K.formatBar = function (ta, host) {
    var bar = el('div', { class: 'fmt-bar', hidden: true, role: 'toolbar', 'aria-label': 'قالب‌بندی متن' }, K.FORMATS.map(function (f) {
      return el('button', { type: 'button', class: 'fmt-' + f[0], title: f[1] + (f[3] ? ' (' + f[3] + ')' : ''), 'aria-label': f[1], text: f[2], onpointerdown: function (e) { e.preventDefault(); }, onclick: function () { K.wrap(ta, f[0]); check(); } });
    }));
    host.append(bar);
    function check() { bar.hidden = ta.selectionStart === ta.selectionEnd || document.activeElement !== ta; }
    ['select', 'keyup', 'mouseup', 'touchend', 'focus', 'blur'].forEach(function (ev) { ta.addEventListener(ev, function () { setTimeout(check, 0); }); });
    document.addEventListener('selectionchange', function () { if (document.activeElement === ta) check(); });
    ta.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = e.key.toLowerCase(), code = e.code;
      var kind = !e.shiftKey && (k === 'b' || code === 'KeyB') ? 'b' : !e.shiftKey && (k === 'i' || code === 'KeyI') ? 'i' : !e.shiftKey && (k === 'k' || code === 'KeyK') ? 'link'
        : e.shiftKey && code === 'KeyX' ? 's' : e.shiftKey && code === 'KeyM' ? 'code' : e.shiftKey && code === 'KeyP' ? 'spoiler' : e.shiftKey && code === 'KeyN' ? 'clear' : '';
      if (kind) { e.preventDefault(); K.wrap(ta, kind); }
    });
    return bar;
  };

  /* ------------------------------------------------------------ «Send later» */

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoLocal(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  /** Resolves with 'Y-m-d H:i' (site time) or null. */
  K.pickTime = function (title) {
    return new Promise(function (resolve) {
      var now = new Date(), done = false;
      var tonight = new Date(now); tonight.setHours(21, 0, 0, 0);
      var morning = new Date(now); morning.setDate(morning.getDate() + 1); morning.setHours(9, 0, 0, 0);
      var hour = new Date(now.getTime() + 3600000); hour.setSeconds(0, 0);
      var quick = [['یک ساعت دیگر', hour], tonight > now ? ['امشب ساعت ۲۱', tonight] : null, ['فردا ساعت ۹ صبح', morning]].filter(Boolean);
      function pick(d) { done = true; MP.dialog.close(); resolve(isoLocal(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())); }
      var date = MP.dateField('date', isoLocal(morning), 'روز');
      var time = el('input', { type: 'time', name: 'time', value: '09:00', required: true });
      var f = el('form', { class: 'form sched-form' },
        el('div', { class: 'sched-quick' }, quick.map(function (q) { return el('button', { type: 'button', class: 'chip-btn', text: q[0], onclick: function () { pick(q[1]); } }); })),
        el('div', { class: 'form-row' }, date, MP.field('ساعت', time)),
        MP.actions('زمان‌بندی'));
      f.onsubmit = function (e) {
        e.preventDefault();
        var d = f.elements.date.value, t = time.value;
        if (!d || !t) return;
        if (new Date(d + 'T' + t + ':00') <= new Date()) { MP.toast('زمان باید در آینده باشد', { error: true }); return; }
        done = true; MP.dialog.close(); resolve(d + ' ' + t);
      };
      MP.dialog.open(title || 'ارسال در زمان مشخص', f, { onClose: function () { if (!done) resolve(null); } });
      if (MP.enhanceTime) MP.enhanceTime(time);
    });
  };

  /* ------------------------------------------------------------ Poll */

  K.pollForm = function () {
    return new Promise(function (resolve) {
      var done = false;
      var q = el('input', { class: 'input', maxlength: 255, required: true, placeholder: 'سؤال خود را بنویسید…' });
      var list = el('div', { class: 'poll-opts' });
      function addOpt(v) {
        if (list.children.length >= 10) return;
        var inp = el('input', { class: 'input', maxlength: 100, value: v || '', placeholder: 'گزینه ' + fa(list.children.length + 1) });
        var row = el('div', { class: 'poll-opt' }, inp, el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'حذف گزینه', html: icon('close'), onclick: function () { if (list.children.length > 2) { row.remove(); } } }));
        inp.addEventListener('input', function () { if (list.lastChild === row && inp.value && list.children.length < 10) addOpt(); });
        list.append(row);
      }
      addOpt(); addOpt();
      var multi = el('input', { type: 'checkbox' }), anon = el('input', { type: 'checkbox' });
      var f = el('form', { class: 'form' }, MP.field('سؤال', q), el('div', { class: 'field' }, el('span', { text: 'گزینه‌ها' }), list),
        el('label', { class: 'check' }, multi, el('span', { text: 'چند گزینه‌ای (هر نفر چند گزینه را انتخاب کند)' })),
        el('label', { class: 'check' }, anon, el('span', { text: 'ناشناس (نام رأی‌دهنده‌ها دیده نشود)' })),
        MP.actions('ارسال نظرسنجی'));
      f.onsubmit = function (e) {
        e.preventDefault();
        var opts = Array.prototype.map.call(list.querySelectorAll('input'), function (i) { return i.value.trim(); }).filter(Boolean);
        if (opts.length < 2) { MP.toast('دست‌کم دو گزینه بنویسید', { error: true }); return; }
        done = true; MP.dialog.close();
        resolve({ q: q.value.trim(), o: opts, multi: multi.checked, anon: anon.checked });
      };
      MP.dialog.open('نظرسنجی تازه', f, { onClose: function () { if (!done) resolve(null); } });
      q.focus();
    });
  };

  /* ------------------------------------------------------------ Place */

  /** An OpenStreetMap tile around a point, with the point's position on it (no API key needed). */
  K.mapTile = function (lat, lng, z) {
    z = z || 15;
    var n = Math.pow(2, z), x = (lng + 180) / 360 * n, r = lat * Math.PI / 180, y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
    return { url: 'https://tile.openstreetmap.org/' + z + '/' + Math.floor(x) + '/' + Math.floor(y) + '.png', px: (x % 1) * 100, py: (y % 1) * 100 };
  };
  K.mapLinks = function (lat, lng) {
    return [['گوگل مپ', 'https://www.google.com/maps?q=' + lat + ',' + lng], ['نشان', 'https://neshan.org/maps/@' + lat + ',' + lng + ',16z'], ['بلد', 'https://balad.ir/location?latitude=' + lat + '&longitude=' + lng + '&zoom=16']];
  };
  K.mapCard = function (loc) {
    var t = K.mapTile(loc.lat, loc.lng);
    var img = el('span', { class: 'loc-map' }, el('img', { src: t.url, alt: '', loading: 'lazy', onerror: function () { this.remove(); } }), el('i', { class: 'loc-pin', style: { left: t.px + '%', top: t.py + '%' }, html: icon('pin') }));
    return img;
  };
  K.pickPlace = function () {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) { MP.toast('این دستگاه موقعیت مکانی نمی‌دهد.', { error: true }); resolve(null); return; }
      var done = false, pos = null;
      var body = el('div', { class: 'form' }, el('p', { class: 'hint', text: 'در حال پیدا کردن موقعیت شما…' }), MP.skeleton(2));
      MP.dialog.open('ارسال موقعیت مکانی', body, { onClose: function () { if (!done) resolve(null); } });
      navigator.geolocation.getCurrentPosition(function (p) {
        pos = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) };
        var label = el('input', { class: 'input', maxlength: 120, placeholder: 'نام مکان (اختیاری)، مثلاً دفتر استودیو' });
        var f = el('form', { class: 'form' }, K.mapCard(pos), el('small', { class: 'hint', dir: 'ltr', text: pos.lat + ', ' + pos.lng + ' (±' + fa(Math.round(p.coords.accuracy)) + 'm)' }), MP.field('نام مکان', label), MP.actions('ارسال موقعیت'));
        f.onsubmit = function (e) { e.preventDefault(); done = true; MP.dialog.close(); resolve({ lat: pos.lat, lng: pos.lng, label: label.value.trim() }); };
        body.replaceChildren(f);
      }, function (err) {
        body.replaceChildren(el('p', { class: 'hint', text: err && err.code === 1 ? 'اجازه دسترسی به موقعیت مکانی داده نشد؛ از تنظیمات مرورگر آن را فعال کنید.' : 'موقعیت پیدا نشد؛ دوباره تلاش کنید (روی گوشی، مکان‌یاب را روشن کنید).' }));
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    });
  };

  /* ------------------------------------------------------------ Contact */

  K.pickContact = function () {
    return new Promise(function (resolve) {
      var done = false;
      var q = el('input', { type: 'search', class: 'input', placeholder: 'جستجوی همکار…' }), list = el('div', { class: 'menu ct-list' });
      function draw() {
        list.replaceChildren();
        S.users.filter(function (u) { return u.id !== S.me.id && MP.norm(u.name + ' ' + (u.title || '')).indexOf(MP.norm(q.value)) >= 0; }).slice(0, 30).forEach(function (u) {
          list.append(el('button', { type: 'button', onclick: function () { done = true; MP.dialog.close(); resolve({ name: u.name, phone: u.phone || '', uid: u.id }); } }, MP.avatar(u, 'sm'), el('span', null, el('strong', { text: u.name }), el('small', { class: 'muted', text: u.title || '' }))));
        });
      }
      q.oninput = draw; draw();
      var name = el('input', { class: 'input', maxlength: 80, placeholder: 'نام' });
      var phone = el('input', { class: 'input', maxlength: 20, inputmode: 'tel', dir: 'ltr', placeholder: '۰۹۱۲ ۱۲۳ ۴۵۶۷' });
      var other = el('form', { class: 'ct-other' }, el('b', { text: 'یا شماره دیگری:' }), el('div', { class: 'form-row' }, name, phone), el('button', { type: 'submit', class: 'btn btn-secondary btn-sm', text: 'ارسال این مخاطب' }));
      other.onsubmit = function (e) {
        e.preventDefault();
        var ph = (J.latinDigits ? J.latinDigits(phone.value) : phone.value).replace(/[^\d+]/g, '');
        if (!name.value.trim() || ph.length < 4) { MP.toast('نام و شماره را وارد کنید', { error: true }); return; }
        done = true; MP.dialog.close(); resolve({ name: name.value.trim(), phone: ph, uid: 0 });
      };
      MP.dialog.open('ارسال مخاطب', el('div', { class: 'form' }, q, list, other), { onClose: function () { if (!done) resolve(null); } });
    });
  };
  K.vcard = function (c) {
    var v = 'BEGIN:VCARD\nVERSION:3.0\nFN:' + c.name + '\nTEL;TYPE=CELL:' + c.phone + '\nEND:VCARD\n';
    var a = el('a', { href: URL.createObjectURL(new Blob([v], { type: 'text/vcard' })), download: (c.name || 'contact') + '.vcf' });
    document.body.append(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  /* ------------------------------------------------------------ Voice: waveform */

  /** 48 bars (0–31) from a recording, for the voice bubble. Resolves null when the browser can't decode it. */
  K.waveform = function (blob, bars) {
    bars = bars || 48;
    return new Promise(function (resolve) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || !blob.arrayBuffer) { resolve(null); return; }
      blob.arrayBuffer().then(function (buf) {
        var ac = new AC();
        var ok = function (audio) {
          var ch = audio.getChannelData(0), step = Math.max(1, Math.floor(ch.length / bars)), out = [], max = 0;
          for (var i = 0; i < bars; i++) { var sum = 0; for (var j = i * step; j < Math.min(ch.length, (i + 1) * step); j += 8) sum = Math.max(sum, Math.abs(ch[j])); out.push(sum); max = Math.max(max, sum); }
          ac.close && ac.close();
          resolve({ wave: out.map(function (v) { return Math.round(max ? v / max * 31 : 0); }), dur: audio.duration });
        };
        var p = ac.decodeAudioData(buf, ok, function () { resolve(null); });
        if (p && p.then) p.then(null, function () { resolve(null); });
      }).catch(function () { resolve(null); });
    });
  };

  /* ------------------------------------------------------------ Round video (Telegram's «video message») */

  /**
   * Records up to 60 seconds from the front camera, shown in a circle. Resolves {file, dur, thumb} or null.
   * The caller tells others «recording video…» through onTick.
   */
  K.recordRound = function (onTick) {
    return new Promise(function (resolve) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { MP.toast('ضبط ویدیو در این مرورگر ممکن نیست.', { error: true }); resolve(null); return; }
      var types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'], mime = '';
      for (var i = 0; i < types.length; i++) if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(types[i])) { mime = types[i]; break; }
      var facing = 'user', stream = null, rec = null, chunks = [], started = 0, timer = 0, finished = false, layer = null;
      var video = el('video', { class: 'rr-live', autoplay: true, muted: true, playsinline: true });
      var ring = el('svg');
      var time = el('span', { class: 'rr-time', text: '۰:۰۰' });
      var flip = el('button', { type: 'button', class: 'icon-btn rr-flip', 'aria-label': 'تعویض دوربین', html: icon('repeat') });
      var cancel = el('button', { type: 'button', class: 'btn btn-secondary', html: icon('trash') + 'لغو' });
      var send = el('button', { type: 'button', class: 'btn btn-primary', html: icon('send') + 'ارسال' });
      var wrap = el('div', { class: 'rr-layer', role: 'dialog', 'aria-label': 'پیام ویدیویی' },
        el('div', { class: 'rr-circle' }, video, el('span', { class: 'rr-prog' })), time,
        el('p', { class: 'rr-hint', text: 'تا ۶۰ ثانیه؛ برای پایان «ارسال» را بزنید.' }),
        el('div', { class: 'rr-acts' }, cancel, flip, send));
      function start() {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 480 }, height: { ideal: 480 }, aspectRatio: 1 }, audio: { echoCancellation: true, noiseSuppression: true } }).then(function (s) {
          if (finished) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
          stream = s; video.srcObject = s; video.classList.toggle('mirror', facing === 'user');
          rec = new MediaRecorder(s, mime ? { mimeType: mime, videoBitsPerSecond: 900000 } : undefined); chunks = [];
          rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
          rec.start(500); started = Date.now();
          clearInterval(timer);
          timer = setInterval(function () {
            var sec = (Date.now() - started) / 1000;
            time.textContent = J.faDigits(Math.floor(sec / 60) + ':' + ('0' + Math.floor(sec % 60)).slice(-2));
            $('.rr-prog', wrap).style.setProperty('--p', Math.min(1, sec / 60));
            if (onTick) onTick();
            if (sec >= 60) finish(true);
          }, 250);
        }).catch(function () { MP.toast('اجازه دسترسی به دوربین و میکروفون داده نشد.', { error: true }); finish(false); });
      }
      function stopAll() { clearInterval(timer); if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); }
      function finish(ok) {
        if (finished) return; finished = true;
        var dur = started ? (Date.now() - started) / 1000 : 0;
        var poster = null;
        try { var cv = document.createElement('canvas'), sz = Math.min(video.videoWidth, video.videoHeight) || 0; if (sz) { cv.width = cv.height = 320; cv.getContext('2d').drawImage(video, (video.videoWidth - sz) / 2, (video.videoHeight - sz) / 2, sz, sz, 0, 0, 320, 320); poster = cv; } } catch (e) { /* no frame */ }
        var close = function () { wrap.remove(); if (layer) { var l = layer; layer = null; MP.popLayer(l); } };
        if (!ok || !rec || rec.state === 'inactive') { stopAll(); close(); resolve(null); return; }
        rec.onstop = function () {
          stopAll(); close();
          var type = (rec.mimeType || 'video/webm').split(';')[0];
          var blob = new Blob(chunks, { type: type });
          if (dur < 1 || blob.size < 5000) { MP.toast('ویدیو خیلی کوتاه بود.'); resolve(null); return; }
          var file = new File([blob], 'round-' + Date.now() + (/mp4/.test(type) ? '.mp4' : '.webm'), { type: type });
          if (poster) poster.toBlob(function (pb) { resolve({ file: file, dur: dur, thumb: pb ? new File([pb], 'round-poster.jpg', { type: 'image/jpeg' }) : null }); }, 'image/jpeg', 0.8);
          else resolve({ file: file, dur: dur, thumb: null });
        };
        rec.stop();
      }
      flip.onclick = function () { if (!rec) return; facing = facing === 'user' ? 'environment' : 'user'; rec.onstop = null; try { rec.stop(); } catch (e) { /* ignore */ } stopAll(); start(); };
      cancel.onclick = function () { finish(false); };
      send.onclick = function () { finish(true); };
      document.body.append(wrap);
      layer = MP.pushLayer(function () { layer = null; finish(false); });
      start();
    });
  };

  /** A poster frame from a video file (for the bubble before it plays). Resolves {thumb, dur, w, h} or null. */
  K.videoPoster = function (file) {
    return new Promise(function (resolve) {
      var v = document.createElement('video'), url = URL.createObjectURL(file), done = false;
      v.muted = true; v.preload = 'metadata'; v.playsInline = true; v.src = url;
      var end = function (r) { if (done) return; done = true; URL.revokeObjectURL(url); resolve(r); };
      setTimeout(function () { end(null); }, 8000);
      v.onloadedmetadata = function () { v.currentTime = Math.min(1, (v.duration || 2) / 3); };
      v.onseeked = function () {
        try {
          var w = v.videoWidth, h = v.videoHeight, k = Math.min(1, 640 / Math.max(w, h)), cv = document.createElement('canvas');
          cv.width = Math.round(w * k); cv.height = Math.round(h * k); cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
          cv.toBlob(function (b) { end({ thumb: b ? new File([b], 'poster.jpg', { type: 'image/jpeg' }) : null, dur: v.duration, w: w, h: h }); }, 'image/jpeg', 0.75);
        } catch (e) { end(null); }
      };
      v.onerror = function () { end(null); };
    });
  };

  /* ------------------------------------------------------------ Photo editor: crop, rotate, draw, text */

  /** Resolves with the edited File (JPEG/PNG) or null when cancelled. */
  K.editPhoto = function (file) {
    return new Promise(function (resolve) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onerror = function () { URL.revokeObjectURL(url); MP.toast('این عکس باز نشد.', { error: true }); resolve(null); };
      img.onload = function () { URL.revokeObjectURL(url); open(img); };
      img.src = url;
      function open(src) {
        // Work canvas holds the current picture; edits are drawn on it; history for undo.
        var max = 2560, k0 = Math.min(1, max / Math.max(src.naturalWidth, src.naturalHeight));
        var work = document.createElement('canvas'); work.width = Math.round(src.naturalWidth * k0); work.height = Math.round(src.naturalHeight * k0);
        work.getContext('2d').drawImage(src, 0, 0, work.width, work.height);
        var history = [], mode = 'draw', color = '#ff3b30', size = 6, texts = [], crop = null, layer = null;
        var view = el('canvas', { class: 'pe-canvas' }), stage = el('div', { class: 'pe-stage' }, view);
        var cropBox = el('div', { class: 'pe-crop', hidden: true }, ['nw', 'ne', 'sw', 'se'].map(function (h) { return el('i', { class: 'pe-h ' + h, dataset: { h: h } }); }));
        stage.append(cropBox);
        var colors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de', '#ffffff', '#000000'];
        var palette = el('div', { class: 'pe-colors' }, colors.map(function (c) { return el('button', { type: 'button', class: 'pe-color' + (c === color ? ' on' : ''), style: { background: c }, 'aria-label': c, onclick: function () { color = c; $$c('.pe-color').forEach(function (b) { b.classList.toggle('on', b.style.background === this.style.background); }, this); } }); }));
        function $$c(q) { return Array.prototype.slice.call(wrap.querySelectorAll(q)); }
        var tool = function (m, ic, label) { return el('button', { type: 'button', class: 'pe-tool' + (mode === m ? ' on' : ''), dataset: { m: m }, onclick: function () { setMode(m); } }, MP.iconEl(ic), el('span', { text: label })); };
        var tools = el('div', { class: 'pe-tools' }, tool('draw', 'edit', 'قلم'), tool('text', 'list', 'متن'), tool('crop', 'grid', 'برش'),
          el('button', { type: 'button', class: 'pe-tool', onclick: rotate }, MP.iconEl('repeat'), el('span', { text: 'چرخش' })),
          el('button', { type: 'button', class: 'pe-tool', onclick: undo }, MP.iconEl('reply'), el('span', { text: 'برگرداندن' })));
        var done = el('button', { type: 'button', class: 'btn btn-primary', html: icon('check') + 'تمام' });
        var cancel = el('button', { type: 'button', class: 'btn btn-secondary', text: 'لغو' });
        // Its own modal layer: it opens over the send sheet (itself a modal dialog).
        var wrap = el('dialog', { class: 'pe', 'aria-label': 'ویرایش عکس' }, el('div', { class: 'pe-top' }, cancel, el('b', { text: 'ویرایش عکس' }), done), stage, palette, tools);
        document.body.append(wrap);
        wrap.addEventListener('cancel', function (e) { e.preventDefault(); finish(false); });
        wrap.showModal();
        function fit() {
          var r = stage.getBoundingClientRect(), k = Math.min(r.width / work.width, r.height / work.height, 1);
          view.width = work.width; view.height = work.height;
          view.style.width = Math.round(work.width * k) + 'px'; view.style.height = Math.round(work.height * k) + 'px';
          paint();
        }
        function paint() { var c = view.getContext('2d'); c.drawImage(work, 0, 0); }
        function snap() { history.push(work.toDataURL('image/png')); if (history.length > 15) history.shift(); }
        function undo() {
          var u = history.pop(); if (!u) return;
          var im = new Image(); im.onload = function () { work.width = im.width; work.height = im.height; work.getContext('2d').drawImage(im, 0, 0); fit(); }; im.src = u;
        }
        function rotate() {
          snap();
          var t = document.createElement('canvas'); t.width = work.height; t.height = work.width;
          var c = t.getContext('2d'); c.translate(t.width / 2, t.height / 2); c.rotate(Math.PI / 2); c.drawImage(work, -work.width / 2, -work.height / 2);
          work.width = t.width; work.height = t.height; work.getContext('2d').drawImage(t, 0, 0); fit(); if (mode === 'crop') startCrop();
        }
        function setMode(m) {
          if (mode === 'crop' && m !== 'crop') applyCrop();
          mode = m; $$c('.pe-tool[data-m]').forEach(function (b) { b.classList.toggle('on', b.dataset.m === m); });
          palette.hidden = m === 'crop';
          if (m === 'crop') startCrop(); else cropBox.hidden = true;
        }
        function toWork(e) { var r = view.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * work.width, y: (e.clientY - r.top) / r.height * work.height }; }
        // Pen
        var drawing = null;
        view.addEventListener('pointerdown', function (e) {
          if (mode === 'draw') { snap(); drawing = toWork(e); view.setPointerCapture(e.pointerId); e.preventDefault(); }
          else if (mode === 'text') { e.preventDefault(); addText(toWork(e)); }
        });
        view.addEventListener('pointermove', function (e) {
          if (!drawing || mode !== 'draw') return;
          var p = toWork(e), c = work.getContext('2d'), w = size * work.width / view.getBoundingClientRect().width;
          c.strokeStyle = color; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round';
          c.beginPath(); c.moveTo(drawing.x, drawing.y); c.lineTo(p.x, p.y); c.stroke(); drawing = p; paint();
        });
        view.addEventListener('pointerup', function () { drawing = null; });
        function addText(p) {
          var t = prompt('متن روی عکس:'); if (!t) return;
          snap();
          var c = work.getContext('2d'), fs = Math.max(18, Math.round(work.width / 14));
          c.font = '800 ' + fs + 'px Dana, Tahoma, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.direction = 'rtl';
          c.lineWidth = Math.max(3, fs / 7); c.strokeStyle = color === '#ffffff' ? '#000' : '#fff'; c.strokeText(t, p.x, p.y);
          c.fillStyle = color; c.fillText(t, p.x, p.y); paint();
        }
        // Crop: a box with four handles over the picture, in the picture's own pixels.
        function startCrop() { crop = { x: 0, y: 0, w: work.width, h: work.height }; cropBox.hidden = false; placeCrop(); }
        function placeCrop() {
          var r = view.getBoundingClientRect(), sr = stage.getBoundingClientRect(), k = r.width / work.width;
          cropBox.style.left = (r.left - sr.left + crop.x * k) + 'px'; cropBox.style.top = (r.top - sr.top + crop.y * k) + 'px';
          cropBox.style.width = crop.w * k + 'px'; cropBox.style.height = crop.h * k + 'px';
        }
        var drag = null;
        cropBox.addEventListener('pointerdown', function (e) { e.preventDefault(); drag = { h: e.target.dataset.h || 'move', x: e.clientX, y: e.clientY, c: Object.assign({}, crop) }; cropBox.setPointerCapture(e.pointerId); });
        cropBox.addEventListener('pointermove', function (e) {
          if (!drag) return;
          var k = work.width / view.getBoundingClientRect().width, dx = (e.clientX - drag.x) * k, dy = (e.clientY - drag.y) * k, c = Object.assign({}, drag.c), min = 40;
          if (drag.h === 'move') { c.x = Math.max(0, Math.min(work.width - c.w, c.x + dx)); c.y = Math.max(0, Math.min(work.height - c.h, c.y + dy)); }
          else {
            if (/w/.test(drag.h)) { var nx = Math.max(0, Math.min(c.x + c.w - min, c.x + dx)); c.w += c.x - nx; c.x = nx; }
            if (/e/.test(drag.h)) c.w = Math.max(min, Math.min(work.width - c.x, c.w + dx));
            if (/n/.test(drag.h)) { var ny = Math.max(0, Math.min(c.y + c.h - min, c.y + dy)); c.h += c.y - ny; c.y = ny; }
            if (/s/.test(drag.h)) c.h = Math.max(min, Math.min(work.height - c.y, c.h + dy));
          }
          crop = c; placeCrop();
        });
        cropBox.addEventListener('pointerup', function () { drag = null; });
        function applyCrop() {
          cropBox.hidden = true;
          if (!crop || (crop.x < 1 && crop.y < 1 && crop.w >= work.width - 1 && crop.h >= work.height - 1)) { crop = null; return; }
          snap();
          var t = document.createElement('canvas'); t.width = Math.round(crop.w); t.height = Math.round(crop.h);
          t.getContext('2d').drawImage(work, crop.x, crop.y, crop.w, crop.h, 0, 0, t.width, t.height);
          work.width = t.width; work.height = t.height; work.getContext('2d').drawImage(t, 0, 0); crop = null; fit();
        }
        function finish(ok) {
          if (ok && mode === 'crop') applyCrop();
          window.removeEventListener('resize', fit);
          if (wrap.open) wrap.close();
          wrap.remove();
          if (!ok) { resolve(null); return; }
          var png = /png/i.test(file.type);
          work.toBlob(function (b) { resolve(b ? new File([b], file.name.replace(/\.[^.]+$/, '') + (png ? '.png' : '.jpg'), { type: png ? 'image/png' : 'image/jpeg' }) : null); }, png ? 'image/png' : 'image/jpeg', 0.9);
        }
        done.onclick = function () { finish(true); };
        cancel.onclick = function () { finish(false); };
        window.addEventListener('resize', fit);
        requestAnimationFrame(fit);
      }
    });
  };
})();
