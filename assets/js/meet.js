/* Video meeting room: join screen, waiting room and a WebRTC mesh call. Signalling goes through
   the plugin's REST API (room/{token}/…) by polling, so no extra server is needed. */
(function () {
  'use strict';
  var C = window.MEET, info = C.info;
  var $ = function (s) { return document.querySelector(s); };
  function fa(s) { return String(s).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function el(tag, attrs) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n[k] = attrs[k];
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) n.append(arguments[i]);
    return n;
  }
  function ic(name) { return '<svg class="i" aria-hidden="true"><use href="#' + name + '"></use></svg>'; }
  function initials(name) { return String(name || '؟').trim().split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join(''); }

  /* ------------------------------------------------------------ API */
  function api(path, body) {
    var h = { 'Content-Type': 'application/json' };
    if (C.nonce) h['X-WP-Nonce'] = C.nonce;
    return fetch(C.api + path, { method: body ? 'POST' : 'GET', headers: h, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) { var e = new Error(d && d.message || 'خطا'); e.status = r.status; throw e; } return d; }); });
  }
  function auth(extra) { var b = { peer: me.id, secret: me.secret }; Object.keys(extra || {}).forEach(function (k) { b[k] = extra[k]; }); return b; }

  /* ------------------------------------------------------------ State */
  var me = { id: 0, secret: '', role: '', state: '' };
  var local = null, aTrack = null, vTrack = null, sTrack = null;
  var want = { mic: true, cam: true }, hand = false;
  var peers = {}, after = 0, pollTimer = null, polling = false, startAt = 0, remaining = -1, warned = false, lastWaiting = 0;
  var ice = info.ice && info.ice.length ? info.ice : [{ urls: 'stun:stun.l.google.com:19302' }];

  function show(id) { ['pre', 'wait', 'room', 'bye'].forEach(function (s) { $('#' + s).hidden = s !== id; }); }
  var toastT = null;
  function toast(t, ms) { var n = $('#toast'); n.textContent = t; n.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { n.hidden = true; }, ms || 3500); }

  /* ------------------------------------------------------------ Local media */
  var mediaErr = '';
  var camErr = '';
  /** Camera and microphone; if asking for both fails, each is asked for on its own so one problem does not cost the other. */
  function getMedia() {
    var md = navigator.mediaDevices;
    mediaErr = ''; camErr = '';
    if (!window.isSecureContext) { mediaErr = 'insecure'; return Promise.resolve(null); }
    if (!md || !md.getUserMedia) { mediaErr = 'unsupported'; return Promise.resolve(null); }
    var cam = { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } };
    return md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: cam })
      .catch(function (e1) {
        mediaErr = e1 && e1.name || 'error';
        var tracks = [];
        return md.getUserMedia({ video: cam }).catch(function () { return md.getUserMedia({ video: true }); })
          .then(function (v) { tracks = tracks.concat(v.getTracks()); }, function (e) { camErr = e && e.name || 'error'; })
          .then(function () { return md.getUserMedia({ audio: true }); })
          .then(function (a) { tracks = tracks.concat(a.getTracks()); }, function (e) { if (!mediaErr) mediaErr = e && e.name; })
          .then(function () { if (tracks.length) { if (camErr || tracks.length === 2) mediaErr = ''; return new MediaStream(tracks); } return null; });
      });
  }
  function mediaHint(s) {
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var inApp = /Telegram|WhatsApp|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent) || (ios && !/Safari\//.test(navigator.userAgent));
    if (s && !vTrack) {
      if (camErr === 'NotAllowedError') return ios ? 'اجازه دوربین داده نشد. در Safari روی «aA» کنار آدرس ← تنظیمات وب‌سایت ← دوربین را «اجازه» کنید؛ یا تنظیمات آیفون ← Safari ← دوربین ← «اجازه». سپس دکمه زیر را بزنید.' : 'اجازه دوربین داده نشد. روی قفل کنار آدرس بزنید و دوربین را مجاز کنید، سپس دکمه زیر را بزنید.';
      if (camErr === 'NotReadableError' || camErr === 'AbortError') return 'دوربین دست برنامه دیگری است (تماس تصویری، دوربین…). آن را ببندید و دکمه زیر را بزنید.';
      return 'دوربین در دسترس نیست' + (camErr ? ' (' + camErr + ')' : '') + '؛ فقط صدا فرستاده می‌شود. دکمه زیر را بزنید تا دوباره امتحان شود.';
    }
    if (s) return !aTrack ? 'میکروفونی پیدا نشد؛ فقط تصویر فرستاده می‌شود.' : '';
    if (mediaErr === 'insecure') return 'برای دوربین و میکروفون، سایت باید با https باز شود.';
    if (mediaErr === 'unsupported' || mediaErr === 'NotSupportedError' || inApp) return ios ? 'این مرورگر به دوربین دسترسی ندارد. لینک را در Safari باز کنید (نه داخل تلگرام، واتساپ یا اینستاگرام).' : 'این مرورگر به دوربین دسترسی ندارد. لینک را در Chrome باز کنید (نه داخل تلگرام، واتساپ یا اینستاگرام).';
    if (mediaErr === 'NotAllowedError' || mediaErr === 'SecurityError') return ios ? 'اجازه دوربین و میکروفون داده نشد. در Safari روی «aA» کنار آدرس ← تنظیمات وب‌سایت ← دوربین و میکروفون را «اجازه» کنید و دوباره امتحان کنید.' : 'اجازه دوربین و میکروفون داده نشد. روی قفل کنار آدرس بزنید، دسترسی را مجاز کنید و دوباره امتحان کنید.';
    if (mediaErr === 'NotReadableError' || mediaErr === 'AbortError') return 'دوربین یا میکروفون دست برنامه دیگری است (تماس، زوم…). آن را ببندید و دوباره امتحان کنید.';
    return 'دوربین و میکروفون در دسترس نیست؛ می‌توانید فقط ببینید و بشنوید.';
  }
  function startPreview() {
    return getMedia().then(function (st) {
      if (!local && st) want = { mic: true, cam: true };
      if (local) local.getTracks().forEach(function (t) { t.stop(); });
      setLocal(st);
      var pv = $('#pv'); pv.srcObject = st || null; if (st) pv.play().catch(function () {});
      $('#pv-hint').textContent = mediaHint(st);
      $('#pv-retry').hidden = !!(st && vTrack && aTrack);
      return st;
    });
  }
  function setLocal(stream) {
    local = stream;
    aTrack = stream ? stream.getAudioTracks()[0] || null : null;
    vTrack = stream ? stream.getVideoTracks()[0] || null : null;
    if (!aTrack) want.mic = false;
    if (!vTrack) want.cam = false;
    applyLocal();
  }
  function applyLocal() {
    if (aTrack) aTrack.enabled = want.mic;
    if (vTrack) vTrack.enabled = want.cam;
    [['#pv-mic', '#b-mic', want.mic, 'mic', 'mic-off', aTrack], ['#pv-cam', '#b-cam', want.cam, 'cam', 'cam-off', vTrack]].forEach(function (x) {
      [x[0], x[1]].forEach(function (s) {
        var b = $(s); b.innerHTML = ic(x[2] ? x[3] : x[4]); b.classList.toggle('off', !x[2]); b.disabled = !x[5];
        b.title = !x[5] ? 'در دسترس نیست' : x[2] ? 'خاموش کردن' : 'روشن کردن';
      });
    });
    $('#pv-ph').hidden = !!(vTrack && want.cam);
    var mine = peers.me;
    if (mine) paintTile(mine, { name: (info.user ? info.user.name : nameValue()) + ' (شما)', mic: want.mic, cam: want.cam || !!sTrack, hand: hand, share: !!sTrack });
  }

  /* ------------------------------------------------------------ Join screen */
  var fields = $('#pre-fields');
  function nameValue() { var n = $('#j-name'); return n ? n.value.trim() : ''; }
  if (info.user) {
    fields.append(el('div', { class: 'who' }, info.user.avatar ? el('img', { src: info.user.avatar, alt: '' }) : el('span', { class: 'av', text: initials(info.user.name) }),
      el('div', null, el('b', { text: info.user.name }), el('small', { text: info.user.host ? 'میزبان جلسه' : 'همکار' }))));
    if (info.user.host) $('#join-btn').textContent = info.status === 'live' ? 'ورود به جلسه' : 'شروع جلسه';
  } else {
    var saved = ''; try { saved = localStorage.getItem('mp-meet-name') || ''; } catch (e) { /* private */ }
    fields.append(el('label', { class: 'fld' }, el('span', { text: 'نام شما' }), el('input', { id: 'j-name', required: 'required', maxlength: 60, placeholder: 'مثلاً علی رضایی', value: saved })));
  }
  if (info.password) fields.append(el('label', { class: 'fld' }, el('span', { text: 'رمز جلسه' }), el('input', { id: 'j-pass', required: 'required', maxlength: 64, dir: 'ltr', inputmode: 'text' })));
  if (info.status === 'ended' && !(info.user && info.user.host)) {
    $('#join-btn').disabled = true; $('#join-err').textContent = 'این جلسه به پایان رسیده است.';
  }

  startPreview();
  $('#pv-retry').onclick = function () { startPreview(); };
  $('#pv-mic').onclick = function () { want.mic = !want.mic; applyLocal(); };
  $('#pv-cam').onclick = function () { want.cam = !want.cam; applyLocal(); };

  $('#join-form').onsubmit = function (e) {
    e.preventDefault();
    var btn = $('#join-btn'), err = $('#join-err');
    err.textContent = ''; btn.disabled = true;
    audioUnlock();
    var before = local ? Promise.resolve(local) : startPreview();
    var name = nameValue(); try { if (name) localStorage.setItem('mp-meet-name', name); } catch (x) { /* private */ }
    before.then(function () { return api('/join', { name: name, password: $('#j-pass') ? $('#j-pass').value : '', mic: want.mic, cam: want.cam })
      .then(function (d) {
        me = { id: d.peer, secret: d.secret, role: d.role, state: d.state };
        if (d.state === 'waiting') { show('wait'); poll(); } else enter();
      });
    }).catch(function (x) { btn.disabled = false; err.textContent = x.message; });
  };

  /* ------------------------------------------------------------ Room */
  function enter() {
    show('room');
    $('#b-end').hidden = me.role !== 'host';
    startAt = Date.now();
    peers.me = { id: me.id, tile: null, stream: local };
    makeTile(peers.me, true);
    applyLocal();
    poll();
    tick();
  }

  function makeTile(p, mine) {
    var v = R.on && !mine ? el('img', { alt: '', decoding: 'async' }) : el('video', { autoplay: '', playsinline: '', 'webkit-playsinline': '' });
    if (mine) { v.muted = true; v.setAttribute('muted', ''); }
    if (R.on && !mine) p.img = v;
    var t = el('div', { class: 'tile' + (mine ? ' mine' : R.on ? ' relay' : '') }, v,
      el('div', { class: 'ph' }, el('span', { class: 'av' })),
      el('span', { class: 'net' }),
      el('div', { class: 'tag' }, el('i', { class: 'm', html: ic('mic-off') }), el('b'), el('i', { class: 'h', html: ic('hand') })));
    p.tile = t; p.video = R.on && !mine ? null : v;
    if (p.stream) { v.srcObject = p.stream; if (v.play) v.play().catch(function () {}); }
    t.ondblclick = function () { t.classList.toggle('pin'); layout(); };
    $('#mt-grid').append(t);
    layout();
  }
  function paintTile(p, s) {
    if (!p.tile) return;
    p.tile.querySelector('.tag b').textContent = s.name;
    var av = p.tile.querySelector('.ph .av');
    if (s.avatar) av.replaceChildren(el('img', { src: s.avatar, alt: '' })); else av.textContent = initials(s.name.replace(' (شما)', ''));
    p.tile.classList.toggle('cam-off', !s.cam);
    p.tile.classList.toggle('mic-off', !s.mic);
    p.tile.classList.toggle('hand', !!s.hand);
    p.tile.classList.toggle('share', !!s.share);
  }
  function layout() {
    var g = $('#mt-grid'), n = g.children.length;
    g.dataset.n = n > 9 ? 'many' : n;
    g.classList.toggle('pinned', !!g.querySelector('.pin, .share'));
  }


  /* ------------------------------------------------------------ Relay mode: media through this site
     Sound: 16 kHz μ-law pieces of 200 ms (silence is not sent). Picture: JPEG frames a few times a second.
     One POST every ~250 ms sends ours and brings everyone else's. */
  var R = { on: info.mode !== 'p2p', q: '', rest: false, busy: false, c: {}, vk: {}, aq: [], aseq: 1, vseq: 1, frame: null, frameAt: 0, fails: 0 };
  var actx = null, gainNode = null, proc = null, micSrc = null, pend = [], pendN = 0, hang = 0, remoteUntil = 0, remoteLvl = 0;
  // [width, JPEG quality, ms between frames]
  var VQ = { low: [240, 0.45, 250], normal: [320, 0.5, 150], high: [480, 0.55, 120] }[info.video] || [320, 0.5, 150];
  var DEC = new Float32Array(256);
  (function () { for (var i = 0; i < 256; i++) { var u = ~i & 0xFF, sign = u & 0x80, e = (u >> 4) & 7, mt = u & 0x0F, x = ((mt << 3) + 0x84) << e; x -= 0x84; DEC[i] = (sign ? -x : x) / 32768; } })();
  function ulaw(v) {
    var x = Math.max(-1, Math.min(1, v)) * 32767 | 0, sign = (x >> 8) & 0x80;
    if (sign) x = -x; if (x > 32635) x = 32635; x += 0x84;
    var e = 7; for (var m = 0x4000; (x & m) === 0 && e > 0; e--, m >>= 1) { /* find exponent */ }
    return ~(sign | (e << 4) | ((x >> (e + 3)) & 0x0F)) & 0xFF;
  }
  /** Must run inside the click that joins: iOS only starts sound after a tap. */
  function audioUnlock() {
    if (!R.on) return;
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) { /* older iOS */ }
      actx = new AC();
      gainNode = actx.createGain(); gainNode.connect(actx.destination);
    }
    if (actx.state !== 'running') actx.resume();
  }
  function micStart() {
    if (!actx || !aTrack || proc) return;
    micSrc = actx.createMediaStreamSource(new MediaStream([aTrack]));
    proc = actx.createScriptProcessor(4096, 1, 1);
    var ratio = actx.sampleRate / 16000, carry = 0;
    proc.onaudioprocess = function (e) {
      var inp = e.inputBuffer.getChannelData(0), outN = Math.floor((inp.length - carry) / ratio), out = new Float32Array(outN);
      for (var i = 0; i < outN; i++) { var a = carry + i * ratio, i0 = a | 0, b = Math.min(inp.length - 1, (a + ratio) | 0), sum = 0, n = 0; for (var k = i0; k <= b; k++) { sum += inp[k]; n++; } out[i] = n ? sum / n : 0; }
      carry = (carry + outN * ratio) - inp.length; if (carry < 0) carry = 0;
      pend.push(out); pendN += outN;
      if (pendN < 3200) return;
      var all = new Float32Array(pendN), o = 0; pend.forEach(function (x) { all.set(x, o); o += x.length; }); pend = []; pendN = 0;
      if (!want.mic || me.state !== 'in') return;
      var rms = 0; for (var j = 0; j < all.length; j++) rms += all[j] * all[j]; rms = Math.sqrt(rms / all.length);
      var now = actx.currentTime;
      // Without echo cancellation for played-back sound, drop quiet pieces while others are talking (echo).
      var echo = now < remoteUntil + 0.25 && rms < Math.max(0.02, remoteLvl * 0.8);
      if (rms > 0.012 && !echo) hang = 4;
      if (hang <= 0) { talking(peers.me, false); return; }
      hang--;
      var bytes = new Uint8Array(all.length); for (var z = 0; z < all.length; z++) bytes[z] = ulaw(all[z]);
      R.aq.push(bytes); if (R.aq.length > 25) R.aq.splice(0, R.aq.length - 25);
      talking(peers.me, rms > 0.012);
    };
    micSrc.connect(proc); proc.connect(actx.destination);
  }
  ['touchend', 'click'].forEach(function (ev) { document.addEventListener(ev, function () { if (actx && actx.state !== 'running') actx.resume(); }, true); });
  function micStop() { if (proc) { try { micSrc.disconnect(); proc.disconnect(); } catch (e) { /* gone */ } proc = null; micSrc = null; } }
  function talking(p, on) { if (p && p.tile) p.tile.classList.toggle('talk', !!on); }
  function playPiece(pid, bytes) {
    if (!actx) return;
    var o = peers[pid]; if (!o) return;
    var n = bytes.length, outRate = actx.sampleRate, outN = Math.round(n * outRate / 16000), buf = actx.createBuffer(1, outN, outRate), d = buf.getChannelData(0), step = 16000 / outRate, rms = 0;
    for (var i = 0; i < outN; i++) { var pos = i * step, i0 = pos | 0, f = pos - i0, a = DEC[bytes[i0]], b = DEC[bytes[Math.min(n - 1, i0 + 1)]]; d[i] = a + (b - a) * f; }
    for (var j = 0; j < n; j += 8) rms += DEC[bytes[j]] * DEC[bytes[j]]; rms = Math.sqrt(rms / (n / 8));
    var now = actx.currentTime, t = Math.max(now + 0.15, o.next || 0);
    if (t - now > 1.0) t = now + 0.15; // fell behind: drop the delay
    var src = actx.createBufferSource(); src.buffer = buf; src.connect(gainNode); src.start(t);
    o.next = t + buf.duration;
    remoteUntil = Math.max(remoteUntil, o.next); remoteLvl = Math.max(rms, remoteLvl * 0.7);
    talking(o, true); clearTimeout(o.talkT); o.talkT = setTimeout(function () { talking(o, false); }, (o.next - now) * 1000 + 150);
  }
  /** Frames go into an <img>: WebKit sometimes does not repaint a canvas until something else changes on the page. */
  function drawFrame(pid, bytes) {
    var o = peers[pid]; if (!o || !o.img) return;
    if (o.loading) { o.queued = bytes; return; } // still decoding the previous one: keep only the newest
    o.loading = true;
    var u = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })), old = o.url;
    o.img.onload = o.img.onerror = function () {
      if (old) URL.revokeObjectURL(old);
      o.tile.classList.add('has-frame'); o.loading = false;
      if (o.queued) { var q = o.queued; o.queued = null; drawFrame(pid, q); }
    };
    o.url = u; o.img.src = u;
  }
  var grab = null;
  var capturing = false;
  function captureFrame() {
    var v = peers.me && peers.me.video;
    if (capturing || me.state !== 'in' || !v || (!want.cam && !sTrack) || !v.videoWidth) return;
    var share = !!sTrack;
    var w = share ? Math.min(1280, v.videoWidth) : Math.min(VQ[0], v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth);
    grab = grab || document.createElement('canvas');
    if (grab.width !== w || grab.height !== h) { grab.width = w; grab.height = h; }
    grab.getContext('2d').drawImage(v, 0, 0, w, h);
    capturing = true;
    grab.toBlob(function (b) {
      if (!b) { capturing = false; return; }
      (b.arrayBuffer ? b.arrayBuffer() : new Response(b).arrayBuffer()).then(function (ab) { R.frame = new Uint8Array(ab); capturing = false; }, function () { capturing = false; });
    }, 'image/jpeg', share ? 0.6 : VQ[1]);
  }
  function captureLoop() {
    if (!R.on || me.state === 'gone') return;
    captureFrame();
    setTimeout(captureLoop, sTrack ? 800 : VQ[2]);
  }
  function relayTick() {
    if (!R.on || me.state !== 'in') return;
    if (R.busy || !R.q) { setTimeout(relayTick, 200); return; }
    R.busy = true;
    var started = Date.now(), audio = R.aq.splice(0), frame = R.frame; R.frame = null;
    var head = { a: audio.map(function (x) { return x.length; }), as: R.aseq, v: frame ? frame.length : 0, vs: frame ? R.vseq : 0, c: R.c, vk: R.vk };
    R.aseq += audio.length; if (frame) R.vseq++;
    var hj = new TextEncoder().encode(JSON.stringify(head)), len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, hj.length);
    var body = new Blob([len, hj].concat(audio, frame ? [frame] : []), { type: 'application/octet-stream' });
    var url = R.rest ? C.api + '/relay?' + R.q : info.relay + '?' + R.q;
    var h = R.rest && C.nonce ? { 'X-WP-Nonce': C.nonce } : {};
    fetch(url, { method: 'POST', body: body, headers: h, credentials: R.rest ? 'same-origin' : 'omit', cache: 'no-store' })
      .then(function (r) { if (!r.ok) { var e = new Error('relay'); e.status = r.status; throw e; } return r.arrayBuffer(); })
      .then(function (ab) {
        R.fails = 0;
        var dv = new DataView(ab), jl = dv.getUint32(0), res = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, jl))), at = 4 + jl;
        R.c = res.c || {}; Object.keys(res.vk || {}).forEach(function (k) { R.vk[k] = res.vk[k]; });
        res.items.forEach(function (it) {
          var bytes = new Uint8Array(ab, at, it[3]); at += it[3];
          if (it[1] === 'a') playPiece(it[0], bytes); else drawFrame(it[0], bytes.slice());
        });
      })
      .catch(function (e) {
        R.fails++;
        if (!R.rest && (e.status === 404 || e.status === 503 || e.status === 500 || !e.status)) R.rest = true; // relay.php blocked → WordPress route
        if (e.status === 410) return;
      })
      .then(function () { R.busy = false; setTimeout(relayTick, Math.max(20, VQ[2] - (Date.now() - started)) + (R.fails > 3 ? 1000 : 0)); });
  }

  /* --- connection state & playback */
  function setNet(o, st) {
    if (!o.tile) return;
    o.tile.dataset.net = st;
    o.tile.querySelector('.net').textContent = st === 'connecting' ? 'در حال اتصال…' : st === 'weak' ? 'اتصال ضعیف…' : st === 'failed' ? 'اتصال برقرار نشد' : '';
  }
  var hinted = false;
  function slowHint() {
    if (hinted) return; hinted = true;
    toast(me.role === 'host' ? 'ارتباط مستقیم با بعضی شرکت‌کنندگان برقرار نشد. در پنل ← جلسات ← تنظیمات، یک سرور TURN وارد کنید.' : 'ارتباط تصویری برقرار نشد؛ شبکه شما اتصال مستقیم را اجازه نمی‌دهد. به میزبان خبر دهید.', 9000);
  }
  // iOS (and Chrome without a recent tap) refuse to start a video with sound on their own: ask for one tap.
  function play(v) {
    if (!v || !v.srcObject) return;
    var pr = v.play();
    if (pr && pr.catch) pr.catch(function () { $('#tap-play').hidden = false; });
  }
  $('#tap-play').onclick = function () {
    $('#tap-play').hidden = true;
    document.querySelectorAll('#mt-grid video').forEach(function (v) { v.play().catch(function () {}); });
  };

  /* --- peer connections */
  function conn(pid, init) {
    var pc = new RTCPeerConnection({ iceServers: ice });
    var o = { id: pid, pc: pc, q: [], stream: new MediaStream(), init: init, a: null, v: null };
    pc.ontrack = function (e) {
      // Safari does not pick up tracks added to a stream it is already playing: hand it a fresh stream.
      var tracks = o.stream.getTracks().filter(function (t) { return t.kind !== e.track.kind; }).concat([e.track]);
      o.stream = new MediaStream(tracks);
      if (o.video) { o.video.srcObject = o.stream; play(o.video); }
    };
    pc.onicecandidate = function (e) { if (e.candidate) signal(pid, 'ice', e.candidate.toJSON()); };
    function state() {
      var st = pc.iceConnectionState, c = pc.connectionState || st;
      var ok = st === 'connected' || st === 'completed' || c === 'connected';
      var bad = st === 'failed' || c === 'failed';
      setNet(o, ok ? '' : bad ? 'failed' : st === 'disconnected' ? 'weak' : 'connecting');
      if (ok) { clearTimeout(o.slow); o.connected = true; play(o.video); }
      if (bad && o.init && !o.restarted) { o.restarted = true; offer(o, true); }
      if (bad) slowHint();
    }
    pc.oniceconnectionstatechange = state;
    pc.onconnectionstatechange = state;
    o.slow = setTimeout(function () { if (!o.connected) { setNet(o, 'failed'); slowHint(); } }, 20000);
    if (init) {
      o.a = pc.addTransceiver('audio', { direction: 'sendrecv' });
      o.v = pc.addTransceiver('video', { direction: 'sendrecv' });
      attach(o);
    }
    peers[pid] = o;
    makeTile(o, false);
    o.video.srcObject = o.stream;
    return o;
  }
  function attach(o) {
    if (o.a) o.a.sender.replaceTrack(aTrack || null).catch(function () {});
    if (o.v) o.v.sender.replaceTrack(sTrack || vTrack || null).catch(function () {});
  }
  function offer(o, restart) {
    return o.pc.createOffer(restart ? { iceRestart: true } : undefined)
      .then(function (d) { return o.pc.setLocalDescription(d); })
      .then(function () { signal(o.id, 'offer', { type: o.pc.localDescription.type, sdp: o.pc.localDescription.sdp }); })
      .catch(function () {});
  }
  function drop(pid) {
    var o = peers[pid]; if (!o) return;
    clearTimeout(o.slow);
    clearTimeout(o.talkT);
    if (o.pc) try { o.pc.close(); } catch (e) { /* closed */ }
    if (o.tile) o.tile.remove();
    delete peers[pid];
    layout();
  }
  function signal(to, kind, body) { return api('/signal', auth({ to: to, kind: kind, body: body })).catch(function () {}); }

  var chain = Promise.resolve();
  function onSignal(s) {
    var o = peers[s.from];
    if (s.kind === 'mute') { if (want.mic) { want.mic = false; applyLocal(); sendState(); toast('میزبان میکروفون شما را بست'); } return Promise.resolve(); }
    if (s.kind === 'offer') {
      if (!o) o = conn(s.from, false);
      return o.pc.setRemoteDescription(s.body).then(function () {
        o.pc.getTransceivers().forEach(function (t) {
          var k = t.receiver && t.receiver.track && t.receiver.track.kind;
          if (k === 'audio' && !o.a) o.a = t; if (k === 'video' && !o.v) o.v = t;
          t.direction = 'sendrecv';
        });
        attach(o);
        return o.pc.createAnswer();
      }).then(function (d) { return o.pc.setLocalDescription(d); })
        .then(function () { flushIce(o); signal(s.from, 'answer', { type: o.pc.localDescription.type, sdp: o.pc.localDescription.sdp }); })
        .catch(function () {});
    }
    if (!o) return Promise.resolve();
    if (s.kind === 'answer') return o.pc.setRemoteDescription(s.body).then(function () { flushIce(o); }).catch(function () {});
    if (s.kind === 'ice') {
      if (o.pc.remoteDescription) return o.pc.addIceCandidate(s.body).catch(function () {});
      o.q.push(s.body);
    }
    return Promise.resolve();
  }
  function flushIce(o) { o.q.splice(0).forEach(function (c) { o.pc.addIceCandidate(c).catch(function () {}); }); }

  /* --- polling */
  function poll() {
    clearTimeout(pollTimer);
    if (polling) return;
    polling = true;
    api('/poll', auth({ after: after })).then(function (d) {
      polling = false;
      if (d.status === 'ended') return finish('ended');
      if (d.me.state === 'rejected') return finish('rejected');
      if (d.me.state === 'kicked') return finish('kicked');
      if (d.me.state === 'left') return finish('left');
      if (me.state === 'waiting') {
        if (d.me.state === 'in') { me.state = 'in'; enter(); return; }
        $('#wait-text').textContent = d.host_here ? 'میزبان به‌زودی ورود شما را تأیید می‌کند. این صفحه را نبندید.' : 'میزبان هنوز وارد جلسه نشده است؛ به‌محض ورود، درخواست شما را می‌بیند.';
        pollTimer = setTimeout(poll, 2000);
        return;
      }
      me.state = d.me.state;
      remaining = d.remaining;
      if (R.on && d.relay) { var first = !R.q; R.q = d.relay; if (first) { micStart(); relayTick(); captureLoop(); } }
      sync(d);
      d.signals.forEach(function (s) { after = Math.max(after, s.id); chain = chain.then(function () { return onSignal(s); }); });
      pollTimer = setTimeout(poll, d.signals.length ? 400 : 1000);
    }).catch(function (e) {
      polling = false;
      if (e.status === 403 || e.status === 404) return finish('left');
      pollTimer = setTimeout(poll, 2500);
    });
  }

  var lastPeers = [];
  function sync(d) {
    var ids = {};
    d.peers.forEach(function (p) {
      if (p.id === me.id) return;
      ids[p.id] = 1;
      var o = peers[p.id];
      if (!o && R.on) {
        o = peers[p.id] = { id: p.id };
        makeTile(o, false);
        if (lastPeers.length) toast(p.name + ' وارد جلسه شد');
      } else if (!o) {
        o = conn(p.id, me.id > p.id); // the newcomer calls everyone already in the room
        if (o.init) offer(o);
        if (lastPeers.length) toast(p.name + ' وارد جلسه شد');
      }
      paintTile(o, p);
    });
    Object.keys(peers).forEach(function (k) { if (k !== 'me' && !ids[k]) { var o = peers[k]; var nm = o.tile ? o.tile.querySelector('.tag b').textContent : ''; drop(k); if (nm) toast(nm + ' از جلسه خارج شد'); } });
    lastPeers = d.peers;
    $('#b-count').textContent = fa(d.peers.length);
    renderSide(d);
    if (me.role === 'host' && d.waiting.length > lastWaiting) toast(d.waiting[d.waiting.length - 1].name + ' منتظر تأیید ورود است');
    lastWaiting = d.waiting.length;
    $('#b-wait').hidden = !d.waiting.length;
  }

  function renderSide(d) {
    var wb = $('#waiting-box'); wb.replaceChildren();
    if (me.role === 'host' && d.waiting.length) {
      wb.append(el('div', { class: 'sec' }, el('b', { text: 'اتاق انتظار · ' + fa(d.waiting.length) }),
        d.waiting.length > 1 ? el('button', { type: 'button', class: 'lnk', text: 'پذیرش همه', onclick: function () { admit('all', true); } }) : null));
      d.waiting.forEach(function (p) {
        wb.append(el('div', { class: 'pp wait' }, el('span', { class: 'av', text: initials(p.name) }),
          el('div', { class: 'nm' }, el('b', { text: p.name }), el('small', { text: p.role === 'guest' ? 'مهمان خارج از سازمان' : 'همکار' })),
          el('button', { type: 'button', class: 'btn sm primary', text: 'پذیرش', onclick: function () { admit(p.id, true); } }),
          el('button', { type: 'button', class: 'btn sm ghost', text: 'رد', onclick: function () { admit(p.id, false); } })));
      });
    }
    var pb = $('#mt-people'); pb.replaceChildren(el('div', { class: 'sec' }, el('b', { text: 'در جلسه · ' + fa(d.peers.length) })));
    d.peers.forEach(function (p) {
      var row = el('div', { class: 'pp' }, p.avatar ? el('img', { class: 'av', src: p.avatar, alt: '' }) : el('span', { class: 'av', text: initials(p.name) }),
        el('div', { class: 'nm' }, el('b', { text: p.name + (p.id === me.id ? ' (شما)' : '') }), el('small', { text: p.role === 'host' ? 'میزبان' : p.role === 'guest' ? 'مهمان' : 'همکار' })),
        p.hand ? el('i', { class: 'st hand', html: ic('hand') }) : null,
        el('i', { class: 'st' + (p.mic ? '' : ' off'), html: ic(p.mic ? 'mic' : 'mic-off') }));
      if (me.role === 'host' && p.id !== me.id) {
        if (p.mic) row.append(el('button', { type: 'button', class: 'rb xs', title: 'بستن میکروفون', html: ic('mic-off'), onclick: function () { signal(p.id, 'mute', {}); toast('درخواست بستن میکروفون ' + p.name + ' فرستاده شد'); } }));
        if (p.role !== 'host') row.append(el('button', { type: 'button', class: 'rb xs red', title: 'حذف از جلسه', html: ic('close'), onclick: function () { if (confirm(p.name + ' از جلسه حذف شود؟')) api('/kick', auth({ target: p.id })).then(poll); } }));
      }
      pb.append(row);
    });
  }
  function admit(target, ok) { api('/admit', auth({ target: target, ok: ok })).then(function () { poll(); }).catch(function (e) { toast(e.message); }); }

  /* --- controls */
  function sendState(extra) { api('/state', auth(Object.assign({ mic: want.mic, cam: want.cam || !!sTrack, hand: hand, share: !!sTrack }, extra || {}))).catch(function () {}); }
  $('#b-mic').onclick = function () { want.mic = !want.mic; applyLocal(); sendState(); };
  $('#b-cam').onclick = function () { want.cam = !want.cam; applyLocal(); sendState(); };
  $('#b-hand').onclick = function () { hand = !hand; $('#b-hand').classList.toggle('on', hand); applyLocal(); sendState(); };
  $('#b-screen').onclick = function () {
    if (sTrack) return stopShare();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { toast('مرورگر شما اشتراک صفحه را پشتیبانی نمی‌کند'); return; }
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (s) {
      sTrack = s.getVideoTracks()[0];
      sTrack.onended = stopShare;
      Object.keys(peers).forEach(function (k) { if (k !== 'me') attach(peers[k]); });
      peers.me.video.srcObject = s;
      $('#b-screen').classList.add('on'); applyLocal(); sendState();
    }).catch(function () {});
  };
  function stopShare() {
    if (!sTrack) return;
    sTrack.onended = null; sTrack.stop(); sTrack = null;
    Object.keys(peers).forEach(function (k) { if (k !== 'me') attach(peers[k]); });
    peers.me.video.srcObject = local;
    $('#b-screen').classList.remove('on'); applyLocal(); sendState();
  }
  $('#b-people').onclick = function () { $('#side').hidden = !$('#side').hidden; };
  $('#side-close').onclick = function () { $('#side').hidden = true; };
  $('#copy-link').onclick = function () {
    var i = $('#invite-link');
    (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(function () { toast('لینک کپی شد'); }, function () { i.select(); document.execCommand('copy'); toast('لینک کپی شد'); });
  };
  $('#b-leave').onclick = function () { leave(); finish('left'); };
  $('#wait-leave').onclick = function () { leave(); finish('left'); };
  $('#b-end').onclick = function () {
    if (!confirm('جلسه برای همه پایان یابد؟')) return;
    api('/end', auth()).then(function () { finish('ended'); }).catch(function (e) { toast(e.message); });
  };
  $('#rejoin').onclick = function () { location.reload(); };

  function leave() {
    if (!me.id || me.state === 'gone') return;
    var body = JSON.stringify(auth());
    if (navigator.sendBeacon) navigator.sendBeacon(C.api + '/leave', new Blob([body], { type: 'application/json' }));
    else api('/leave', auth()).catch(function () {});
  }
  window.addEventListener('pagehide', leave);

  function finish(why) {
    clearTimeout(pollTimer);
    micStop(); R.q = '';
    me.state = 'gone';
    Object.keys(peers).forEach(function (k) { if (k !== 'me') drop(k); });
    if (peers.me && peers.me.tile) peers.me.tile.remove();
    delete peers.me;
    if (sTrack) { sTrack.stop(); sTrack = null; }
    if (local) local.getTracks().forEach(function (t) { t.stop(); });
    var T = {
      ended: ['جلسه به پایان رسید', 'از حضور شما سپاسگزاریم.'],
      rejected: ['ورود شما تأیید نشد', 'میزبان درخواست ورود شما را نپذیرفت.'],
      kicked: ['از جلسه حذف شدید', 'میزبان شما را از جلسه خارج کرد.'],
      left: ['از جلسه خارج شدید', 'هر زمان خواستید می‌توانید دوباره وارد شوید.']
    }[why];
    $('#bye-title').textContent = T[0]; $('#bye-text').textContent = T[1];
    $('#rejoin').hidden = why === 'ended' || why === 'kicked' || why === 'rejected';
    show('bye');
  }

  /* --- clock */
  function tick() {
    if (me.state !== 'in') return;
    var s = Math.floor((Date.now() - startAt) / 1000), txt;
    if (remaining >= 0) {
      var left = Math.max(0, remaining - (s % 1)); // server value, refreshed each poll
      txt = fa(pad(Math.floor(left / 60)) + ':' + pad(left % 60)) + ' مانده';
      $('#mt-clock').classList.toggle('warn', left <= 300);
      if (left <= 300 && !warned) { warned = true; toast('کمتر از ۵ دقیقه به پایان جلسه مانده است'); }
    } else txt = fa(pad(Math.floor(s / 60)) + ':' + pad(s % 60));
    $('#mt-clock').textContent = txt;
    setTimeout(tick, 1000);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
}());
