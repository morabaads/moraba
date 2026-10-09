/* Video meeting room.
   Media goes through this site (relay mode, default) or browser to browser (WebRTC, optional).
   Relay mode: Opus sound and H.264/VP8 video through the browser's own codecs (WebCodecs) where every
   participant supports them, otherwise μ-law sound and JPEG frames; echo cancellation through a local
   loopback connection on Chrome; picture size and rate follow how many people there are and how large
   others show you.
   Also: waiting room, reconnect, chat with files, reactions, design review, contract cards, host
   controls, speaker / gallery view, picture-in-picture, recording. */
(function () {
  'use strict';
  var C = window.MEET, info = C.info;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function fa(s) { return String(s).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function el(tag, attrs) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.slice(0, 2) === 'on') n[k] = v;
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (Array.isArray(c)) c.forEach(function (x) { if (x) n.append(x); }); else if (c) n.append(c);
    }
    return n;
  }
  function ic(name) { return '<svg class="i" aria-hidden="true"><use href="#' + name + '"></use></svg>'; }
  function initials(name) { return String(name || '؟').trim().split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join(''); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var CHROMIUM = !!window.chrome && !IOS;
  var MOBILE = IOS || /Android/i.test(navigator.userAgent);

  /* ------------------------------------------------------------ API */
  function api(path, body) {
    var h = { 'Content-Type': 'application/json' };
    if (C.nonce) h['X-WP-Nonce'] = C.nonce;
    return fetch(C.api + path, { method: body ? 'POST' : 'GET', headers: h, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { var e = new Error(d && d.message || 'خطا در ارتباط'); e.status = r.status; throw e; } return d; }); });
  }
  /** The panel's own REST (tasks, recordings) — only for signed-in colleagues. */
  function rest(path, opts) {
    opts = opts || {};
    var h = { 'X-WP-Nonce': C.nonce };
    if (!opts.raw) h['Content-Type'] = 'application/json';
    return fetch(C.rest + path, { method: opts.method || 'POST', headers: h, credentials: 'same-origin', body: opts.raw || (opts.body ? JSON.stringify(opts.body) : undefined) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d && d.message || 'خطا'); return d; }); });
  }
  function auth(extra) { var b = { peer: me.id, secret: me.secret }; Object.keys(extra || {}).forEach(function (k) { b[k] = extra[k]; }); return b; }

  /* ------------------------------------------------------------ State */
  var me = { id: 0, secret: '', role: '', state: '' };
  var room = { peers: [], waiting: [], micLock: false, locked: false, recording: false, allow: false, need: 'hi', stage: null };
  var local = null, aTrack = null, vTrack = null, sTrack = null, sStream = null, facing = 'user';
  var want = { mic: true, cam: true }, hand = false, dev = { mic: '', cam: '', out: '' };
  var peers = {}, after = 0, chatAfter = 0, pollTimer = null, polling = false, startAt = 0, remaining = -1, warned = false, lastWaiting = 0;
  var view = 'gallery', dataMode = 'all', active = 0, activeAt = 0, leaving = false, polled = 0, failures = 0;
  var ckey = (function () { var k = ''; try { k = localStorage.getItem('mp-meet-key') || ''; if (!k) { k = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('mp-meet-key', k); } } catch (e) { k = Math.random().toString(36).slice(2); } return k.replace(/[^a-z0-9]/gi, '').slice(0, 32); })();
  var ice = info.ice && info.ice.length ? info.ice : [];
  var RELAY = info.mode !== 'p2p';
  var isHost = function () { return me.role === 'host' || me.role === 'cohost'; };

  function show(id) { ['pre', 'wait', 'room', 'bye'].forEach(function (s) { $('#' + s).hidden = s !== id; }); }
  var toastT = null;
  function toast(t, ms) { var n = $('#toast'); n.textContent = t; n.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { n.hidden = true; }, ms || 3500); }

  /* ------------------------------------------------------------ Capabilities (what this browser can encode / decode) */
  var VCODEC = { avc: 'avc1.42E01F', vp8: 'vp8' }, VCID = { avc: 1, vp8: 2 }, VCNAME = { 1: 'avc', 2: 'vp8' };
  var caps = { ae: false, ad: false, ve: [], vd: [] }, capsStr = '';
  var capsReady = (function () {
    var jobs = [];
    try {
      if (window.AudioEncoder && window.AudioDecoder) {
        jobs.push(AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 32000 }).then(function (r) { caps.ae = !!r.supported; }, function () {}));
        jobs.push(AudioDecoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 }).then(function (r) { caps.ad = !!r.supported; }, function () {}));
      }
      if (window.VideoEncoder && window.VideoDecoder && window.VideoFrame && window.EncodedVideoChunk) {
        Object.keys(VCODEC).forEach(function (k) {
          var cfg = { codec: VCODEC[k], width: 640, height: 360, bitrate: 400000, framerate: 15, latencyMode: 'realtime' };
          if (k === 'avc') cfg.avc = { format: 'annexb' };
          jobs.push(VideoEncoder.isConfigSupported(cfg).then(function (r) { if (r.supported) caps.ve.push(k); }, function () {}));
          jobs.push(VideoDecoder.isConfigSupported({ codec: VCODEC[k] }).then(function (r) { if (r.supported) caps.vd.push(k); }, function () {}));
        });
      }
    } catch (e) { /* old browser: μ-law and JPEG */ }
    return Promise.all(jobs).then(function () {
      caps.ve.sort(); caps.vd.sort(); // 'avc' first: hardware on phones
      capsStr = [caps.ae ? 'ae' : '', caps.ad ? 'ad' : '', 've:' + caps.ve.join('|'), 'vd:' + caps.vd.join('|')].join(',');
    });
  })();
  function parseCaps(s) {
    var o = { ae: false, ad: false, ve: [], vd: [] };
    String(s || '').split(',').forEach(function (p) {
      if (p === 'ae') o.ae = true; else if (p === 'ad') o.ad = true;
      else if (p.indexOf('ve:') === 0) o.ve = p.slice(3).split('|').filter(Boolean);
      else if (p.indexOf('vd:') === 0) o.vd = p.slice(3).split('|').filter(Boolean);
    });
    return o;
  }

  /* ------------------------------------------------------------ Local media */
  var mediaErr = '', camErr = '';
  function camConstraint() {
    var c = { width: { ideal: 640 }, height: { ideal: 480 } };
    if (dev.cam) c.deviceId = { exact: dev.cam }; else c.facingMode = { ideal: facing };
    return c;
  }
  function micConstraint() {
    var c = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (dev.mic) c.deviceId = { exact: dev.mic };
    return c;
  }
  /** Camera and microphone; if asking for both fails, each is asked for on its own so one problem does not cost the other. */
  function getMedia() {
    var md = navigator.mediaDevices;
    mediaErr = ''; camErr = '';
    if (!window.isSecureContext) { mediaErr = 'insecure'; return Promise.resolve(null); }
    if (!md || !md.getUserMedia) { mediaErr = 'unsupported'; return Promise.resolve(null); }
    return md.getUserMedia({ audio: micConstraint(), video: camConstraint() })
      .catch(function (e1) {
        mediaErr = e1 && e1.name || 'error';
        var tracks = [];
        return md.getUserMedia({ video: camConstraint() }).catch(function () { return md.getUserMedia({ video: true }); })
          .then(function (v) { tracks = tracks.concat(v.getTracks()); }, function (e) { camErr = e && e.name || 'error'; })
          .then(function () { return md.getUserMedia({ audio: micConstraint() }).catch(function () { return md.getUserMedia({ audio: true }); }); })
          .then(function (a) { tracks = tracks.concat(a.getTracks()); }, function (e) { if (!mediaErr) mediaErr = e && e.name; })
          .then(function () { if (tracks.length) { if (camErr || tracks.length === 2) mediaErr = ''; return new MediaStream(tracks); } return null; });
      });
  }
  function mediaHint(s) {
    var inApp = /Telegram|WhatsApp|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent) || (IOS && !/Safari\//.test(navigator.userAgent));
    if (s && !vTrack) {
      if (camErr === 'NotAllowedError') return IOS ? 'اجازه دوربین داده نشد. در Safari روی «aA» کنار آدرس ← تنظیمات وب‌سایت ← دوربین را «اجازه» کنید؛ یا تنظیمات آیفون ← Safari ← دوربین ← «اجازه». سپس دکمه زیر را بزنید.' : 'اجازه دوربین داده نشد. روی قفل کنار آدرس بزنید و دوربین را مجاز کنید، سپس دکمه زیر را بزنید.';
      if (camErr === 'NotReadableError' || camErr === 'AbortError') return 'دوربین دست برنامه دیگری است (تماس تصویری، دوربین…). آن را ببندید و دکمه زیر را بزنید.';
      return 'دوربین در دسترس نیست' + (camErr ? ' (' + camErr + ')' : '') + '؛ فقط صدا فرستاده می‌شود. دکمه زیر را بزنید تا دوباره امتحان شود.';
    }
    if (s) return !aTrack ? 'میکروفونی پیدا نشد؛ فقط تصویر فرستاده می‌شود.' : '';
    if (mediaErr === 'insecure') return 'برای دوربین و میکروفون، سایت باید با https باز شود.';
    if (mediaErr === 'unsupported' || mediaErr === 'NotSupportedError' || inApp) return IOS ? 'این مرورگر به دوربین دسترسی ندارد. لینک را در Safari باز کنید (نه داخل تلگرام، واتساپ یا اینستاگرام).' : 'این مرورگر به دوربین دسترسی ندارد. لینک را در Chrome باز کنید (نه داخل تلگرام، واتساپ یا اینستاگرام).';
    if (mediaErr === 'NotAllowedError' || mediaErr === 'SecurityError') return IOS ? 'اجازه دوربین و میکروفون داده نشد. در Safari روی «aA» کنار آدرس ← تنظیمات وب‌سایت ← دوربین و میکروفون را «اجازه» کنید و دوباره امتحان کنید.' : 'اجازه دوربین و میکروفون داده نشد. روی قفل کنار آدرس بزنید، دسترسی را مجاز کنید و دوباره امتحان کنید.';
    if (mediaErr === 'NotReadableError' || mediaErr === 'AbortError') return 'دوربین یا میکروفون دست برنامه دیگری است (تماس، زوم…). آن را ببندید و دوباره امتحان کنید.';
    return 'دوربین و میکروفون در دسترس نیست؛ می‌توانید فقط ببینید و بشنوید.';
  }
  function stopLocal() { if (local) local.getTracks().forEach(function (t) { t.stop(); }); }
  function startPreview() {
    stopLocal(); // iOS hands out one camera at a time
    return getMedia().then(function (st) {
      if (!local && st) want = { mic: true, cam: true };
      setLocal(st);
      var pv = $('#pv'); pv.srcObject = st || null; if (st) pv.play().catch(function () {});
      $('#pv-hint').textContent = mediaHint(st);
      $('#pv-retry').hidden = !!(st && vTrack && aTrack);
      checkFlip();
      return st;
    });
  }
  function setLocal(stream) {
    local = stream;
    aTrack = stream ? stream.getAudioTracks()[0] || null : null;
    vTrack = stream ? stream.getVideoTracks()[0] || null : null;
    if (!aTrack) want.mic = false;
    if (!vTrack) want.cam = false;
    var s = vTrack && vTrack.getSettings ? vTrack.getSettings() : {};
    if (s.facingMode) facing = s.facingMode === 'environment' ? 'environment' : 'user';
    applyLocal();
  }
  function micBlocked() { return room.micLock && !isHost() && !room.allow && me.state === 'in'; }
  function applyLocal() {
    if (micBlocked()) want.mic = false;
    if (aTrack) aTrack.enabled = want.mic;
    if (vTrack) vTrack.enabled = want.cam;
    [['#pv-mic', '#b-mic', want.mic, 'mic', 'mic-off', aTrack], ['#pv-cam', '#b-cam', want.cam, 'cam', 'cam-off', vTrack]].forEach(function (x) {
      [x[0], x[1]].forEach(function (s) {
        var b = $(s); b.innerHTML = ic(x[2] ? x[3] : x[4]); b.classList.toggle('off', !x[2]); b.disabled = !x[5];
        b.title = !x[5] ? 'در دسترس نیست' : x[2] ? 'خاموش کردن' : 'روشن کردن';
      });
    });
    $('#b-mic').classList.toggle('locked', micBlocked());
    $('#pv-ph').hidden = !!(vTrack && want.cam);
    var mine = peers.me;
    if (mine) {
      paintTile(mine, { name: (info.user ? info.user.name : nameValue()) + ' (شما)', mic: want.mic, cam: want.cam || !!sTrack, hand: hand, share: !!sTrack, avatar: info.user ? info.user.avatar : '', rtt: net.rtt });
      mine.tile.classList.toggle('mirror', facing === 'user' && !sTrack);
    }
  }
  /** Mobile browsers drop the camera / microphone in the background: get them back. */
  function reacquire(why) {
    var hadCam = want.cam, hadMic = want.mic;
    return startPreview().then(function (st) {
      want.cam = hadCam && !!vTrack; want.mic = hadMic && !!aTrack;
      applyLocal();
      if (peers.me && peers.me.video && !sTrack) { peers.me.video.srcObject = local; peers.me.video.play().catch(function () {}); }
      micRestart();
      Object.keys(peers).forEach(function (k) { if (k !== 'me' && peers[k].pc) attach(peers[k]); });
      if (why && st) toast('دوربین و میکروفون دوباره وصل شد');
    });
  }
  function checkFlip() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (list) {
      var cams = list.filter(function (d) { return d.kind === 'videoinput'; }).length;
      var show = cams > 1 && MOBILE;
      $('#pv-flip').hidden = !show;
      flipAvailable = show;
    }).catch(function () {});
  }
  var flipAvailable = false;
  function flipCamera() {
    facing = facing === 'user' ? 'environment' : 'user';
    dev.cam = '';
    if (vTrack) { vTrack.stop(); local.removeTrack(vTrack); }
    navigator.mediaDevices.getUserMedia({ video: camConstraint() }).then(function (s) {
      var t = s.getVideoTracks()[0];
      local = local || new MediaStream();
      local.addTrack(t); vTrack = t; want.cam = true;
      var src = new MediaStream(local.getTracks());
      local = src;
      $('#pv').srcObject = local;
      if (peers.me && peers.me.video && !sTrack) { peers.me.video.srcObject = local; peers.me.video.play().catch(function () {}); }
      Object.keys(peers).forEach(function (k) { if (k !== 'me' && peers[k].pc) attach(peers[k]); });
      applyLocal(); sendState();
      V.forceKey = true;
    }).catch(function () { toast('دوربین دیگری در دسترس نیست'); facing = facing === 'user' ? 'environment' : 'user'; reacquire(); });
  }

  /* ------------------------------------------------------------ Devices */
  function devicesDialog() {
    var md = navigator.mediaDevices;
    if (!md || !md.enumerateDevices) { toast('مرورگر شما انتخاب دستگاه را پشتیبانی نمی‌کند'); return; }
    md.enumerateDevices().then(function (list) {
      function sel(kind, label, key) {
        var opts = list.filter(function (d) { return d.kind === kind; });
        if (!opts.length) return null;
        var cur = key === 'mic' ? (aTrack && aTrack.getSettings().deviceId) : key === 'cam' ? (vTrack && vTrack.getSettings().deviceId) : dev.out;
        var s = el('select', { class: 'sel' }, opts.map(function (d, i) { return el('option', { value: d.deviceId, selected: d.deviceId === cur, text: d.label || label + ' ' + fa(i + 1) }); }));
        s.onchange = function () {
          dev[key] = s.value;
          if (key === 'out') { setSink(s.value); return; }
          if (key === 'cam') facing = 'user';
          reacquire().then(function () { V.forceKey = true; });
        };
        return el('label', { class: 'fld' }, el('span', { text: label }), s);
      }
      var canOut = (outAudio && outAudio.setSinkId) || (actx && actx.setSinkId);
      modal('دستگاه‌های صدا و تصویر', el('div', { class: 'devs' },
        sel('audioinput', 'میکروفون', 'mic'), sel('videoinput', 'دوربین', 'cam'), canOut ? sel('audiooutput', 'بلندگو', 'out') : null,
        el('div', { class: 'meter big', id: 'dev-meter' }, el('i')),
        el('button', { type: 'button', class: 'btn ghost sm', html: ic('speaker') + 'پخش صدای آزمایشی', onclick: function () { audioUnlock(); chime(); } })));
      meterOn($('#dev-meter'));
    });
  }
  function setSink(id) {
    if (outAudio && outAudio.setSinkId && loopOK) outAudio.setSinkId(id).catch(function () {});
    else if (actx && actx.setSinkId) actx.setSinkId(id).catch(function () {});
  }

  /* ------------------------------------------------------------ Modal & sheets */
  function modal(title, body) {
    $('#modal-title').textContent = title;
    $('#modal-body').replaceChildren(body);
    $('#modal').hidden = false;
  }
  function closeModal() { $('#modal').hidden = true; meterOff(); }
  $('#modal-close').onclick = closeModal;
  $('#modal').onclick = function (e) { if (e.target === $('#modal')) closeModal(); };

  /* ------------------------------------------------------------ Audio engine */
  var actx = null, out = null, outAudio = $('#out-audio'), loopOK = false, recDest = null;
  /** Must run inside a tap: iOS only starts sound after one. */
  function audioUnlock() {
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) { /* older iOS */ }
      try { actx = new AC({ sampleRate: 48000 }); } catch (e) { actx = new AC(); }
      out = actx.createGain();
      if (RELAY && CHROMIUM && window.RTCPeerConnection) loopback(); else out.connect(actx.destination);
    }
    if (actx.state !== 'running') actx.resume();
    if (outAudio && outAudio.srcObject) outAudio.play().catch(function () {});
  }
  /**
   * Chrome cancels echo only for sound that arrives through WebRTC. Sending our own playback through a
   * connection to ourselves (on this device, no server) puts it under the echo canceller.
   */
  function loopback() {
    var dest = actx.createMediaStreamDestination(), pc1 = new RTCPeerConnection(), pc2 = new RTCPeerConnection(), done = false;
    out.connect(dest);
    function fail() { if (done) return; done = true; try { out.disconnect(dest); } catch (e) { /* */ } out.connect(actx.destination); try { pc1.close(); pc2.close(); } catch (e) { /* */ } }
    pc1.onicecandidate = function (e) { if (e.candidate) pc2.addIceCandidate(e.candidate).catch(function () {}); };
    pc2.onicecandidate = function (e) { if (e.candidate) pc1.addIceCandidate(e.candidate).catch(function () {}); };
    pc2.ontrack = function (e) {
      outAudio.srcObject = new MediaStream([e.track]);
      outAudio.play().then(function () { if (!done) { done = true; loopOK = true; if (dev.out) setSink(dev.out); } }).catch(fail);
    };
    pc1.addTrack(dest.stream.getAudioTracks()[0], dest.stream);
    pc1.createOffer().then(function (o) { return pc1.setLocalDescription(o); })
      .then(function () { return pc2.setRemoteDescription(pc1.localDescription); })
      .then(function () { return pc2.createAnswer(); })
      .then(function (a) { return pc2.setLocalDescription(a); })
      .then(function () { return pc1.setRemoteDescription(pc2.localDescription); })
      .catch(fail);
    setTimeout(function () { if (!loopOK) fail(); }, 4000);
  }
  ['touchend', 'click'].forEach(function (ev) { document.addEventListener(ev, function () { if (actx && actx.state !== 'running') actx.resume(); if (outAudio.srcObject && outAudio.paused) outAudio.play().catch(function () {}); }, true); });

  function chime() {
    if (!actx) return;
    var o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.frequency.setValueAtTime(660, t); o.frequency.setValueAtTime(880, t + 0.18); o.frequency.setValueAtTime(990, t + 0.36);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.62);
  }
  /* Microphone level meter (join screen, device dialog). */
  var meterRAF = 0, meterSrc = null;
  function meterOn(box) {
    meterOff();
    if (!aTrack) return;
    audioUnlock();
    if (!actx) return;
    var an = actx.createAnalyser(); an.fftSize = 512;
    meterSrc = actx.createMediaStreamSource(new MediaStream([aTrack])); meterSrc.connect(an);
    var buf = new Float32Array(an.fftSize), bar = box.querySelector('i');
    box.classList.add('on');
    (function loop() {
      an.getFloatTimeDomainData(buf);
      var s = 0; for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      bar.style.width = Math.min(100, Math.sqrt(s / buf.length) * 400) + '%';
      meterRAF = requestAnimationFrame(loop);
    })();
  }
  function meterOff() { cancelAnimationFrame(meterRAF); if (meterSrc) { try { meterSrc.disconnect(); } catch (e) { /* */ } meterSrc = null; } }

  /* --- sending sound */
  var A = { proc: null, src: null, enc: null, opus: false, pkts: [], ts: 0, hang: 0, pend: [], pendN: 0, carry: 0, level: 0 };
  var DEC = new Float32Array(256);
  (function () { for (var i = 0; i < 256; i++) { var u = ~i & 0xFF, sign = u & 0x80, e = (u >> 4) & 7, mt = u & 0x0F, x = ((mt << 3) + 0x84) << e; x -= 0x84; DEC[i] = (sign ? -x : x) / 32768; } })();
  function ulaw(v) {
    var x = Math.max(-1, Math.min(1, v)) * 32767 | 0, sign = (x >> 8) & 0x80;
    if (sign) x = -x; if (x > 32635) x = 32635; x += 0x84;
    var e = 7; for (var m = 0x4000; (x & m) === 0 && e > 0; e--, m >>= 1) { /* find exponent */ }
    return ~(sign | (e << 4) | ((x >> (e + 3)) & 0x0F)) & 0xFF;
  }
  /** Opus when everyone can decode it, μ-law otherwise. */
  function wantOpus() {
    if (!caps.ae || [48000, 24000, 16000].indexOf(actx.sampleRate) < 0) return false;
    return room.peers.every(function (p) { return p.id === me.id || parseCaps(p.caps).ad; });
  }
  function opusEncoder() {
    if (A.enc) return true;
    try {
      A.enc = new AudioEncoder({ output: function (chunk) { var b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); A.pkts.push(b); }, error: function () { A.enc = null; } });
      A.enc.configure({ codec: 'opus', sampleRate: actx.sampleRate, numberOfChannels: 1, bitrate: 32000 });
      return true;
    } catch (e) { A.enc = null; return false; }
  }
  function micStart() {
    if (!actx || !aTrack || A.proc || !RELAY) return;
    A.src = actx.createMediaStreamSource(new MediaStream([aTrack]));
    A.proc = actx.createScriptProcessor(2048, 1, 1);
    var ratio = actx.sampleRate / 16000;
    A.proc.onaudioprocess = function (e) {
      var inp = e.inputBuffer.getChannelData(0);
      if (!want.mic || me.state !== 'in') { talking(peers.me, false); return; }
      var rms = 0; for (var j = 0; j < inp.length; j += 2) rms += inp[j] * inp[j]; rms = Math.sqrt(rms / (inp.length / 2));
      A.level = rms;
      // Echo guard: with Chrome's echo canceller active only very quiet pieces are dropped while others talk.
      var now = actx.currentTime, echo = now < remoteUntil + 0.2 && rms < Math.max(0.015, remoteLvl * (loopOK || IOS ? 0.25 : 0.8));
      if (rms > 0.012 && !echo) A.hang = 6;
      if (A.hang <= 0) { talking(peers.me, false); A.carry = 0; return; }
      A.hang--;
      talking(peers.me, rms > 0.012);
      A.opus = wantOpus() && opusEncoder();
      if (A.opus) {
        try {
          var ad = new AudioData({ format: 'f32-planar', sampleRate: actx.sampleRate, numberOfFrames: inp.length, numberOfChannels: 1, timestamp: A.ts, data: new Float32Array(inp) });
          A.ts += Math.round(inp.length / actx.sampleRate * 1e6);
          A.enc.encode(ad); ad.close();
        } catch (x) { A.enc = null; }
        return;
      }
      var outN = Math.floor((inp.length - A.carry) / ratio), o16 = new Float32Array(outN);
      for (var i = 0; i < outN; i++) { var a = A.carry + i * ratio, i0 = a | 0, b = Math.min(inp.length - 1, (a + ratio) | 0), sum = 0, n = 0; for (var k = i0; k <= b; k++) { sum += inp[k]; n++; } o16[i] = n ? sum / n : 0; }
      A.carry = Math.max(0, (A.carry + outN * ratio) - inp.length);
      A.pend.push(o16); A.pendN += outN;
      if (A.pendN >= 1600) {
        var bytes = new Uint8Array(A.pendN), off = 0;
        A.pend.forEach(function (x) { for (var z = 0; z < x.length; z++) bytes[off++] = ulaw(x[z]); });
        A.pend = []; A.pendN = 0;
        queueRecord(1, bytes);
      }
    };
    A.src.connect(A.proc); A.proc.connect(actx.destination);
    if (recDest) A.src.connect(recDest);
  }
  function micStop() { if (A.proc) { try { A.src.disconnect(); A.proc.disconnect(); } catch (e) { /* gone */ } A.proc = null; A.src = null; } }
  function micRestart() { if (A.proc) { micStop(); micStart(); } }
  /** Opus packets gathered since the last send become one record: [u16 length, packet]… */
  function flushOpus() {
    if (!A.pkts.length) return;
    var total = A.pkts.reduce(function (s, p) { return s + 2 + p.length; }, 0), buf = new Uint8Array(total), dv = new DataView(buf.buffer), at = 0;
    A.pkts.forEach(function (p) { dv.setUint16(at, p.length); buf.set(p, at + 2); at += 2 + p.length; });
    A.pkts = [];
    queueRecord(2, buf);
  }

  /* --- playing others' sound */
  var remoteUntil = 0, remoteLvl = 0;
  function playPCM(o, samples, rate) {
    if (!actx || !samples.length) return;
    var buf;
    try { buf = actx.createBuffer(1, samples.length, rate); buf.getChannelData(0).set(samples); }
    catch (e) { // very old Safari: only its own rate
      var outRate = actx.sampleRate, n = Math.round(samples.length * outRate / rate), d; buf = actx.createBuffer(1, n, outRate); d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) { var pos = i * rate / outRate, i0 = pos | 0, f = pos - i0; d[i] = samples[i0] + ((samples[Math.min(samples.length - 1, i0 + 1)] || 0) - samples[i0]) * f; }
    }
    var rms = 0; for (var j = 0; j < samples.length; j += 4) rms += samples[j] * samples[j]; rms = Math.sqrt(rms / (samples.length / 4));
    var now = actx.currentTime, t = o.next && o.next > now ? o.next : now + 0.1;
    if (t - now > 0.6) return; // too far behind: drop this piece to catch up
    var src = actx.createBufferSource(); src.buffer = buf; src.connect(out); src.start(t);
    o.next = t + buf.duration;
    remoteUntil = Math.max(remoteUntil, o.next); remoteLvl = Math.max(rms, remoteLvl * 0.7);
    o.level = Math.max(rms, (o.level || 0) * 0.6); o.spokeAt = Date.now();
    if (rms > 0.01) { talking(o, true); clearTimeout(o.talkT); o.talkT = setTimeout(function () { talking(o, false); }, (o.next - now) * 1000 + 200); }
  }
  function playUlaw(o, bytes) {
    var f = new Float32Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) f[i] = DEC[bytes[i]];
    playPCM(o, f, 16000);
  }
  function playOpus(o, bytes) {
    if (!window.AudioDecoder) return;
    if (!o.adec) {
      try {
        o.adec = new AudioDecoder({
          output: function (ad) { var f = new Float32Array(ad.numberOfFrames); try { ad.copyTo(f, { planeIndex: 0, format: 'f32-planar' }); } catch (e) { ad.copyTo(f, { planeIndex: 0 }); } var r = ad.sampleRate; ad.close(); playPCM(o, f, r); },
          error: function () { o.adec = null; }
        });
        o.adec.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
        o.ats = 0;
      } catch (e) { o.adec = null; return; }
    }
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), at = 0;
    while (at + 2 <= bytes.length) {
      var len = dv.getUint16(at); at += 2;
      if (at + len > bytes.length) break;
      try { o.adec.decode(new EncodedAudioChunk({ type: 'key', timestamp: o.ats, data: bytes.subarray(at, at + len) })); } catch (e) { o.adec = null; return; }
      o.ats += 20000; at += len;
    }
  }
  function talking(p, on) { if (p && p.tile) p.tile.classList.toggle('talk', !!on); }

  /* ------------------------------------------------------------ Video engine */
  var V = { mode: '', codec: '', enc: null, cfg: '', w: 0, h: 0, fps: 0, n: 0, forceKey: true, timer: 0, canvas: document.createElement('canvas'), busy: false, plan: null };
  var VQ = { low: 0, normal: 1, high: 2 }[info.video]; if (VQ === undefined) VQ = 1;
  /** Picture size and rate: from what others want to see, how many we are, and the quality setting. */
  function videoPlan() {
    var n = room.peers.length, need = room.need, share = !!sTrack;
    if (need === 'off' || (!want.cam && !share)) return null;
    if (share) return { w: 1280, fps: 5, br: 700000, q: 0.6 };
    var lv = need === 'hi' ? (n <= 2 ? 3 : n <= 4 ? 2 : 1) : 1;
    lv = Math.max(0, Math.min(3, lv + VQ - 1));
    return [{ w: 240, fps: 8, br: 90000, q: 0.45 }, { w: 320, fps: 12, br: 160000, q: 0.5 }, { w: 480, fps: 15, br: 300000, q: 0.55 }, { w: 640, fps: 20, br: 500000, q: 0.6 }][lv];
  }
  /** H.264/VP8 when every viewer can decode one of them, JPEG frames otherwise. */
  function videoCodec() {
    var others = room.peers.filter(function (p) { return p.id !== me.id; }).map(function (p) { return parseCaps(p.caps); });
    for (var i = 0; i < caps.ve.length; i++) {
      var c = caps.ve[i];
      if (others.every(function (o) { return o.vd.indexOf(c) >= 0; })) return c;
    }
    return 'jpeg';
  }
  function videoLoop() {
    clearTimeout(V.timer);
    if (!RELAY || me.state === 'gone') return;
    var plan = me.state === 'in' && R.q ? videoPlan() : null;
    V.plan = plan;
    if (plan) captureVideo(plan);
    V.timer = setTimeout(videoLoop, plan ? Math.round(1000 / (V.mode === 'jpeg' ? Math.min(plan.fps, 8) : plan.fps)) : 500);
  }
  function captureVideo(plan) {
    var v = peers.me && peers.me.video;
    if (!v || !v.videoWidth || V.busy) return;
    var w = Math.min(plan.w, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth / 2) * 2; w = Math.round(w / 2) * 2;
    var c = V.canvas; if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    var codec = videoCodec();
    if (codec !== 'jpeg') {
      var cfgKey = codec + w + 'x' + h + '@' + plan.br;
      if (!V.enc || V.cfg !== cfgKey) {
        try {
          if (!V.enc) V.enc = new VideoEncoder({ output: onVideoChunk, error: function () { V.enc = null; V.cfg = ''; } });
          var cfg = { codec: VCODEC[codec], width: w, height: h, bitrate: plan.br, framerate: plan.fps, latencyMode: 'realtime' };
          if (codec === 'avc') cfg.avc = { format: 'annexb' };
          V.enc.configure(cfg); V.cfg = cfgKey; V.codec = codec; V.w = w; V.h = h; V.forceKey = true;
        } catch (e) { V.enc = null; V.cfg = ''; codec = 'jpeg'; }
      }
      if (V.enc) {
        V.mode = 'vc';
        if (V.enc.encodeQueueSize > 2) return; // the device can't keep up: skip a frame
        try {
          var frame = new VideoFrame(c, { timestamp: Math.round(performance.now() * 1000) });
          var key = V.forceKey || V.n % (plan.fps * 2) === 0;
          V.enc.encode(frame, { keyFrame: key }); frame.close();
          V.forceKey = false; V.n++;
        } catch (e) { V.enc = null; V.cfg = ''; }
        return;
      }
    }
    V.mode = 'jpeg';
    V.busy = true;
    c.toBlob(function (b) {
      if (!b) { V.busy = false; return; }
      (b.arrayBuffer ? b.arrayBuffer() : new Response(b).arrayBuffer()).then(function (ab) { queueRecord(3, new Uint8Array(ab)); V.busy = false; }, function () { V.busy = false; });
    }, 'image/jpeg', plan.q);
  }
  function onVideoChunk(chunk) {
    var data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
    var rec = new Uint8Array(5 + data.length), dv = new DataView(rec.buffer);
    rec[0] = VCID[V.codec]; dv.setUint16(1, V.w); dv.setUint16(3, V.h); rec.set(data, 5);
    queueRecord(chunk.type === 'key' ? 4 : 5, rec);
  }
  function videoStop() { clearTimeout(V.timer); if (V.enc) { try { V.enc.close(); } catch (e) { /* */ } V.enc = null; V.cfg = ''; } }

  /* --- showing others' picture */
  function drawJpeg(o, bytes) {
    if (!o.img) return;
    useSurface(o, 'img');
    if (o.loading) { o.queued = bytes; return; } // still decoding the previous one: keep only the newest
    o.loading = true;
    var u = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })), old = o.url;
    o.img.onload = o.img.onerror = function () {
      if (old) URL.revokeObjectURL(old);
      o.tile.classList.add('has-frame'); o.loading = false; o.frameAt = Date.now();
      if (o.queued) { var q = o.queued; o.queued = null; drawJpeg(o, q); }
    };
    o.url = u; o.img.src = u;
  }
  function useSurface(o, kind) { if (o.surface !== kind) { o.surface = kind; o.img.hidden = kind !== 'img'; o.canvas.hidden = kind !== 'canvas'; } }
  function decodeVideo(o, type, bytes) {
    if (!window.VideoDecoder || bytes.length < 6) return;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), codec = VCNAME[bytes[0]], w = dv.getUint16(1), h = dv.getUint16(3), key = type === 4;
    if (!codec) return;
    var sig = codec + w + 'x' + h;
    if (!o.vdec || o.vsig !== sig) {
      if (!key) { askKey(o); return; }
      try {
        if (o.vdec) try { o.vdec.close(); } catch (e) { /* */ }
        o.vdec = new VideoDecoder({ output: function (f) { paintFrame(o, f); }, error: function () { o.vdec = null; o.vsig = ''; askKey(o); } });
        o.vdec.configure({ codec: VCODEC[codec], codedWidth: w, codedHeight: h, optimizeForLatency: true });
        o.vsig = sig; o.vts = 0; o.needKey = false;
      } catch (e) { o.vdec = null; o.vsig = ''; return; }
    }
    if (o.needKey && !key) return;
    if (key) o.needKey = false;
    if (o.vdec.decodeQueueSize > 8) { o.needKey = true; askKey(o); return; } // fell behind: start again from a fresh picture
    try { o.vdec.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: (o.vts += 33333), data: bytes.subarray(5) })); }
    catch (e) { o.needKey = true; askKey(o); }
  }
  function askKey(o) { if (!o.kfAt || Date.now() - o.kfAt > 2500) { o.kfAt = Date.now(); R.kf[o.id] = 1; } }
  function paintFrame(o, f) {
    if (!o.canvas) { f.close(); return; }
    useSurface(o, 'canvas');
    var c = o.canvas, w = f.displayWidth, h = f.displayHeight;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    c.getContext('2d').drawImage(f, 0, 0, w, h); f.close();
    o.tile.classList.add('has-frame'); o.frameAt = Date.now();
    o.nudge = !o.nudge; c.style.opacity = o.nudge ? '0.999' : '1'; // WebKit sometimes skips repainting a canvas
  }

  /* ------------------------------------------------------------ Relay transport */
  var R = { q: '', rest: false, busy: false, c: {}, kf: {}, out: [], outBytes: 0, fails: 0, timer: 0 };
  var net = { rtt: 0, bad: false };
  function queueRecord(type, bytes) {
    if (type >= 3) {
      // Slow network: never let pictures pile up; drop them and start the next from a fresh frame.
      if (R.outBytes > 400000) { R.out = R.out.filter(function (r) { return r[0] <= 2; }); R.outBytes = R.out.reduce(function (s, r) { return s + r[1].length; }, 0); V.forceKey = true; if (type === 5) return; }
      if (type === 3) { R.out = R.out.filter(function (r) { return r[0] !== 3; }); } // only the newest JPEG matters
    }
    R.out.push([type, bytes]); R.outBytes += bytes.length;
  }
  function wantsMap() {
    var w = {}, big = bigTile();
    Object.keys(peers).forEach(function (k) {
      if (k === 'me') return;
      var o = peers[k];
      w[k] = dataMode === 'audio' || document.hidden ? 'off' : dataMode === 'low' ? 'lo' : (big === o || (view === 'gallery' && room.peers.length <= 4) || o.tile.classList.contains('pin')) ? 'hi' : 'lo';
    });
    return w;
  }
  function b64enc(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_');
  }
  function b64dec(t) {
    var s = atob(t.replace(/\s+/g, '')), u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u.buffer;
  }
  function relayInterval() { var n = room.peers.length; return n <= 3 ? 120 : n <= 6 ? 200 : 300; }
  function relayTick() {
    clearTimeout(R.timer);
    if (!RELAY || me.state !== 'in' || !R.q) return;
    if (R.busy) { R.timer = setTimeout(relayTick, 60); return; }
    flushOpus();
    R.busy = true;
    var started = Date.now(), recs = R.out.splice(0); R.outBytes = 0;
    var kf = Object.keys(R.kf).map(Number); R.kf = {};
    var head = { r: recs.map(function (x) { return [x[0], x[1].length]; }), c: R.c, w: wantsMap(), kf: kf };
    var hj = new TextEncoder().encode(JSON.stringify(head)), total = 4 + hj.length;
    recs.forEach(function (x) { total += x[1].length; });
    var raw = new Uint8Array(total), at0 = 4 + hj.length;
    new DataView(raw.buffer).setUint32(0, hj.length); raw.set(hj, 4);
    recs.forEach(function (x) { raw.set(x[1], at0); at0 += x[1].length; });
    // shared hosts' web firewalls (ModSecurity, «406») refuse raw binary bodies: a base64 form field unless that fails too
    var url = (R.rest ? C.api + '/relay?' : info.relay + '?') + R.q + (R.raw ? '' : '&t=1');
    var h = R.rest && C.nonce ? { 'X-WP-Nonce': C.nonce } : {};
    if (!R.raw) h['Content-Type'] = 'application/x-www-form-urlencoded';
    var body = R.raw ? new Blob([raw], { type: 'application/octet-stream' }) : 'd=' + b64enc(raw);
    fetch(url, { method: 'POST', body: body, headers: h, credentials: R.rest ? 'same-origin' : 'omit', cache: 'no-store' })
      .then(function (r) { if (!r.ok) { var e = new Error('relay'); e.status = r.status; throw e; } return R.raw ? r.arrayBuffer() : r.text().then(b64dec); })
      .then(function (ab) {
        R.fails = 0;
        var rtt = Date.now() - started; net.rtt = net.rtt ? Math.round(net.rtt * 0.8 + rtt * 0.2) : rtt; net.bad = false;
        var dv = new DataView(ab), jl = dv.getUint32(0), res = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, jl))), at = 4 + jl;
        R.c = res.c || {};
        res.items.forEach(function (it) {
          var o = peers[it[0]], bytes = new Uint8Array(ab, at, it[2]); at += it[2];
          if (!o || !o.tile) return;
          if (it[1] === 1) playUlaw(o, bytes);
          else if (it[1] === 2) playOpus(o, bytes);
          else if (it[1] === 3) drawJpeg(o, bytes.slice());
          else decodeVideo(o, it[1], bytes.slice());
        });
      })
      .catch(function (e) {
        R.fails++; net.bad = R.fails > 2;
        if ((e.status === 403 || e.status === 404 || e.status === 503 || e.status === 500 || e.status === 405 || e.status === 406 || e.status === 415 || !e.status) && R.fails > 1) {
          if (!R.rest) { R.rest = true; R.fails = 0; } // relay.php blocked → WordPress route
          else if (!R.raw && (e.status === 406 || e.status === 415 || e.status === 403)) { R.raw = true; R.rest = false; R.fails = 0; }
        }
        if (recs.length && R.fails < 3) recs.filter(function (x) { return x[0] <= 2; }).forEach(function (x) { R.out.unshift(x); }); // keep sound across a short hiccup
        if (e.status === 410 || (e.status === 403 && R.rest && R.raw)) R.q = ''; // ended / removed: the next poll explains
      })
      .then(function () { R.busy = false; paintBars(); R.timer = setTimeout(relayTick, Math.max(20, relayInterval() - (Date.now() - started)) + (R.fails > 3 ? 1500 : 0)); });
  }

  /* ------------------------------------------------------------ Join screen */
  var fields = $('#pre-fields');
  function nameValue() { var n = $('#j-name'); return n ? n.value.trim() : (info.invite && info.invite.name) || info.client || ''; }
  if (info.user) {
    fields.append(el('div', { class: 'who' }, info.user.avatar ? el('img', { src: info.user.avatar, alt: '' }) : el('span', { class: 'av', text: initials(info.user.name) }),
      el('div', null, el('b', { text: info.user.name }), el('small', { text: info.user.host ? 'میزبان جلسه' : 'همکار' }))));
    if (info.user.host && !info.permanent) $('#join-btn').textContent = info.status === 'live' ? 'ورود به جلسه' : 'شروع جلسه';
  } else {
    var saved = ''; try { saved = localStorage.getItem('mp-meet-name') || ''; } catch (e) { /* private */ }
    fields.append(el('label', { class: 'fld' }, el('span', { text: 'نام شما' }), el('input', { id: 'j-name', required: true, maxlength: 60, placeholder: 'مثلاً علی رضایی', value: (info.invite && info.invite.name) || info.client || saved })));
    if (info.invite) fields.append(el('p', { class: 'ok-note', text: info.invite.used ? 'این لینک دعوت قبلاً استفاده شده؛ فقط از همان دستگاه قبلی می‌توانید دوباره وارد شوید.' : 'دعوت اختصاصی شما؛ بدون رمز و بدون انتظار وارد می‌شوید.' }));
    if (info.client !== null && info.client !== undefined) fields.append(el('p', { class: 'ok-note', text: 'از پرتال پروژه آمده‌اید؛ مستقیم وارد جلسه می‌شوید.' }));
  }
  if (info.password) fields.append(el('label', { class: 'fld' }, el('span', { text: 'رمز جلسه' }), el('input', { id: 'j-pass', required: true, maxlength: 64, dir: 'ltr', inputmode: 'text' })));
  if (info.locked && !(info.user && info.user.host)) fields.append(el('p', { class: 'err', text: 'میزبان جلسه را قفل کرده است.' }));
  if (info.status === 'ended' && !(info.user && info.user.host)) { $('#join-btn').disabled = true; $('#join-err').textContent = 'این جلسه به پایان رسیده است.'; }

  startPreview();
  $('#pv-retry').onclick = function () { startPreview(); };
  $('#pv-mic').onclick = function () { want.mic = !want.mic; applyLocal(); };
  $('#pv-cam').onclick = function () { want.cam = !want.cam; applyLocal(); };
  $('#pv-flip').onclick = flipCamera;
  $('#pv-dev').onclick = devicesDialog;
  $('#pv-test').onclick = function () { audioUnlock(); chime(); meterOn($('#pv-meter')); toast('صدای زنگ را شنیدید؟ با صحبت کردن، نوار سبز روی تصویر باید حرکت کند.', 5000); };

  function joinBody() {
    return { name: nameValue(), password: $('#j-pass') ? $('#j-pass').value : '', mic: want.mic, cam: want.cam, ckey: ckey, caps: capsStr, i: C.pass.i || '', c: C.pass.c || '', cs: C.pass.cs || '' };
  }
  $('#join-form').onsubmit = function (e) {
    e.preventDefault();
    var btn = $('#join-btn'), err = $('#join-err');
    err.textContent = ''; btn.disabled = true;
    audioUnlock(); meterOff();
    var before = local ? Promise.resolve(local) : startPreview();
    var name = nameValue(); try { if (name && !info.user) localStorage.setItem('mp-meet-name', name); } catch (x) { /* private */ }
    Promise.all([before, capsReady]).then(function () { return api('/join', joinBody()); })
      .then(function (d) {
        me = { id: d.peer, secret: d.secret, role: d.role, state: d.state };
        if (d.state === 'waiting') { show('wait'); poll(); } else enter();
      })
      .catch(function (x) { btn.disabled = false; err.textContent = x.message; });
  };

  /* ------------------------------------------------------------ Room */
  function enter() {
    show('room');
    startAt = Date.now();
    peers.me = { id: me.id, tile: null, stream: local };
    makeTile(peers.me, true);
    applyLocal();
    poll();
    tick();
    setInterval(sendNet, 5000);
  }
  function rejoin() {
    // After a long drop the server let us go: come back with the same browser key (no waiting room).
    return api('/join', joinBody()).then(function (d) {
      me.id = d.peer; me.secret = d.secret; me.role = d.role; me.state = d.state;
      R.q = ''; R.c = {}; after = 0;
      Object.keys(peers).forEach(function (k) { if (k !== 'me') drop(k); });
      if (peers.me) peers.me.id = me.id;
      if (d.state === 'waiting') { show('wait'); }
      poll();
    });
  }

  function makeTile(p, mine) {
    var media;
    if (mine || !RELAY) media = el('video', { autoplay: true, playsinline: true, 'webkit-playsinline': true });
    else { p.img = el('img', { alt: '', decoding: 'async' }); p.canvas = el('canvas', { width: 16, height: 9, hidden: true }); p.surface = 'img'; }
    if (mine) { media.muted = true; media.setAttribute('muted', ''); }
    var t = el('div', { class: 'tile' + (mine ? ' mine' : RELAY ? ' relay' : '') }, media || [p.img, p.canvas],
      el('div', { class: 'ph' }, el('span', { class: 'av' })),
      el('span', { class: 'net' }), el('span', { class: 'away-tag', text: 'بیرون از صفحه' }),
      el('div', { class: 'tag' }, el('i', { class: 'm', html: ic('mic-off') }), el('b'), el('i', { class: 'h', html: ic('hand') }), el('span', { class: 'bars' }, el('i'), el('i'), el('i'), el('i'))));
    p.tile = t; p.video = media || null;
    if (p.stream && media) { media.srcObject = p.stream; media.play().catch(function () {}); }
    t.ondblclick = function () { var on = !t.classList.contains('pin'); $$('#mt-grid .tile.pin').forEach(function (x) { x.classList.remove('pin'); }); t.classList.toggle('pin', on); layout(); };
    $('#mt-grid').append(t);
    layout();
  }
  function bars(n) { return n <= 0 ? 0 : n < 300 ? 4 : n < 700 ? 3 : n < 1500 ? 2 : 1; }
  function paintTile(p, s) {
    if (!p.tile) return;
    p.tile.querySelector('.tag b').textContent = s.name;
    var av = p.tile.querySelector('.ph .av');
    if (s.avatar && av.dataset.src !== s.avatar) { av.dataset.src = s.avatar; av.replaceChildren(el('img', { src: s.avatar, alt: '' })); }
    else if (!s.avatar) av.textContent = initials(s.name.replace(' (شما)', ''));
    p.tile.classList.toggle('cam-off', !s.cam);
    p.tile.classList.toggle('mic-off', !s.mic);
    p.tile.classList.toggle('hand', !!s.hand);
    p.tile.classList.toggle('share', !!s.share);
    p.tile.classList.toggle('away', !!s.away);
    p.tile.querySelector('.bars').dataset.n = s.rtt ? bars(s.rtt) : '';
  }
  function bigTile() {
    var pinned = $('#mt-grid .tile.pin, #mt-grid .tile.share');
    if (pinned) { var k = Object.keys(peers).filter(function (x) { return peers[x].tile === pinned; })[0]; return k ? peers[k] : null; }
    if (view !== 'speaker') return null;
    return peers[active] || null;
  }
  function layout() {
    var g = $('#mt-grid'), n = g.children.length, big = bigTile();
    g.dataset.n = n > 9 ? 'many' : n;
    $$('.tile.big', g).forEach(function (t) { if (!big || t !== big.tile) t.classList.remove('big'); });
    if (big && big.tile) big.tile.classList.add('big');
    g.classList.toggle('pinned', !!big || !!room.stage);
    g.classList.toggle('strip', !!room.stage);
  }
  /** Speaker view follows whoever is talking (held for 2 seconds to avoid flicker). */
  function pickSpeaker() {
    var best = 0, lv = 0, now = Date.now();
    Object.keys(peers).forEach(function (k) { if (k === 'me') return; var o = peers[k]; if (o.spokeAt && now - o.spokeAt < 1500 && (o.level || 0) > lv) { lv = o.level; best = +k; } });
    if (best && best !== active && now - activeAt > 2000) { active = best; activeAt = now; layout(); }
    if (!peers[active]) { var first = Object.keys(peers).filter(function (k) { return k !== 'me'; })[0]; active = first ? +first : 0; layout(); }
  }
  setInterval(function () { if (view === 'speaker') pickSpeaker(); }, 400);

  function drop(pid) {
    var o = peers[pid]; if (!o) return;
    clearTimeout(o.slow); clearTimeout(o.talkT);
    if (o.pc) try { o.pc.close(); } catch (e) { /* closed */ }
    if (o.vdec) try { o.vdec.close(); } catch (e) { /* */ }
    if (o.adec) try { o.adec.close(); } catch (e) { /* */ }
    if (o.url) URL.revokeObjectURL(o.url);
    if (o.tile) o.tile.remove();
    delete peers[pid];
    layout();
  }

  /* ------------------------------------------------------------ WebRTC mode (optional) */
  function setNet(o, st) {
    if (!o.tile) return;
    o.tile.dataset.net = st;
    o.tile.querySelector('.net').textContent = st === 'connecting' ? 'در حال اتصال…' : st === 'weak' ? 'اتصال ضعیف…' : st === 'failed' ? 'اتصال برقرار نشد' : '';
  }
  var hinted = false;
  function slowHint() {
    if (hinted) return; hinted = true;
    toast(isHost() ? 'ارتباط مستقیم با بعضی شرکت‌کنندگان برقرار نشد. در پنل ← جلسات ← تنظیمات، روش «از طریق همین سایت» را انتخاب کنید.' : 'ارتباط تصویری برقرار نشد؛ به میزبان خبر دهید.', 9000);
  }
  function play(v) { if (!v || !v.srcObject) return; var pr = v.play(); if (pr && pr.catch) pr.catch(function () { $('#tap-play').hidden = false; }); }
  $('#tap-play').onclick = function () { $('#tap-play').hidden = true; $$('#mt-grid video').forEach(function (v) { v.play().catch(function () {}); }); };
  function conn(pid, init) {
    var pc = new RTCPeerConnection({ iceServers: ice });
    var o = { id: pid, pc: pc, q: [], stream: new MediaStream(), init: init, a: null, v: null };
    pc.ontrack = function (e) {
      var tracks = o.stream.getTracks().filter(function (t) { return t.kind !== e.track.kind; }).concat([e.track]);
      o.stream = new MediaStream(tracks);
      if (o.video) { o.video.srcObject = o.stream; play(o.video); }
    };
    pc.onicecandidate = function (e) { if (e.candidate) signal(pid, 'ice', e.candidate.toJSON()); };
    function state() {
      var st = pc.iceConnectionState, c = pc.connectionState || st;
      var ok = st === 'connected' || st === 'completed' || c === 'connected', bad = st === 'failed' || c === 'failed';
      setNet(o, ok ? '' : bad ? 'failed' : st === 'disconnected' ? 'weak' : 'connecting');
      if (ok) { clearTimeout(o.slow); o.connected = true; play(o.video); }
      if (bad && o.init && !o.restarted) { o.restarted = true; offer(o, true); }
      if (bad) slowHint();
    }
    pc.oniceconnectionstatechange = state; pc.onconnectionstatechange = state;
    o.slow = setTimeout(function () { if (!o.connected) { setNet(o, 'failed'); slowHint(); } }, 20000);
    if (init) { o.a = pc.addTransceiver('audio', { direction: 'sendrecv' }); o.v = pc.addTransceiver('video', { direction: 'sendrecv' }); attach(o); }
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
  function signal(to, kind, body) { return api('/signal', auth({ to: to, kind: kind, body: body })).catch(function () {}); }
  var chain = Promise.resolve();
  function onSignal(s) {
    var o = peers[s.from];
    if (s.kind === 'mute') { if (want.mic) { want.mic = false; applyLocal(); sendState(); toast('میزبان میکروفون شما را بست'); } return Promise.resolve(); }
    if (RELAY) return Promise.resolve();
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
    if (!o || !o.pc) return Promise.resolve();
    if (s.kind === 'answer') return o.pc.setRemoteDescription(s.body).then(function () { flushIce(o); }).catch(function () {});
    if (s.kind === 'ice') { if (o.pc.remoteDescription) return o.pc.addIceCandidate(s.body).catch(function () {}); o.q.push(s.body); }
    return Promise.resolve();
  }
  function flushIce(o) { o.q.splice(0).forEach(function (c) { o.pc.addIceCandidate(c).catch(function () {}); }); }

  /* ------------------------------------------------------------ Polling: room state */
  function poll() {
    clearTimeout(pollTimer);
    if (polling || leaving) return;
    polling = true;
    var t0 = Date.now();
    api('/poll', auth({ after: after, chat: chatAfter, wants: me.state === 'in' ? wantsMap() : undefined })).then(function (d) {
      polling = false;
      if (failures > 1) { $('#net-banner').hidden = true; toast('دوباره وصل شدید'); }
      failures = 0;
      if (!RELAY) { var rtt = Date.now() - t0; net.rtt = net.rtt ? Math.round(net.rtt * 0.8 + rtt * 0.2) : rtt; }
      if (d.status === 'ended') return finish('ended');
      if (d.me.state === 'rejected') return finish('rejected');
      if (d.me.state === 'kicked') return finish('kicked');
      if (d.me.state === 'left') { if (!leaving) return rejoin().catch(function () { finish('left'); }); return; }
      if (me.state === 'waiting') {
        if (d.me.state === 'in') { me.state = 'in'; enter(); return; }
        $('#wait-text').textContent = d.host_here ? 'میزبان به‌زودی ورود شما را تأیید می‌کند. این صفحه را نبندید.' : 'میزبان هنوز وارد جلسه نشده است؛ به‌محض ورود، درخواست شما را می‌بیند.';
        pollTimer = setTimeout(poll, 2000);
        return;
      }
      me.state = d.me.state; me.role = d.me.role;
      remaining = d.remaining;
      var lockChanged = room.micLock !== d.mic_lock || room.allow !== d.me.allow;
      room.peers = d.peers; room.waiting = d.waiting; room.micLock = d.mic_lock; room.locked = d.locked; room.allow = d.me.allow; room.need = d.need; room.recording = d.recording;
      if (lockChanged) { if (micBlocked() && want.mic) { want.mic = false; sendState(); } applyLocal(); if (d.me.allow && d.mic_lock) toast('میزبان اجازه صحبت داد؛ میکروفون را روشن کنید'); }
      if (RELAY && d.relay) { var first = !R.q; R.q = d.relay; if (first) { micStart(); relayTick(); videoLoop(); } }
      sync(d);
      chat(d.chat);
      stage(d.stage);
      $('#rec-chip').hidden = !d.recording;
      $('#lock-chip').hidden = !d.locked;
      d.signals.forEach(function (s) { after = Math.max(after, s.id); chain = chain.then(function () { return onSignal(s); }); });
      polled++;
      pollTimer = setTimeout(poll, d.signals.length ? 400 : 1200);
    }).catch(function (e) {
      polling = false;
      failures++;
      if (failures > 1) $('#net-banner').hidden = me.state !== 'in';
      if ((e.status === 403 || e.status === 404) && !leaving) { return rejoin().catch(function () { finish('left'); }); }
      pollTimer = setTimeout(poll, Math.min(5000, 1000 + failures * 500));
    });
  }

  var lastPeers = [];
  function sync(d) {
    var ids = {};
    d.peers.forEach(function (p) {
      if (p.id === me.id) { if (peers.me) peers.me.tile.querySelector('.bars').dataset.n = bars(net.rtt); return; }
      ids[p.id] = 1;
      var o = peers[p.id];
      if (!o && RELAY) {
        o = peers[p.id] = { id: p.id };
        makeTile(o, false);
        if (lastPeers.length) toast(p.name + ' وارد جلسه شد');
        V.forceKey = true; // the newcomer needs a fresh picture
      } else if (!o) {
        o = conn(p.id, me.id > p.id); // the newcomer calls everyone already in the room
        if (o.init) offer(o);
        if (lastPeers.length) toast(p.name + ' وارد جلسه شد');
      }
      o.name = p.name;
      paintTile(o, p);
    });
    Object.keys(peers).forEach(function (k) { if (k !== 'me' && !ids[k]) { var nm = peers[k].name; drop(k); if (nm) toast(nm + ' از جلسه خارج شد'); } });
    lastPeers = d.peers;
    $('#b-count').textContent = fa(d.peers.length);
    renderPeople(d);
    if (isHost() && d.waiting.length > lastWaiting) toast(d.waiting[d.waiting.length - 1].name + ' منتظر تأیید ورود است');
    if (isHost() && d.mic_lock) { var hands = d.peers.filter(function (p) { return p.hand && !p.allow && p.id !== me.id; }); if (hands.length && hands.length > (sync.hands || 0)) toast(hands[hands.length - 1].name + ' اجازه صحبت می‌خواهد'); sync.hands = hands.length; }
    lastWaiting = d.waiting.length;
    $('#b-wait').hidden = !d.waiting.length;
    layout();
  }
  function paintBars() { $('#my-bars').dataset.n = net.bad ? 1 : bars(net.rtt); }
  function sendNet() { if (me.state === 'in' && net.rtt) api('/state', auth({ rtt: net.rtt })).catch(function () {}); }

  /* ------------------------------------------------------------ Participants & host tools */
  function roleName(r) { return { host: 'میزبان', cohost: 'میزبان کمکی', guest: 'مهمان', member: 'همکار' }[r] || ''; }
  function control(what, extra) { return api('/control', auth(Object.assign({ what: what }, extra || {}))).then(function () { poll(); }).catch(function (e) { toast(e.message); }); }
  function renderPeople(d) {
    var ht = $('#host-tools'); ht.replaceChildren();
    if (isHost()) {
      ht.append(el('div', { class: 'host-row' },
        el('button', { type: 'button', class: 'btn sm ghost', html: ic('mic-off') + 'بستن میکروفون همه', onclick: function () { control('muteall'); toast('میکروفون همه بسته شد'); } }),
        el('button', { type: 'button', class: 'btn sm ' + (d.mic_lock ? 'primary' : 'ghost'), html: ic('lock') + (d.mic_lock ? 'میکروفون‌ها قفل است' : 'قفل میکروفون‌ها'), onclick: function () { control('miclock', { on: !d.mic_lock }); } }),
        el('button', { type: 'button', class: 'btn sm ' + (d.locked ? 'primary' : 'ghost'), html: ic('lock') + (d.locked ? 'جلسه قفل است' : 'قفل جلسه'), onclick: function () { control('lock', { on: !d.locked }); } })));
    }
    var wb = $('#waiting-box'); wb.replaceChildren();
    if (isHost() && d.waiting.length) {
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
    d.peers.slice().sort(function (a, b) { return (b.hand - a.hand) || 0; }).forEach(function (p) {
      var row = el('div', { class: 'pp' }, p.avatar ? el('img', { class: 'av', src: p.avatar, alt: '' }) : el('span', { class: 'av', text: initials(p.name) }),
        el('div', { class: 'nm' }, el('b', { text: p.name + (p.id === me.id ? ' (شما)' : '') }), el('small', { text: roleName(p.role) + (p.away ? ' · بیرون از صفحه' : '') })),
        el('span', { class: 'bars sm', 'data-n': p.id === me.id ? bars(net.rtt) : bars(p.rtt) }, el('i'), el('i'), el('i'), el('i')),
        p.hand ? el('i', { class: 'st hand', html: ic('hand') }) : null,
        el('i', { class: 'st' + (p.mic ? '' : ' off'), html: ic(p.mic ? 'mic' : 'mic-off') }));
      if (isHost() && p.id !== me.id && p.role !== 'host') {
        var act = el('div', { class: 'pp-act' }); row.append(act); row = act;
        if (d.mic_lock) row.append(el('button', { type: 'button', class: 'btn xs ' + (p.allow ? 'ghost' : 'primary'), text: p.allow ? 'پس گرفتن' : 'اجازه صحبت', onclick: function () { control('allow', { target: p.id, on: !p.allow }); } }));
        else if (p.mic) row.append(el('button', { type: 'button', class: 'rb xs', title: 'بستن میکروفون', html: ic('mic-off'), onclick: function () { signal(p.id, 'mute', {}); toast('میکروفون ' + p.name + ' بسته شد'); } }));
        if (me.role === 'host') row.append(el('button', { type: 'button', class: 'rb xs' + (p.role === 'cohost' ? ' on' : ''), title: p.role === 'cohost' ? 'برداشتن میزبان کمکی' : 'میزبان کمکی شود', html: ic('star'), onclick: function () { control('cohost', { target: p.id, on: p.role !== 'cohost' }); } }));
        row.append(el('button', { type: 'button', class: 'rb xs red', title: 'حذف از جلسه', html: ic('close'), onclick: function () { if (confirm(p.name + ' از جلسه حذف شود؟')) api('/kick', auth({ target: p.id })).then(poll); } }));
        row = act.parentNode;
      }
      pb.append(row);
    });
  }
  function admit(target, ok) { api('/admit', auth({ target: target, ok: ok })).then(function () { poll(); }).catch(function (e) { toast(e.message); }); }

  /* ------------------------------------------------------------ Chat, reactions, cards */
  var chatOpen = false, unread = 0;
  function sideTab(name) {
    $$('.side-tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
    $('#pane-people').hidden = name !== 'people'; $('#pane-chat').hidden = name !== 'chat';
    chatOpen = name === 'chat' && !$('#side').hidden;
    if (chatOpen) { unread = 0; $('#chat-badge').hidden = true; $('#b-chat-dot').hidden = true; var l = $('#chat-list'); l.scrollTop = l.scrollHeight; setTimeout(function () { if (!MOBILE) $('#chat-input').focus(); }, 50); }
  }
  $$('.side-tabs button').forEach(function (b) { b.onclick = function () { sideTab(b.dataset.tab); }; });
  function openSide(tab) { $('#side').hidden = false; sideTab(tab); }
  function chat(items) {
    if (!items || !items.length) return;
    var list = $('#chat-list'), atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 60, fresh = 0;
    items.forEach(function (c) {
      chatAfter = Math.max(chatAfter, c.id);
      if (c.kind === 'react') { if (polled > 0) floatReact(c); return; }
      if ($('[data-cid="' + c.id + '"]', list)) return;
      list.append(chatRow(c));
      if (!c.mine && c.kind !== 'system' && polled > 0) fresh++;
    });
    if (atEnd || !polled) list.scrollTop = list.scrollHeight;
    if (fresh && !chatOpen) { unread += fresh; $('#chat-badge').textContent = fa(unread); $('#chat-badge').hidden = false; $('#b-chat-dot').hidden = false; var last = items[items.length - 1]; if (last.kind === 'msg') toast(last.name + ': ' + (last.body || 'فایل')); }
  }
  function chatRow(c) {
    var time = c.at ? fa(c.at.slice(11, 16)) : '';
    if (c.kind === 'system') return el('div', { class: 'cm sys', 'data-cid': c.id, text: c.body });
    var body = el('div', { class: 'cm-body' });
    if (c.body) body.append(el('p', { text: c.body }));
    if (c.file) body.append(c.file.image ? el('a', { href: c.file.url, target: '_blank', rel: 'noopener', class: 'cm-img' }, el('img', { src: c.file.url, alt: c.file.name, loading: 'lazy' }))
      : el('a', { href: c.file.url, target: '_blank', rel: 'noopener', class: 'cm-file', html: ic('file') }, c.file.name));
    if (c.kind === 'card' && c.meta && c.meta.t === 'contract') body.append(el('a', { class: 'cm-card', href: c.meta.url, target: '_blank', rel: 'noopener' }, el('b', { text: c.meta.title }), el('small', { text: 'قرارداد ' + fa(c.meta.number || '') + ' · برای مطالعه و امضا بزنید' })));
    var tools = info.user && c.kind === 'msg' && c.body ? el('button', { type: 'button', class: 'cm-task', text: '+ تسک', title: 'ساخت تسک از این پیام', onclick: function () { taskFrom(c); } }) : null;
    return el('div', { class: 'cm' + (c.mine ? ' mine' : ''), 'data-cid': c.id }, el('div', { class: 'cm-head' }, el('b', { text: c.mine ? 'شما' : c.name }), el('small', { text: time }), tools), body);
  }
  $('#chat-form').onsubmit = function (e) {
    e.preventDefault();
    var i = $('#chat-input'), body = i.value.trim(); if (!body) return;
    i.value = '';
    api('/chat', auth({ body: body })).then(function (c) { chat([c]); var l = $('#chat-list'); l.scrollTop = l.scrollHeight; }).catch(function (x) { i.value = body; toast(x.message); });
  };
  $('#chat-file').onchange = function () {
    var f = this.files[0]; this.value = ''; if (!f) return;
    var fd = new FormData(); fd.append('file', f); fd.append('peer', me.id); fd.append('secret', me.secret);
    toast('در حال فرستادن فایل…');
    fetch(C.api + '/chat-file', { method: 'POST', body: fd, credentials: 'same-origin', headers: C.nonce ? { 'X-WP-Nonce': C.nonce } : {} })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.message || 'ارسال نشد'); return d; }); })
      .then(function (c) { chat([c]); toast('فایل فرستاده شد'); }).catch(function (x) { toast(x.message); });
  };
  /** A task from a chat message (colleagues only): who and when, then a note in the chat. */
  function taskFrom(c) {
    var title = el('input', { class: 'inp', value: c.body.slice(0, 200), maxlength: 200 });
    var who = el('select', { class: 'sel' }, (info.users || []).map(function (u) { return el('option', { value: u.id, selected: u.id === info.user.id, text: u.name + (u.id === info.user.id ? ' (خودم)' : '') }); }));
    var d0 = new Date(), iso = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    var day = iso(d0), chips = el('div', { class: 'chips' });
    [['امروز', 0], ['فردا', 1], ['پس‌فردا', 2], ['هفته بعد', 7]].forEach(function (x, i) {
      var d = new Date(d0.getTime() + x[1] * 864e5);
      chips.append(el('button', { type: 'button', class: 'chip' + (i === 0 ? ' on' : ''), text: x[0], onclick: function (e) { day = iso(d); $$('.chip', chips).forEach(function (b) { b.classList.remove('on'); }); e.target.classList.add('on'); } }));
    });
    modal('ساخت تسک از پیام', el('form', { class: 'task-form', onsubmit: function (e) {
      e.preventDefault();
      rest('tasks', { body: { title: title.value.trim(), user_id: +who.value, date: day, project_id: info.project || 0, description: 'از گفت‌وگوی جلسه «' + document.title.replace('جلسه: ', '') + '» — ' + c.name } })
        .then(function () { closeModal(); var nm = who.options[who.selectedIndex].text.replace(' (خودم)', ''); toast('تسک ساخته شد'); api('/chat', auth({ kind: 'system', body: '✓ تسک «' + title.value.trim() + '» برای ' + nm + ' ساخته شد.' })).then(function (x) { chat([x]); }); })
        .catch(function (x) { toast(x.message); });
    } }, el('label', { class: 'fld' }, el('span', { text: 'عنوان' }), title), el('label', { class: 'fld' }, el('span', { text: 'مسئول' }), who), el('div', { class: 'fld' }, el('span', { text: 'موعد' }), chips),
      el('button', { type: 'submit', class: 'btn primary', text: 'ساخت تسک' })));
  }
  var EMOJI = ['👍', '❤️', '😂', '👏', '🎉', '🙏'];
  $('#react-sheet').append.apply($('#react-sheet'), EMOJI.map(function (x) { return el('button', { type: 'button', class: 'emo', text: x, onclick: function () { $('#react-sheet').hidden = true; api('/chat', auth({ kind: 'react', body: x })).then(function (c) { floatReact(c); }).catch(function () {}); } }); }));
  $('#b-react').onclick = function (e) { e.stopPropagation(); $('#more-menu').hidden = true; $('#react-sheet').hidden = !$('#react-sheet').hidden; };
  var shownReacts = {};
  function floatReact(c) {
    if (shownReacts[c.id]) return; shownReacts[c.id] = 1;
    var o = c.peer === me.id ? peers.me : peers[c.peer], host = o && o.tile ? o.tile : $('#mt-grid');
    var n = el('span', { class: 'fly', text: c.body }); n.style.insetInlineStart = (20 + Math.random() * 50) + '%';
    host.append(n); setTimeout(function () { n.remove(); }, 2600);
  }

  /* ------------------------------------------------------------ Design review */
  var stageItem = 0;
  function stage(s) {
    room.stage = s;
    var box = $('#design');
    box.hidden = !s;
    $('#design-close').hidden = !isHost();
    if (!s) { stageItem = 0; layout(); return; }
    if (stageItem !== s.item) { stageItem = s.item; $('#design-img').src = s.url; $('#design-title').textContent = s.title + (s.version > 1 ? ' · نسخه ' + fa(s.version) : ''); }
    var pins = $('#design-pins'); pins.replaceChildren();
    var n = 0;
    s.pins.forEach(function (p) {
      if (p.parent) return;
      n++;
      var dot = el('button', { type: 'button', class: 'pin' + (p.resolved ? ' done' : ''), text: fa(n), title: p.name + ': ' + p.body });
      dot.style.left = p.x + '%'; dot.style.top = p.y + '%';
      dot.onclick = function (e) { e.stopPropagation(); toast((p.name || 'مهمان') + ': ' + p.body, 6000); };
      pins.append(dot);
    });
    layout(); fitPins();
  }
  /** The pin layer covers exactly the image as it is drawn. */
  function fitPins() {
    var img = $('#design-img'), p = $('#design-pins');
    p.style.left = img.offsetLeft + 'px'; p.style.top = img.offsetTop + 'px'; p.style.width = img.offsetWidth + 'px'; p.style.height = img.offsetHeight + 'px';
  }
  $('#design-img').onload = fitPins;
  window.addEventListener('resize', function () { if (room.stage) fitPins(); });
  $('#design-box').onclick = function (e) {
    if (e.target.closest('.pin') || e.target.closest('.pin-form')) return;
    var img = $('#design-img'), r = img.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    var x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 100;
    $$('.pin-form').forEach(function (f) { f.remove(); });
    var inp = el('input', { class: 'inp', placeholder: 'نظر شما درباره این نقطه…', maxlength: 1000 });
    var f = el('form', { class: 'pin-form', onsubmit: function (ev) {
      ev.preventDefault(); if (!inp.value.trim()) return;
      api('/pin', auth({ x: x, y: y, body: inp.value.trim() })).then(function () { f.remove(); toast('نظر ثبت شد و در پرتال پروژه هم دیده می‌شود'); poll(); }).catch(function (x2) { toast(x2.message); });
    } }, inp, el('button', { type: 'submit', class: 'btn sm primary', text: 'ثبت' }));
    f.style.left = x + '%'; f.style.top = y + '%';
    $('#design-pins').append(f); inp.focus();
  };
  $('#design-close').onclick = function () { api('/stage', auth({ item: 0 })).then(poll); };
  function library(kind) {
    api('/library', auth()).then(function (lib) {
      if (kind === 'design') {
        if (!lib.designs.length) { toast('طرحی برای این پروژه بارگذاری نشده است'); return; }
        modal('نمایش طرح برای همه', el('div', { class: 'lib' }, lib.designs.map(function (d) {
          return el('button', { type: 'button', class: 'lib-item', onclick: function () { closeModal(); api('/stage', auth({ item: d.id })).then(poll); } }, el('img', { src: d.url, alt: '', loading: 'lazy' }), el('b', { text: d.title }));
        })));
      } else {
        if (!lib.contracts.length) { toast('قراردادی برای این پروژه ارسال نشده است'); return; }
        modal('ارسال قرارداد برای امضا', el('div', { class: 'lib list' }, lib.contracts.map(function (c) {
          return el('button', { type: 'button', class: 'lib-row', onclick: function () { closeModal(); var tok = c.url.split('/k/')[1] || ''; tok = tok.replace(/[^A-Za-z0-9]/g, '') || (c.url.match(/mp_contract=([A-Za-z0-9]+)/) || [])[1]; api('/chat', auth({ kind: 'card', card: tok })).then(function (x) { chat([x]); openSide('chat'); }).catch(function (x) { toast(x.message); }); } },
            el('b', { text: c.title }), el('small', { text: fa(c.number) + ' · ' + ({ sent: 'منتظر امضا', client_signed: 'امضای مشتری', signed: 'امضاشده' }[c.status] || c.status) }));
        })));
      }
    }).catch(function (e) { toast(e.message); });
  }

  /* ------------------------------------------------------------ More menu */
  function moreMenu() {
    var m = $('#more-menu'), items = [];
    function item(icon, text, fn, on) { items.push(el('button', { type: 'button', class: 'mi' + (on ? ' on' : ''), html: ic(icon) + '<span>' + text + '</span>', onclick: function () { m.hidden = true; fn(); } })); }
    item(view === 'gallery' ? 'speaker-view' : 'grid4', view === 'gallery' ? 'نمای سخنران' : 'نمای گالری', function () { view = view === 'gallery' ? 'speaker' : 'gallery'; pickSpeaker(); layout(); });
    item('data', dataMode === 'all' ? 'حالت کم‌مصرف' : dataMode === 'low' ? 'فقط صدا (بدون تصویر دیگران)' : 'کیفیت معمولی تصویر', function () { dataMode = dataMode === 'all' ? 'low' : dataMode === 'low' ? 'audio' : 'all'; toast({ all: 'کیفیت معمولی', low: 'حالت کم‌مصرف: تصویر دیگران کوچک‌تر', audio: 'فقط صدا: تصویر دیگران دریافت نمی‌شود' }[dataMode]); }, dataMode !== 'all');
    if (pipSupported()) item('pip', 'تصویر در تصویر', pip);
    if (flipAvailable) item('flip', 'دوربین جلو / عقب', flipCamera);
    item('screen', sTrack ? 'توقف اشتراک صفحه' : 'اشتراک صفحه', shareScreen, !!sTrack);
    item('hand', hand ? 'پایین آوردن دست' : 'بالا بردن دست', toggleHand, hand);
    item('settings', 'دستگاه‌ها (میکروفون، دوربین، بلندگو)', devicesDialog);
    if (isHost() && info.user) {
      item('rec', rec.on ? 'توقف ضبط' : 'ضبط جلسه', toggleRec, rec.on);
      item('eye', room.stage ? 'تعویض طرح در حال نمایش' : 'نمایش طرح برای بررسی', function () { library('design'); });
      item('edit', 'ارسال قرارداد برای امضا', function () { library('contract'); });
    }
    if (me.role === 'host') item('close', 'پایان جلسه برای همه', endAll);
    m.replaceChildren.apply(m, items);
    m.hidden = !m.hidden;
  }
  $('#b-more').onclick = function (e) { e.stopPropagation(); $('#react-sheet').hidden = true; moreMenu(); };
  document.addEventListener('click', function (e) { if (!e.target.closest('#more-menu, #b-more')) $('#more-menu').hidden = true; if (!e.target.closest('#react-sheet, #b-react')) $('#react-sheet').hidden = true; });

  /* ------------------------------------------------------------ Controls */
  function sendState(extra) { return api('/state', auth(Object.assign({ mic: want.mic, cam: want.cam || !!sTrack, hand: hand, share: !!sTrack, caps: capsStr }, extra || {}))).catch(function () {}); }
  function toggleHand() { hand = !hand; $('#b-hand').classList.toggle('on', hand); applyLocal(); sendState(); }
  $('#b-mic').onclick = function () {
    if (micBlocked()) { if (!hand) toggleHand(); toast('میکروفون‌ها را میزبان قفل کرده؛ دست شما بالا رفت تا اجازه صحبت بگیرید.'); return; }
    want.mic = !want.mic; applyLocal(); sendState();
  };
  $('#b-cam').onclick = function () { want.cam = !want.cam; applyLocal(); sendState(); if (want.cam) V.forceKey = true; };
  $('#b-hand').onclick = toggleHand;
  function shareScreen() {
    if (sTrack) return stopShare();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { toast('مرورگر شما اشتراک صفحه را پشتیبانی نمی‌کند'); return; }
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (s) {
      sStream = s; sTrack = s.getVideoTracks()[0];
      sTrack.onended = stopShare;
      Object.keys(peers).forEach(function (k) { if (k !== 'me' && peers[k].pc) attach(peers[k]); });
      peers.me.video.srcObject = s; V.forceKey = true;
      $('#b-screen').classList.add('on'); applyLocal(); sendState();
    }).catch(function () {});
  }
  $('#b-screen').onclick = shareScreen;
  function stopShare() {
    if (!sTrack) return;
    sTrack.onended = null; sTrack.stop(); sTrack = null; sStream = null;
    Object.keys(peers).forEach(function (k) { if (k !== 'me' && peers[k].pc) attach(peers[k]); });
    peers.me.video.srcObject = local; V.forceKey = true;
    $('#b-screen').classList.remove('on'); applyLocal(); sendState();
  }
  $('#b-people').onclick = function () { if (!$('#side').hidden && !$('#pane-people').hidden) { $('#side').hidden = true; chatOpen = false; } else openSide('people'); };
  $('#b-chat').onclick = function () { if (!$('#side').hidden && !$('#pane-chat').hidden) { $('#side').hidden = true; chatOpen = false; } else openSide('chat'); };
  $('#side-close').onclick = function () { $('#side').hidden = true; chatOpen = false; };
  $('#copy-link').onclick = function () {
    var i = $('#invite-link');
    (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(function () { toast('لینک کپی شد'); }, function () { i.select(); document.execCommand('copy'); toast('لینک کپی شد'); });
  };
  $('#b-leave').onclick = function () { leave(); finish('left'); };
  $('#wait-leave').onclick = function () { leave(); finish('left'); };
  function endAll() {
    if (!confirm('جلسه برای همه پایان یابد؟')) return;
    stopRec();
    api('/end', auth()).then(function () { finish('ended'); }).catch(function (e) { toast(e.message); });
  }
  $('#rejoin').onclick = function () { location.reload(); };

  function leave() {
    leaving = true;
    if (!me.id || me.state === 'gone') return;
    stopRec();
    var body = JSON.stringify(auth());
    if (navigator.sendBeacon) navigator.sendBeacon(C.api + '/leave', new Blob([body], { type: 'application/json' }));
    else api('/leave', auth()).catch(function () {});
  }
  window.addEventListener('pagehide', function (e) { if (!e.persisted) leave(); });

  /* ------------------------------------------------------------ Background / lock screen */
  var hiddenAt = 0, baseTitle = document.title, titleT = 0;
  document.addEventListener('visibilitychange', function () {
    if (me.state !== 'in') return;
    if (document.hidden) {
      hiddenAt = Date.now();
      sendState({ away: true });
      var flip = false;
      titleT = setInterval(function () { flip = !flip; document.title = flip ? '⏸ برای ادامه جلسه برگردید' : baseTitle; }, 1500);
      return;
    }
    clearInterval(titleT); document.title = baseTitle;
    sendState({ away: false });
    if (actx && actx.state !== 'running') actx.resume();
    if (outAudio.srcObject && outAudio.paused) outAudio.play().catch(function () { $('#tap-play').hidden = false; });
    var dead = (aTrack && (aTrack.readyState === 'ended' || aTrack.muted)) || (vTrack && want.cam && (vTrack.readyState === 'ended' || vTrack.muted));
    if (dead || (MOBILE && Date.now() - hiddenAt > 15000)) reacquire(true);
    V.forceKey = true;
    poll();
    if (RELAY && R.q && !R.busy) relayTick();
  });

  /* ------------------------------------------------------------ Compositor: picture-in-picture & recording */
  function drawComposite(ctx, W, H) {
    ctx.fillStyle = '#0f0f10'; ctx.fillRect(0, 0, W, H);
    var tiles = $$('#mt-grid .tile'), big = bigTile(), list = big ? [big.tile].concat(tiles.filter(function (t) { return t !== big.tile; })) : tiles;
    if (room.stage) { var di = $('#design-img'); if (di.naturalWidth) { fit(ctx, di, 0, 0, W * 0.75, H); } list = list.slice(0, 4); }
    var area = room.stage ? { x: W * 0.75, y: 0, w: W * 0.25, h: H } : { x: 0, y: 0, w: W, h: H };
    var n = list.length; if (!n) return;
    var cols = room.stage ? 1 : n <= 1 ? 1 : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols), cw = area.w / cols, ch = area.h / rows;
    list.forEach(function (t, i) {
      var x = area.x + (i % cols) * cw, y = area.y + Math.floor(i / cols) * ch;
      var src = t.querySelector('video:not([hidden]), canvas:not([hidden]), img:not([hidden])');
      ctx.fillStyle = '#1b1b1f'; ctx.fillRect(x + 2, y + 2, cw - 4, ch - 4);
      if (src && !t.classList.contains('cam-off')) fit(ctx, src, x + 2, y + 2, cw - 4, ch - 4, true);
      var name = t.querySelector('.tag b').textContent;
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x + 8, y + ch - 30, Math.min(cw - 16, 10 + name.length * 8), 22);
      ctx.fillStyle = t.classList.contains('talk') ? '#f28a24' : '#fff'; ctx.font = '13px Dana, Tahoma, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(name, x + 14, y + ch - 14);
    });
  }
  function fit(ctx, src, x, y, w, h, cover) {
    var sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
    if (!sw || !sh) return;
    var s = cover ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh), dw = sw * s, dh = sh * s;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    try { ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); } catch (e) { /* not ready */ }
    ctx.restore();
  }
  var comp = { canvas: null, timer: 0, users: 0 };
  function compStart(W, H, fps) {
    comp.users++;
    if (!comp.canvas) { comp.canvas = document.createElement('canvas'); }
    if (comp.canvas.width < W) { comp.canvas.width = W; comp.canvas.height = H; }
    if (!comp.timer) { var ctx = comp.canvas.getContext('2d'); comp.timer = setInterval(function () { drawComposite(ctx, comp.canvas.width, comp.canvas.height); }, 1000 / fps); }
    return comp.canvas;
  }
  function compStop() { comp.users = Math.max(0, comp.users - 1); if (!comp.users) { clearInterval(comp.timer); comp.timer = 0; } }
  function pipSupported() { var v = $('#pip-video'); return !!(document.pictureInPictureEnabled || (v && v.webkitSupportsPresentationMode && v.webkitSupportsPresentationMode('picture-in-picture'))) && !!HTMLCanvasElement.prototype.captureStream; }
  var pipOn = false;
  function pip() {
    var v = $('#pip-video');
    if (pipOn) { if (document.exitPictureInPicture) document.exitPictureInPicture().catch(function () {}); return; }
    var c = compStart(640, 360, 12);
    v.srcObject = c.captureStream(12); v.hidden = false;
    v.play().then(function () {
      var p = v.requestPictureInPicture ? v.requestPictureInPicture() : (v.webkitSetPresentationMode('picture-in-picture'), Promise.resolve());
      return p.then(function () { pipOn = true; v.hidden = true; });
    }).catch(function () { v.hidden = true; compStop(); toast('تصویر در تصویر باز نشد'); });
    v.onleavepictureinpicture = function () { pipOn = false; compStop(); };
  }

  /* Recording (hosts who are colleagues): the composed picture with everyone's sound, plus a separate sound file for the minutes. */
  var rec = { on: false, mr: null, amr: null, files: [], q: Promise.resolve() };
  function pickMime(list) { for (var i = 0; i < list.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported(list[i])) return list[i]; return ''; }
  function toggleRec() { if (rec.on) stopRec(); else startRec(); }
  function startRec() {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { toast('مرورگر شما ضبط را پشتیبانی نمی‌کند (Chrome یا Safari جدید)'); return; }
    audioUnlock();
    if (!actx) return;
    recDest = actx.createMediaStreamDestination();
    out.connect(recDest);
    if (A.src) A.src.connect(recDest);
    else if (aTrack) { rec.micSrc = actx.createMediaStreamSource(new MediaStream([aTrack])); rec.micSrc.connect(recDest); }
    var canvas = compStart(1280, 720, 15);
    var vmime = pickMime(['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']), amime = pickMime(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']);
    var stream = new MediaStream([canvas.captureStream(15).getVideoTracks()[0], recDest.stream.getAudioTracks()[0]]);
    Promise.all([
      rest('meetings/' + C.id + '/rec-start', { body: { kind: 'video', mime: vmime } }),
      amime ? rest('meetings/' + C.id + '/rec-start', { body: { kind: 'audio', mime: amime } }) : Promise.resolve(null)
    ]).then(function (res) {
      rec.files = [res[0].file].concat(res[1] ? [res[1].file] : []);
      rec.mr = new MediaRecorder(stream, vmime ? { mimeType: vmime, videoBitsPerSecond: 900000 } : {});
      rec.mr.ondataavailable = function (e) { upload(res[0].file, e.data); };
      rec.mr.start(4000);
      if (res[1]) {
        rec.amr = new MediaRecorder(recDest.stream, { mimeType: amime, audioBitsPerSecond: 24000 });
        rec.amr.ondataavailable = function (e) { upload(res[1].file, e.data); };
        rec.amr.start(5000);
      }
      rec.on = true;
      toast('ضبط شروع شد؛ فایل در جزئیات جلسه در پنل ذخیره می‌شود');
      poll();
    }).catch(function (e) { compStop(); toast(e.message); });
  }
  function upload(file, blob) {
    if (!blob || !blob.size) return;
    rec.q = rec.q.then(function () { return rest('meetings/' + C.id + '/rec-chunk?file=' + file, { raw: blob }).catch(function () { return rest('meetings/' + C.id + '/rec-chunk?file=' + file, { raw: blob }).catch(function () {}); }); });
  }
  function stopRec() {
    if (!rec.on) return;
    rec.on = false;
    var stops = [rec.mr, rec.amr].filter(Boolean).map(function (r) { return new Promise(function (ok) { r.addEventListener('stop', function () { setTimeout(ok, 50); }); try { r.stop(); } catch (e) { ok(); } }); });
    compStop();
    Promise.all(stops).then(function () { return rec.q; }).then(function () { return rest('meetings/' + C.id + '/rec-stop', { body: { files: rec.files } }); })
      .then(function () { toast('ضبط ذخیره شد'); poll(); }).catch(function () {});
    if (recDest) { try { out.disconnect(recDest); if (A.src) A.src.disconnect(recDest); if (rec.micSrc) rec.micSrc.disconnect(); } catch (e) { /* */ } recDest = null; }
  }

  /* ------------------------------------------------------------ End */
  function finish(why) {
    clearTimeout(pollTimer); clearTimeout(R.timer);
    stopRec(); micStop(); videoStop(); R.q = '';
    me.state = 'gone';
    Object.keys(peers).forEach(function (k) { if (k !== 'me') drop(k); });
    if (peers.me && peers.me.tile) peers.me.tile.remove();
    delete peers.me;
    if (sTrack) { sTrack.stop(); sTrack = null; }
    stopLocal();
    clearInterval(titleT); document.title = baseTitle;
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
      txt = fa(pad(Math.floor(remaining / 60)) + ':' + pad(remaining % 60)) + ' مانده';
      $('#mt-clock').classList.toggle('warn', remaining <= 300);
      if (remaining <= 300 && !warned) { warned = true; toast('کمتر از ۵ دقیقه به پایان جلسه مانده است'); }
      remaining = Math.max(0, remaining - 1);
    } else txt = fa(pad(Math.floor(s / 60)) + ':' + pad(s % 60));
    $('#mt-clock').textContent = txt;
    setTimeout(tick, 1000);
  }
}());
