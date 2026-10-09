/*
 * Voice and video calls inside «مربع چت», built for a plain (Iranian) shared host — no STUN/TURN server needed:
 * - a direct WebRTC connection between the two devices is tried first (signals go through the relay); it takes
 *   over only once its sound really plays, so a half-working direct path never leaves the call silent;
 * - otherwise sound and picture go through this site's media relay (MP_Relay / relay.php, no WordPress per
 *   request; when the host's firewall refuses relay.php, the WordPress route): Opus 48 kHz in 20 ms packets
 *   (μ-law 16 kHz without an Opus encoder), VP8/H.264 360p (JPEG without WebCodecs), a sender every 60 ms that
 *   slows down when the host pushes back, and a held receiver that the relay answers as soon as the other side
 *   writes; an adaptive jitter buffer in an AudioWorklet; Chrome's echo canceller hears the playback;
 * - Telegram's call screen: avatar that pulses with the voice, full-screen picture with your own in a corner,
 *   timer, quality, «مستقیم»/«از طریق سرور», mute, camera on/off, switch camera, speaker, minimise, end;
 * - tap the quality pill for what the call is doing (and a call that stays «در حال اتصال…» reports itself to the
 *   supervisors' «خطاهای برنامه»).
 * Ringing, accept and decline live in chat-calls.js, which calls MP.voice.start / MP.voice.join.
 */
(function () {
  'use strict';
  var MP = window.MP, el = MP.el, icon = MP.icon, fa = MP.fa, C = window.MP_CONFIG || {};
  if (C.pop) return;
  var UA = navigator.userAgent, CHROMIUM = /Chrome\//.test(UA) || !!(window.chrome && window.chrome.webview);
  var APP = window.MorabaApp || null;
  function appCall(fn) { if (!APP || typeof APP[fn] !== 'function') return undefined; try { return APP[fn].apply(APP, [].slice.call(arguments, 1)); } catch (e) { return undefined; } }
  function store(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  var RATE = 48000, FRAME = 960; // 20 ms
  var WORKLET = [
    "class Cap extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(" + FRAME + ");this.n=0;}",
    "process(i){var x=i[0]&&i[0][0];if(!x)return true;for(var k=0;k<x.length;k++){this.b[this.n++]=x[k];if(this.n===" + FRAME + "){this.port.postMessage(this.b.slice(0));this.n=0;}}return true;}}",
    "class Play extends AudioWorkletProcessor{constructor(){super();this.q=[];this.cur=null;this.pos=0;this.size=0;this.target=2880;this.on=false;this.under=0;this.last=0;this.calm=0;this.lvl=0;this.tick=0;",
    "this.port.onmessage=e=>{if(e.data==='reset'){this.q=[];this.cur=null;this.size=0;this.on=false;return;}this.q.push(e.data);this.size+=e.data.length;};}",
    "process(i,o){var out=o[0][0],n=out.length,k=0;",
    "if(!this.on){if(this.size>=this.target)this.on=true;else{for(;k<n;k++){this.last*=0.95;out[k]=this.last;}return this.report(out,n);}}",
    "if(this.size>this.target+9600){while(this.size>this.target+960&&this.q.length>1){var d=this.q.shift();this.size-=d.length;}}",
    "while(k<n){if(!this.cur){this.cur=this.q.shift();this.pos=0;if(!this.cur){for(;k<n;k++){this.last*=0.95;out[k]=this.last;}this.under++;this.on=false;this.target=Math.min(14400,this.target+960);this.calm=0;break;}}",
    "var c=this.cur,m=Math.min(n-k,c.length-this.pos);for(var j=0;j<m;j++)out[k+j]=c[this.pos+j];k+=m;this.pos+=m;this.size-=m;if(this.pos>=c.length)this.cur=null;}",
    "this.last=out[n-1]||0;if(++this.calm>3000&&this.target>2880){this.target-=480;this.calm=0;}return this.report(out,n);}",
    "report(out,n){var s=0;for(var z=0;z<n;z+=4)s+=out[z]*out[z];this.lvl=Math.max(Math.sqrt(s/(n/4)),this.lvl*0.92);",
    "if(++this.tick%30===0)this.port.postMessage({lvl:this.lvl,buf:Math.round(this.size/48),target:Math.round(this.target/48),under:this.under});return true;}}",
    "registerProcessor('mp-cap',Cap);registerProcessor('mp-play',Play);"
  ].join('');

  /* ------------------------------------------------------------ What this browser can do */
  var VCODEC = { avc: 'avc1.42E01F', vp8: 'vp8' }, VCID = { avc: 1, vp8: 2 }, VCNAME = { 1: 'avc', 2: 'vp8' };
  var CAPS = { ae: !!window.AudioEncoder, ad: !!window.AudioDecoder, ve: [], vd: [] };
  (function () {
    try {
      if (!(window.VideoEncoder && window.VideoDecoder && window.VideoFrame && window.EncodedVideoChunk)) return;
      Object.keys(VCODEC).forEach(function (k) {
        var cfg = { codec: VCODEC[k], width: 480, height: 360, bitrate: 350000, framerate: 15, latencyMode: 'realtime' };
        if (k === 'avc') cfg.avc = { format: 'annexb' };
        VideoEncoder.isConfigSupported(cfg).then(function (r) { if (r.supported) CAPS.ve.push(k); }, function () {});
        VideoDecoder.isConfigSupported({ codec: VCODEC[k] }).then(function (r) { if (r.supported) CAPS.vd.push(k); }, function () {});
      });
    } catch (e) { /* JPEG then */ }
  })();

  /* ------------------------------------------------------------ μ-law, resampling */
  var DEC = new Float32Array(256);
  (function () { for (var i = 0; i < 256; i++) { var u = ~i & 0xFF, sign = u & 0x80, e = (u >> 4) & 7, mt = u & 0x0F, x = ((mt << 3) + 0x84) << e; x -= 0x84; DEC[i] = (sign ? -x : x) / 32768; } })();
  function ulaw(v) {
    var x = Math.max(-1, Math.min(1, v)) * 32767 | 0, sign = (x >> 8) & 0x80;
    if (sign) x = -x; if (x > 32635) x = 32635; x += 0x84;
    var e = 7; for (var m = 0x4000; (x & m) === 0 && e > 0; e--, m >>= 1) { /* exponent */ }
    return ~(sign | (e << 4) | ((x >> (e + 3)) & 0x0F)) & 0xFF;
  }
  function resample(f, from, to) {
    if (from === to) return f;
    var n = Math.round(f.length * to / from), o = new Float32Array(n), r = from / to;
    for (var i = 0; i < n; i++) { var p = i * r, i0 = p | 0, t = p - i0; o[i] = f[i0] + ((f[Math.min(f.length - 1, i0 + 1)] || 0) - f[i0]) * t; }
    return o;
  }

  /* ------------------------------------------------------------ The call */
  var V = null; // one call at a time

  function newCall(o) {
    V = {
      id: o.id || 0, uid: o.uid, name: MP.user(o.uid).name, video: !!o.video, outgoing: !!o.outgoing,
      state: o.outgoing ? 'ringing' : 'connecting', since: Date.now(), started: 0, muted: false, camOff: false, peerMuted: false, peerCamOff: false,
      p2p: false, relay: null, c: {}, out: [], pkts: [], ts: 0, sendBusy: false, recvOn: false, gap: 60, rtt: 0, fails: 0, rest: false,
      peerCaps: null, heard: 0, frames: 0, sent: 0, recv: 0, vsent: 0, vrecv: 0, codes: {}, stream: null, actx: null, ended: false, ui: null,
      stats: { buf: 0, target: 0, under: 0, lvl: 0 }, micLvl: 0, iceQ: [], facing: 'user'
    };
    return V;
  }
  /** Inside the tap that started or answered the call: browsers only let sound start from one. */
  function makeCtx(v) {
    var AC = window.AudioContext || window.webkitAudioContext;
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) { /* older iOS */ }
    try { v.actx = new AC({ sampleRate: RATE, latencyHint: 'interactive' }); } catch (e) { v.actx = new AC(); }
    if (v.actx.state !== 'running') v.actx.resume();
  }
  function media(video, facing) {
    var a = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    return navigator.mediaDevices.getUserMedia({ audio: a, video: video ? { facingMode: facing || 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } } : false })
      .catch(function (e) { if (video && e && e.name !== 'NotAllowedError') return navigator.mediaDevices.getUserMedia({ audio: a }); throw e; });
  }
  function why(e) { return e && e.name === 'NotAllowedError' ? 'اجازه میکروفون یا دوربین داده نشد' : e && e.name === 'NotFoundError' ? 'میکروفونی پیدا نشد' : (e && e.message) || 'تماس برقرار نشد'; }

  /** MP.voice.start(uid, video): call a colleague. */
  function start(uid, video) {
    if (V) { MP.toast('یک تماس در جریان است'); show(); return; }
    var v = newCall({ uid: uid, outgoing: true, video: video });
    makeCtx(v);
    draw();
    media(video).then(function (s) {
      v.stream = s; selfView();
      return MP.api('calls', { method: 'POST', body: { user_id: uid, video: video ? 1 : 0 } });
    }).then(function (d) {
      if (v.ended) { MP.api('calls/' + d.id, { method: 'POST', body: { action: 'cancel' } }).catch(function () {}); return; }
      if (!d.voice) throw new Error('سایت هنوز به‌روز نشده است');
      v.id = d.id; v.relay = d.voice;
      v.c[v.relay.other] = [0, 0]; // the callee's log starts later: read it from its first record (the hello)
      audioStart();
      recvLoop();
      ringback(true);
      v.ringT = setTimeout(function () { if (v.state === 'ringing') end('پاسخ داده نشد', true); }, (d.ring || 45) * 1000 + 3000);
    }).catch(function (e) { end(why(e), true); });
  }

  /** MP.voice.join(ring): the ring was accepted (chat-calls.js). */
  function join(r) {
    if (V && !V.ended) end('', true);
    var v = newCall({ id: +r.id, uid: +r.from, outgoing: false, video: !!+r.video });
    makeCtx(v);
    draw();
    media(v.video).then(function (s) {
      v.stream = s; selfView();
      return MP.api('calls/' + v.id, { method: 'POST', body: { action: 'accept', app: 1 } });
    }).then(function (d) {
      if (!d.voice) throw new Error('این تماس دیگر در دسترس نیست');
      v.relay = d.voice;
      v.c[v.relay.other] = [0, 0];
      audioStart();
      signal({ k: 'hi', caps: CAPS });
      recvLoop();
    }).catch(function (e) {
      if (e && e.name === 'NotAllowedError') MP.api('calls/' + v.id, { method: 'POST', body: { action: 'decline' } }).catch(function () {});
      end(why(e), true);
    });
  }

  /* ------------------------------------------------------------ Sound in and out */

  function audioStart() {
    var v = V;
    appCall('callAudio', true); // Android app: call audio mode, keeps running behind other apps
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { v.wake = l; }, function () {}); } catch (e) { /* none */ }
    var src = v.actx.createMediaStreamSource(new MediaStream(v.stream.getAudioTracks()));
    var silent = v.actx.createGain(); silent.gain.value = 0; silent.connect(v.actx.destination);
    v.playOut = v.actx.createGain();
    if (CHROMIUM && window.RTCPeerConnection) loopback(v); else v.playOut.connect(v.actx.destination);
    function viaScript() {
      // no AudioWorklet (very old browsers): ScriptProcessor in, scheduled buffers out
      var acc = new Float32Array(FRAME), n = 0, sp = v.actx.createScriptProcessor(1024, 1, 1);
      sp.onaudioprocess = function (e) { var x = e.inputBuffer.getChannelData(0); for (var k = 0; k < x.length; k++) { acc[n++] = x[k]; if (n === FRAME) { captured(acc.slice(0)); n = 0; } } };
      src.connect(sp); sp.connect(silent);
      v.legacyPlay = true;
    }
    if (!v.actx.audioWorklet) { viaScript(); return; }
    var url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    v.actx.audioWorklet.addModule(url).then(function () {
      if (v.ended) return;
      v.play = new AudioWorkletNode(v.actx, 'mp-play', { numberOfInputs: 0, outputChannelCount: [1] });
      v.play.port.onmessage = function (e) { v.stats = e.data; level(e.data.lvl); };
      v.play.connect(v.playOut);
      v.cap = new AudioWorkletNode(v.actx, 'mp-cap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      v.cap.port.onmessage = function (e) { captured(e.data); };
      src.connect(v.cap); v.cap.connect(silent); // a path to the speakers keeps the node running everywhere
    }).catch(viaScript);
  }

  /** Chrome cancels echo only for sound it plays through WebRTC: our playback goes through a connection to ourselves. */
  function loopback(v) {
    var dest = v.actx.createMediaStreamDestination(), pc1 = new RTCPeerConnection(), pc2 = new RTCPeerConnection(), done = false;
    var a = new Audio(); a.autoplay = true; v.loopEl = a; v.loopPcs = [pc1, pc2];
    v.playOut.connect(dest);
    function fail() { if (done) return; done = true; try { v.playOut.disconnect(dest); } catch (e) { /* */ } v.playOut.connect(v.actx.destination); try { pc1.close(); pc2.close(); } catch (e) { /* */ } v.loopEl = null; }
    pc1.onicecandidate = function (e) { if (e.candidate) pc2.addIceCandidate(e.candidate).catch(function () {}); };
    pc2.onicecandidate = function (e) { if (e.candidate) pc1.addIceCandidate(e.candidate).catch(function () {}); };
    pc2.ontrack = function (e) { a.srcObject = new MediaStream([e.track]); a.play().then(function () { done = true; sink(); }).catch(fail); };
    pc1.addTrack(dest.stream.getAudioTracks()[0], dest.stream);
    pc1.createOffer().then(function (o) { return pc1.setLocalDescription(o); })
      .then(function () { return pc2.setRemoteDescription(pc1.localDescription); })
      .then(function () { return pc2.createAnswer(); })
      .then(function (x) { return pc2.setLocalDescription(x); })
      .then(function () { return pc1.setRemoteDescription(pc2.localDescription); })
      .catch(fail);
    setTimeout(function () { if (!done) fail(); }, 4000);
  }

  /** 20 ms of microphone → Opus (or μ-law) → the next send. */
  function captured(f) {
    var v = V;
    if (!v || v.ended) return;
    v.frames++;
    var s = 0; for (var z = 0; z < f.length; z += 8) s += f[z] * f[z]; v.micLvl = Math.sqrt(s / (f.length / 8));
    if (v.muted || v.p2p || v.state === 'ringing' || !v.peerCaps) return;
    var useOpus = v.peerCaps.ad && v.actx.sampleRate === RATE && opusEnc(v);
    if (useOpus) {
      try {
        var ad = new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: f.length, numberOfChannels: 1, timestamp: v.ts, data: f });
        v.ts += 20000; v.enc.encode(ad); ad.close();
      } catch (e) { v.enc = null; v.encBad = true; }
      return;
    }
    var s16 = resample(f, v.actx.sampleRate, 16000), b = new Uint8Array(s16.length);
    for (var i = 0; i < s16.length; i++) b[i] = ulaw(s16[i]);
    v.out.push([1, b]);
  }
  function opusEnc(v) {
    if (v.enc) return true;
    if (v.encBad || !window.AudioEncoder) return false;
    try {
      v.enc = new AudioEncoder({ output: function (chunk) { var b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); v.pkts.push(b); }, error: function () { v.enc = null; v.encBad = true; } });
      var cfg = { codec: 'opus', sampleRate: RATE, numberOfChannels: 1, bitrate: 40000 };
      try { v.enc.configure(Object.assign({ opus: { frameDuration: 20000, complexity: 10, signal: 'voice', application: 'voip', usedtx: false } }, cfg)); }
      catch (e) { v.enc.configure(cfg); }
      return true;
    } catch (e) { v.enc = null; v.encBad = true; return false; }
  }
  function flushOpus(v) {
    if (!v.pkts.length) return;
    var total = v.pkts.reduce(function (s, p) { return s + 2 + p.length; }, 0), buf = new Uint8Array(total), dv = new DataView(buf.buffer), at = 0;
    v.pkts.forEach(function (p) { dv.setUint16(at, p.length); buf.set(p, at + 2); at += 2 + p.length; });
    v.pkts = [];
    v.out.push([2, buf]);
  }

  /** Sound from the other side → the jitter buffer (or scheduled buffers without a worklet). */
  function playFloat(v, f, rate) {
    if (v.p2p) return;
    if (v.play) { v.play.port.postMessage(resample(f, rate, v.actx.sampleRate)); return; }
    if (!v.legacyPlay) return;
    var buf = v.actx.createBuffer(1, f.length, rate); buf.getChannelData(0).set(f);
    var now = v.actx.currentTime, t = v.next && v.next > now ? v.next : now + 0.12;
    if (t - now > 0.6) return;
    var s = v.actx.createBufferSource(); s.buffer = buf; s.connect(v.playOut); s.start(t); v.next = t + buf.duration;
  }
  function heard(v, kind, bytes) {
    if (v.p2p) return;
    v.heard = Date.now(); v.recv++;
    if (v.state !== 'active') active();
    if (kind === 1) { var f = new Float32Array(bytes.length); for (var i = 0; i < bytes.length; i++) f[i] = DEC[bytes[i]]; playFloat(v, f, 16000); return; }
    if (!window.AudioDecoder) return;
    if (!v.dec) {
      try {
        v.dec = new AudioDecoder({
          output: function (ad) { var f = new Float32Array(ad.numberOfFrames); try { ad.copyTo(f, { planeIndex: 0, format: 'f32-planar' }); } catch (e) { ad.copyTo(f, { planeIndex: 0 }); } var r = ad.sampleRate; ad.close(); playFloat(v, f, r); },
          error: function () { v.dec = null; }
        });
        v.dec.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1 });
        v.dts = 0;
      } catch (e) { v.dec = null; return; }
    }
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), at = 0;
    while (at + 2 <= bytes.length) {
      var len = dv.getUint16(at); at += 2;
      if (at + len > bytes.length) break;
      try { v.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: v.dts, data: bytes.subarray(at, at + len) })); } catch (e) { v.dec = null; return; }
      v.dts += 20000; at += len;
    }
  }

  /* ------------------------------------------------------------ Picture through the relay */

  function camTrack(v) { return v.stream ? v.stream.getVideoTracks()[0] : null; }
  function videoLoop() {
    var v = V;
    if (!v || v.ended) return;
    clearTimeout(v.vT);
    var fps = v.vmode === 'jpeg' ? 6 : 15;
    v.vT = setTimeout(videoLoop, Math.round(1000 / fps));
    var t = camTrack(v), sv = v.selfEl;
    if (!t || v.camOff || v.p2p || !v.peerCaps || v.state === 'ringing' || !sv || !sv.videoWidth) return;
    if (v.out.filter(function (x) { return x[0] >= 3 && x[0] <= 5; }).length > 6) { v.forceKey = true; return; } // the host is behind: skip pictures
    var w = Math.min(480, sv.videoWidth), h = Math.round(w * sv.videoHeight / sv.videoWidth / 2) * 2; w = Math.round(w / 2) * 2;
    var cv = v.vcanvas || (v.vcanvas = document.createElement('canvas'));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    cv.getContext('2d').drawImage(sv, 0, 0, w, h);
    var theirs = (v.peerCaps.vd || []), codec = CAPS.ve.filter(function (k) { return theirs.indexOf(k) >= 0; })[0];
    if (codec) {
      var key = codec + w + 'x' + h;
      if (!v.venc || v.vcfg !== key) {
        try {
          if (!v.venc) v.venc = new VideoEncoder({ output: onChunk, error: function () { v.venc = null; v.vcfg = ''; v.vbad = true; } });
          var cfg = { codec: VCODEC[codec], width: w, height: h, bitrate: 350000, framerate: 15, latencyMode: 'realtime' };
          if (codec === 'avc') cfg.avc = { format: 'annexb' };
          v.venc.configure(cfg); v.vcfg = key; v.vcodec = codec; v.vw = w; v.vh = h; v.forceKey = true; v.vn = 0;
        } catch (e) { v.venc = null; v.vbad = true; }
      }
      if (v.venc && !v.vbad) {
        v.vmode = 'vc';
        if (v.venc.encodeQueueSize > 2) return;
        try {
          var fr = new VideoFrame(cv, { timestamp: Math.round(performance.now() * 1000) });
          v.venc.encode(fr, { keyFrame: v.forceKey || v.vn % 30 === 0 }); fr.close();
          v.forceKey = false; v.vn++;
        } catch (e) { v.venc = null; v.vbad = true; }
        return;
      }
    }
    v.vmode = 'jpeg';
    if (v.jbusy) return;
    v.jbusy = true;
    cv.toBlob(function (b) {
      if (!b) { v.jbusy = false; return; }
      (b.arrayBuffer ? b.arrayBuffer() : new Response(b).arrayBuffer()).then(function (ab) { v.out.push([3, new Uint8Array(ab)]); v.vsent++; v.jbusy = false; }, function () { v.jbusy = false; });
    }, 'image/jpeg', 0.55);
    function onChunk(chunk) {
      var data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      var rec = new Uint8Array(5 + data.length), dv = new DataView(rec.buffer);
      rec[0] = VCID[v.vcodec]; dv.setUint16(1, v.vw); dv.setUint16(3, v.vh); rec.set(data, 5);
      v.out.push([chunk.type === 'key' ? 4 : 5, rec]); v.vsent++;
    }
  }
  function seen(v, type, bytes) {
    if (v.p2p) return;
    v.vrecv++; v.vAt = Date.now();
    var cv = remoteCanvas(v);
    if (type === 3) {
      if (v.jload) return;
      v.jload = true;
      var img = new Image(), u = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      img.onload = function () { if (cv.width !== img.width) { cv.width = img.width; cv.height = img.height; } cv.getContext('2d').drawImage(img, 0, 0); URL.revokeObjectURL(u); v.jload = false; pic(v, true); };
      img.onerror = function () { URL.revokeObjectURL(u); v.jload = false; };
      img.src = u; return;
    }
    if (!window.VideoDecoder || bytes.length < 6) return;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), codec = VCNAME[bytes[0]], w = dv.getUint16(1), h = dv.getUint16(3), isKey = type === 4;
    if (!codec) return;
    var sig = codec + w + 'x' + h;
    if (!v.vdec || v.vsig !== sig) {
      if (!isKey) { askKey(v); return; }
      try {
        if (v.vdec) try { v.vdec.close(); } catch (e) { /* */ }
        v.vdec = new VideoDecoder({
          output: function (f) { if (cv.width !== f.displayWidth) { cv.width = f.displayWidth; cv.height = f.displayHeight; } cv.getContext('2d').drawImage(f, 0, 0); f.close(); pic(v, true); },
          error: function () { v.vdec = null; v.vsig = ''; askKey(v); }
        });
        v.vdec.configure({ codec: VCODEC[codec], codedWidth: w, codedHeight: h, optimizeForLatency: true });
        v.vsig = sig; v.vts = 0; v.needKey = false;
      } catch (e) { v.vdec = null; v.vsig = ''; return; }
    }
    if (v.needKey && !isKey) return;
    if (isKey) v.needKey = false;
    if (v.vdec.decodeQueueSize > 8) { v.needKey = true; askKey(v); return; }
    try { v.vdec.decode(new EncodedVideoChunk({ type: isKey ? 'key' : 'delta', timestamp: (v.vts += 66666), data: bytes.subarray(5) })); }
    catch (e) { v.needKey = true; askKey(v); }
  }
  function askKey(v) { if (!v.kfAt || Date.now() - v.kfAt > 2000) { v.kfAt = Date.now(); signal({ k: 'kf' }); } }

  /* ------------------------------------------------------------ The relay: a sender, a held receiver */

  function relayUrl(v, extra) {
    var r = v.relay;
    return (v.rest ? r.rest + (r.rest.indexOf('?') >= 0 ? '&' : '?') : r.relay + '?') + r.q + extra;
  }
  function post(v, recs, extra, cursor) {
    var head = { r: recs.map(function (x) { return [x[0], x[1].length]; }), c: cursor ? v.c : {}, w: {} };
    var hj = new TextEncoder().encode(JSON.stringify(head)), len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, hj.length);
    var ctl = window.AbortController ? new AbortController() : null, to = ctl ? setTimeout(function () { ctl.abort(); }, 12000) : 0;
    return fetch(relayUrl(v, extra), {
      method: 'POST', body: new Blob([len, hj].concat(recs.map(function (x) { return x[1]; })), { type: 'application/octet-stream' }),
      headers: v.rest && C.nonce ? { 'X-WP-Nonce': C.nonce } : {}, credentials: v.rest ? 'same-origin' : 'omit', cache: 'no-store', signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      clearTimeout(to);
      v.codes[r.status] = (v.codes[r.status] || 0) + 1;
      if (!r.ok) { var e = new Error('relay'); e.status = r.status; throw e; }
      return r.arrayBuffer();
    }, function (e) { clearTimeout(to); v.codes.net = (v.codes.net || 0) + 1; throw e; });
  }
  /** @return true when the call is over. */
  function relayFail(v, e) {
    v.fails++;
    var st = e && e.status;
    if (st === 410) { setTimeout(function () { if (V === v && !v.ended) end(v.state === 'ringing' ? 'پاسخ داده نشد' : 'تماس پایان یافت', true); }, 1500); return true; }
    // relay.php refused by the host (firewall, no PHP in plugins, missing key): the WordPress route instead
    if (!v.rest && (st === 403 || st === 404 || st === 405 || st === 406 || st === 500 || st === 503 || !st) && v.fails > 1) { v.rest = true; v.fails = 0; return false; }
    if (v.rest && st === 403 && v.fails > 3) { end('دسترسی به تماس رد شد', true); return true; }
    if (st === 429 || st === 503 || st === 508 || st === 502) v.gap = Math.min(200, v.gap + 40); // the host asks to slow down
    return false;
  }
  function sendTick() {
    var v = V;
    if (!v || v.ended || !v.relay) return;
    clearTimeout(v.sendT);
    flushOpus(v);
    if (v.sendBusy || !v.out.length) { v.sendT = setTimeout(sendTick, Math.min(40, v.gap)); return; }
    var recs = v.out.splice(0), t0 = Date.now();
    v.sendBusy = true;
    post(v, recs, '&nr=1', false).then(function () {
      v.fails = 0; v.sent += recs.length;
      var rtt = Date.now() - t0; v.rtt = v.rtt ? Math.round(v.rtt * 0.85 + rtt * 0.15) : rtt;
      if (v.gap > 60) v.gap -= 5;
    }).catch(function (e) {
      if (relayFail(v, e)) return;
      // keep the signals and the last ~300 ms of sound across a hiccup; pictures start again from a keyframe
      var keep = recs.filter(function (x) { return x[0] === 6; }).concat(recs.filter(function (x) { return x[0] <= 2; }).slice(-6));
      if (recs.some(function (x) { return x[0] >= 3 && x[0] <= 5; })) v.forceKey = true;
      v.out = keep.concat(v.out);
    }).then(function () { v.sendBusy = false; v.sendT = setTimeout(sendTick, Math.max(10, v.gap - (Date.now() - t0)) + (v.fails > 3 ? 1000 : 0)); });
  }
  function signal(o) { var v = V; if (!v || v.ended) return; v.out.push([6, new TextEncoder().encode(JSON.stringify(o))]); sendTick(); }
  function recvLoop() {
    var v = V;
    if (!v || v.ended || !v.relay || v.recvOn) return;
    v.recvOn = true;
    (function go() {
      if (V !== v || v.ended) { v.recvOn = false; return; }
      post(v, [], '&wait=1000', true).then(function (ab) {
        v.fails = 0; v.okAt = Date.now();
        var dv = new DataView(ab), jl = dv.getUint32(0), res = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, jl))), at = 4 + jl;
        Object.keys(res.c || {}).forEach(function (k) { v.c[k] = res.c[k]; });
        (res.items || []).forEach(function (it) {
          var bytes = new Uint8Array(ab, at, it[2]); at += it[2];
          if (+it[0] !== v.relay.other) return;
          if (it[1] === 6) { try { onSignal(JSON.parse(new TextDecoder().decode(bytes))); } catch (e) { /* bad signal */ } }
          else if (it[1] <= 2) heard(v, it[1], bytes.slice());
          else seen(v, it[1], bytes.slice());
        });
        go();
      }).catch(function (e) {
        if (relayFail(v, e)) { v.recvOn = false; return; }
        setTimeout(go, Math.min(3000, 250 * v.fails));
      });
    })();
    sendTick();
    if (v.video) videoLoop();
  }

  /* ------------------------------------------------------------ Signals: hello, direct connection, mute, camera, bye */

  function onSignal(s) {
    var v = V;
    if (!v) return;
    if (s.k === 'hi') {
      v.peerCaps = s.caps || {};
      if (v.outgoing) {
        ringback(false); clearTimeout(v.ringT);
        signal({ k: 'hi', caps: CAPS });
        if (v.state === 'ringing') { v.state = 'connecting'; v.since = Date.now(); draw(); }
        direct(true);
      }
      return;
    }
    if (s.k === 'offer') { direct(false, s.sdp); return; }
    if (s.k === 'answer' && v.pc) { v.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp }).then(flushIce).catch(function () {}); return; }
    if (s.k === 'ice' && s.c) { if (v.pc && v.pc.remoteDescription) v.pc.addIceCandidate(s.c).catch(function () {}); else v.iceQ.push(s.c); return; }
    if (s.k === 'mute') { v.peerMuted = !!s.on; draw(); return; }
    if (s.k === 'cam') { v.peerCamOff = !!s.off; pic(v, !s.off && v.hasPic); draw(); return; }
    if (s.k === 'kf') { v.forceKey = true; return; }
    if (s.k === 'bye') end('تماس پایان یافت', false);
  }
  function flushIce() { var v = V; if (!v || !v.pc) return; v.iceQ.splice(0).forEach(function (c) { v.pc.addIceCandidate(c).catch(function () {}); }); }
  function tuneSdp(sdp) { return sdp.replace(/(a=fmtp:\d+ .*useinbandfec=1)/g, '$1;maxaveragebitrate=48000;stereo=0;cbr=0'); }
  /** Device to device when they can reach each other; it takes over once its sound actually plays. */
  function direct(offerer, sdp) {
    var v = V;
    if (!v || !window.RTCPeerConnection || store('mp_call_p2p') === '0' || (v.pc && offerer)) return;
    if (!v.pc) {
      var pc = v.pc = new RTCPeerConnection({ iceServers: (v.relay && v.relay.ice) || [] });
      v.stream.getTracks().forEach(function (t) { v.senders = (v.senders || []).concat([pc.addTrack(t, v.stream)]); });
      pc.onicecandidate = function (e) { if (e.candidate) signal({ k: 'ice', c: e.candidate.toJSON() }); };
      pc.ontrack = function (e) {
        var st = e.streams[0] || new MediaStream([e.track]);
        if (e.track.kind === 'video') { var rv = remoteVideo(v); rv.srcObject = st; rv.play().catch(function () {}); return; }
        var a = v.p2pEl || (v.p2pEl = new Audio()); a.autoplay = true; a.srcObject = st;
        a.play().then(function () { v.p2pPlays = true; sink(); }, function () { v.p2pPlays = false; });
      };
      pc.oniceconnectionstatechange = function () {
        var s = pc.iceConnectionState;
        v.ice = s;
        if ((s === 'failed' || s === 'disconnected' || s === 'closed') && v.p2p) { v.p2p = false; v.forceKey = true; draw(); }
      };
      // the direct path counts only when sound really arrives on it and plays
      v.p2pT = setInterval(function () {
        if (v.ended) { clearInterval(v.p2pT); return; }
        if (!pc.getStats || (v.ice !== 'connected' && v.ice !== 'completed')) return;
        pc.getStats().then(function (r) {
          var bytes = 0; r.forEach(function (x) { if (x.type === 'inbound-rtp' && (x.kind || x.mediaType) === 'audio') bytes = x.bytesReceived || 0; });
          var flowing = bytes > (v.p2pBytes || 0); v.p2pBytes = bytes;
          if (flowing && v.p2pPlays && !v.p2p) { v.p2p = true; if (v.play) v.play.port.postMessage('reset'); active(); draw(); }
          else if (!flowing && v.p2p) { v.p2p = false; v.forceKey = true; draw(); }
        }).catch(function () {});
      }, 1000);
      (v.senders || []).forEach(function (s) {
        if (!s.track || s.track.kind !== 'video' || !s.getParameters) return;
        try { var p = s.getParameters(); p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}]; p.encodings[0].maxBitrate = 1200000; s.setParameters(p).catch(function () {}); } catch (e) { /* older browser */ }
      });
    }
    var p = v.pc;
    if (offerer) {
      p.createOffer().then(function (o) { o = { type: 'offer', sdp: tuneSdp(o.sdp) }; return p.setLocalDescription(o).then(function () { signal({ k: 'offer', sdp: o.sdp }); }); }).catch(function () {});
    } else {
      p.setRemoteDescription({ type: 'offer', sdp: sdp }).then(flushIce).then(function () { return p.createAnswer(); })
        .then(function (a) { a = { type: 'answer', sdp: tuneSdp(a.sdp) }; return p.setLocalDescription(a).then(function () { signal({ k: 'answer', sdp: a.sdp }); }); }).catch(function () {});
    }
  }

  /* ------------------------------------------------------------ State, controls, end */

  function active() {
    var v = V;
    if (!v || v.state === 'active') return;
    v.state = 'active'; v.started = Date.now();
    ringback(false); clearTimeout(v.ringT);
    MP.haptic(20);
    draw();
  }
  function mute(on) {
    var v = V; if (!v) return;
    v.muted = on === undefined ? !v.muted : !!on;
    v.stream && v.stream.getAudioTracks().forEach(function (t) { t.enabled = !v.muted; });
    signal({ k: 'mute', on: v.muted });
    draw();
  }
  function camera(on) {
    var v = V, t = v && camTrack(v); if (!t) { MP.toast('دوربینی پیدا نشد'); return; }
    v.camOff = on === undefined ? !v.camOff : !on;
    t.enabled = !v.camOff;
    signal({ k: 'cam', off: v.camOff });
    if (!v.camOff) v.forceKey = true;
    draw();
  }
  /** Front ↔ back camera (phones). */
  function flip() {
    var v = V, old = v && camTrack(v); if (!old) return;
    v.facing = v.facing === 'user' ? 'environment' : 'user';
    navigator.mediaDevices.getUserMedia({ video: { facingMode: v.facing, width: { ideal: 640 }, height: { ideal: 480 } } }).then(function (s) {
      var t = s.getVideoTracks()[0];
      v.stream.removeTrack(old); old.stop(); v.stream.addTrack(t);
      (v.senders || []).forEach(function (sd) { if (sd.track && sd.track.kind === 'video' || (!sd.track && sd.replaceTrack)) sd.replaceTrack(t).catch(function () {}); });
      selfView(); v.forceKey = true;
    }).catch(function () { MP.toast('دوربین دیگری در دسترس نیست'); });
  }
  var outIx = 0;
  function sink() {
    var v = V, id = v && v.sinkId;
    if (!v || !id) return;
    [v.loopEl, v.p2pEl, v.rvideo].forEach(function (a) { if (a && a.setSinkId) a.setSinkId(id).catch(function () {}); });
    if (!v.loopEl && v.actx && v.actx.setSinkId) v.actx.setSinkId(id).catch(function () {});
  }
  /** «بلندگو»: the Android app switches earpiece / speaker; elsewhere the next output device. */
  function speaker() {
    var v = V; if (!v) return;
    if (APP && typeof APP.speaker === 'function') { v.loud = !v.loud; appCall('speaker', v.loud); draw(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (l) {
      var outs = l.filter(function (d) { return d.kind === 'audiooutput'; });
      if (outs.length < 2) { MP.toast('خروجی صدای دیگری پیدا نشد'); return; }
      outIx = (outIx + 1) % outs.length;
      v.sinkId = outs[outIx].deviceId; v.loud = outIx > 0; sink(); draw();
      MP.toast('صدا از: ' + (outs[outIx].label || 'خروجی ' + fa(outIx + 1)));
    });
  }
  function end(reason, local) {
    var v = V;
    if (!v || v.ended) return;
    if (local && v.relay) post(v, [[6, new TextEncoder().encode('{"k":"bye"}')]], '&nr=1', false).catch(function () {});
    v.ended = true;
    clearTimeout(v.ringT); clearTimeout(v.sendT); clearTimeout(v.vT); clearInterval(v.p2pT); ringback(false);
    if (v.id) MP.api('calls/' + v.id, { method: 'POST', body: { action: 'end' } }).catch(function () {});
    setTimeout(function () {
      try { if (v.stream) v.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* */ }
      try { if (v.pc) v.pc.close(); } catch (e) { /* */ }
      (v.loopPcs || []).forEach(function (p) { try { p.close(); } catch (e) { /* */ } });
      [v.enc, v.dec, v.venc, v.vdec].forEach(function (x) { try { if (x && x.state !== 'closed') x.close(); } catch (e) { /* */ } });
      try { if (v.actx) v.actx.close(); } catch (e) { /* */ }
      try { if (v.wake) v.wake.release(); } catch (e) { /* */ }
      appCall('callAudio', false);
    }, 300);
    var secs = v.started ? Math.round((Date.now() - v.started) / 1000) : 0;
    v.endText = reason || (secs ? 'تماس پایان یافت · ' + clock(secs) : 'تماس پایان یافت');
    draw();
    MP.haptic(30);
    setTimeout(function () { if (V === v) { V = null; if (v.ui) v.ui.remove(); bar(); } }, 1800);
  }
  function clock(s) { return MP.faDigits(('0' + Math.floor(s / 60)).slice(-2) + ':' + ('0' + s % 60).slice(-2)); }

  /* ------------------------------------------------------------ Health: a call that never connects says why */

  setInterval(function () {
    var v = V; if (!v || v.ended) return;
    if (v.actx && v.actx.state !== 'running') { v.actx.resume().catch(function () {}); }
    v.weak = v.state === 'active' && !v.p2p && !v.peerMuted && v.heard && Date.now() - v.heard > 6000;
    var stuck = v.state === 'connecting' && Date.now() - v.since > 12000;
    if (stuck && !v.reported) { v.reported = true; report(v); }
    if (v.ui) {
      var t = v.ui.querySelector('.vc-status'); if (t) t.textContent = status(v);
      var q = v.ui.querySelector('.vc-q'); if (q) q.className = 'vc-q q' + quality(v);
      var tap = v.ui.querySelector('.vc-tap'); if (tap) tap.hidden = !(v.actx && v.actx.state !== 'running');
      var n = v.ui.querySelector('.vc-why'); if (n) { var w = stuck ? hint(v) : ''; n.hidden = !w; n.textContent = w; }
      if (v.diagOpen) diagPaint(v);
    }
    bar();
  }, 1000);
  /** In plain words, what is in the way. */
  function hint(v) {
    if (v.actx && v.actx.state !== 'running') return 'صدای برنامه متوقف است؛ روی صفحه بزنید.';
    if (!v.frames) return 'صدایی از میکروفون نمی‌رسد؛ اجازه میکروفون و دستگاه صدا را بررسی کنید.';
    if (!v.okAt || Date.now() - v.okAt > 5000) return 'سایت به تماس جواب نمی‌دهد (' + codes(v) + ')؛ احتمالاً هاست درخواست‌های هم‌زمان را محدود کرده است.';
    if (v.rtt > 1500) return 'سایت خیلی دیر جواب می‌دهد (' + MP.faDigits(String(v.rtt)) + ' میلی‌ثانیه)؛ هاست شلوغ است یا محدودیت دارد.';
    if (v.oldPeer && !v.peerCaps) return v.name + ' با نسخه قدیمی برنامه پاسخ داد؛ برنامه یا صفحه‌اش را یک بار ببندد و دوباره باز کند.';
    if (!v.peerCaps) return 'طرف مقابل هنوز وصل نشده است؛ اگر پاسخ داده، صفحه او را یک بار دوباره باز کنید.';
    if (!v.sent) return 'صدای شما به سایت نمی‌رسد (' + codes(v) + ').';
    return 'صدای طرف مقابل نمی‌رسد؛ احتمالاً میکروفون یا ارتباط او مشکل دارد.';
  }
  function codes(v) { return Object.keys(v.codes).map(function (k) { return k + '×' + v.codes[k]; }).join(' ') || 'بی‌پاسخ'; }
  function diagText(v) {
    return [
      'مسیر: ' + (v.p2p ? 'مستقیم' : v.rest ? 'سایت (وردپرس)' : 'سایت (relay.php)') + ' · ICE: ' + (v.ice || '—'),
      'زمان رفت‌وبرگشت: ' + (v.rtt || '—') + ' ms · فاصله ارسال: ' + v.gap + ' ms',
      'بافر: ' + ((v.stats || {}).buf || 0) + '/' + ((v.stats || {}).target || 0) + ' ms · قطعی پخش: ' + ((v.stats || {}).under || 0),
      'میکروفون: ' + v.frames + ' قطعه، سطح ' + Math.round(v.micLvl * 1000) + ' · صدا: ' + (v.actx ? v.actx.state + ' ' + v.actx.sampleRate : '—'),
      'ارسال: ' + v.sent + ' · دریافت: ' + v.recv + (v.video ? ' · تصویر: ' + v.vsent + '/' + v.vrecv + ' ' + (v.vmode || '') : ''),
      'کدک: ' + (v.enc ? 'Opus' : 'μ-law') + ' · طرف مقابل: ' + JSON.stringify(v.peerCaps || null),
      'پاسخ‌های سایت: ' + codes(v)
    ].join('\n');
  }
  function report(v) {
    try {
      fetch(C.root + 'client-errors', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': C.nonce },
        body: JSON.stringify({ msg: 'call stuck connecting: ' + diagText(v).replace(/\n/g, ' | ').slice(0, 280), src: 'call', line: 0, page: 'call ' + v.id, app: APP ? 'android' : window.__MP_DESKTOP ? 'windows' : 'web' }) }).catch(function () {});
    } catch (e) { /* nothing to do */ }
  }
  function diagPaint(v) { var p = v.ui && v.ui.querySelector('.vc-diag'); if (p) p.textContent = diagText(v); }

  function quality(v) {
    if (v.p2p) return 4;
    if (!v.rtt) return 3;
    var s = v.stats || {};
    return v.rtt < 150 && (s.target || 0) <= 100 ? 4 : v.rtt < 300 ? 3 : v.rtt < 600 ? 2 : 1;
  }
  function status(v) {
    if (v.ended) return v.endText;
    if (v.state === 'ringing') return 'در حال زنگ زدن…';
    if (v.state === 'connecting') return 'در حال اتصال…';
    if (v.weak) return 'اتصال ضعیف…';
    return clock(Math.round((Date.now() - v.started) / 1000));
  }

  /* ------------------------------------------------------------ The call screen (Telegram) */

  var ctx = null, toneT = 0;
  function ringback(on) {
    clearInterval(toneT);
    if (!on) return;
    function burst() {
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
        o.frequency.value = 425; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.05); g.gain.setValueAtTime(0.06, t + 1); g.gain.linearRampToValueAtTime(0, t + 1.05);
        o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 1.1);
      } catch (e) { /* no audio */ }
    }
    burst(); toneT = setInterval(burst, 4000);
  }
  function level(l) { var v = V; if (!v || !v.ui) return; var a = v.ui.querySelector('.vc-av'); if (a) a.style.setProperty('--lvl', String(Math.min(1, l * 6))); }
  function selfView() {
    var v = V; if (!v || !camTrack(v)) return;
    var s = v.selfEl || (v.selfEl = el('video', { class: 'vc-self', muted: true, playsinline: true, autoplay: true }));
    s.muted = true; s.setAttribute('playsinline', ''); s.srcObject = new MediaStream(v.stream.getVideoTracks());
    s.classList.toggle('mirror', v.facing === 'user');
    s.play().catch(function () {});
  }
  function remoteVideo(v) { return v.rvideo || (v.rvideo = el('video', { class: 'vc-remote', playsinline: true, autoplay: true })); }
  function remoteCanvas(v) { return v.rcanvas || (v.rcanvas = el('canvas', { class: 'vc-remote' })); }
  function pic(v, on) {
    var surf = v.p2p ? v.rvideo : v.rcanvas;
    if (on && surf && !surf.isConnected && v.ui && !v.ended) { v.hasPic = on; draw(); return; }
    v.hasPic = on;
    if (v.ui) v.ui.classList.toggle('has-pic', !!on && !v.peerCamOff);
  }
  function btn(cls, ico, label, fn, on) {
    return el('button', { type: 'button', class: 'vc-btn ' + cls + (on ? ' on' : ''), 'aria-label': label, 'aria-pressed': on === undefined ? null : String(!!on), onclick: fn },
      el('span', { html: icon(ico) }), el('small', { text: label }));
  }
  function draw() {
    var v = V; if (!v) return;
    var u = MP.user(v.uid);
    if (!v.ui) { v.ui = el('div', { class: 'vc', role: 'dialog', 'aria-label': 'تماس با ' + v.name }); document.body.append(v.ui); }
    v.ui.classList.toggle('ended', !!v.ended);
    v.ui.classList.toggle('mini', !!v.mini);
    v.ui.classList.toggle('video', !!v.video);
    v.ui.classList.toggle('has-pic', !!v.hasPic && !v.peerCamOff);
    var stage = el('div', { class: 'vc-stage' }, v.p2p && v.rvideo ? v.rvideo : v.rcanvas || null);
    if (v.p2p && v.rvideo) { v.rvideo.play().catch(function () {}); pic(v, true); }
    var phone = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    v.ui.replaceChildren(
      v.video ? stage : null,
      el('div', { class: 'vc-top' },
        el('button', { type: 'button', class: 'icon-btn vc-min', 'aria-label': 'کوچک کردن', html: icon('down'), onclick: function () { v.mini = true; draw(); } }),
        el('button', { type: 'button', class: 'vc-path', title: 'جزئیات اتصال', onclick: function () { v.diagOpen = !v.diagOpen; draw(); } },
          el('i', { class: 'vc-q q' + quality(v) }, el('b'), el('b'), el('b'), el('b')),
          v.state === 'active' ? (v.p2p ? 'مستقیم' : 'از طریق سرور') : v.video ? 'تماس تصویری' : 'تماس صوتی')),
      v.diagOpen ? el('pre', { class: 'vc-diag', dir: 'rtl', text: diagText(v) }) : null,
      el('div', { class: 'vc-mid' },
        el('div', { class: 'vc-av' + (v.state === 'active' ? ' live' : '') }, MP.avatar(u, 'xl')),
        el('strong', { class: 'vc-name', text: v.name }),
        el('span', { class: 'vc-status', text: status(v) }),
        el('small', { class: 'vc-note vc-why', hidden: true }),
        v.peerMuted && !v.ended ? el('small', { class: 'vc-note', text: 'میکروفون ' + v.name.split(' ')[0] + ' خاموش است' }) : null,
        v.video && v.peerCamOff && !v.ended ? el('small', { class: 'vc-note', text: 'دوربین ' + v.name.split(' ')[0] + ' خاموش است' }) : null,
        el('button', { type: 'button', class: 'btn btn-primary vc-tap', hidden: true, text: 'برای وصل شدن صدا بزنید', onclick: function () { if (v.actx) v.actx.resume(); } })),
      v.video && v.selfEl && !v.camOff ? v.selfEl : null,
      el('div', { class: 'vc-acts' },
        v.video ? btn('vc-cam', 'video', v.camOff ? 'دوربین خاموش' : 'دوربین', function () { camera(); }, v.camOff) : btn('vc-spk', 'speaker', 'بلندگو', speaker, !!v.loud),
        v.video && phone ? btn('vc-flip', 'repeat', 'چرخش دوربین', flip) : v.video ? btn('vc-spk', 'speaker', 'بلندگو', speaker, !!v.loud) : null,
        btn('vc-mute', 'mic', v.muted ? 'میکروفون خاموش' : 'بی‌صدا', function () { mute(); }, v.muted),
        btn('vc-end', 'phone', v.ended ? 'پایان' : 'پایان تماس', function () { end('', true); })));
    if (v.selfEl) v.selfEl.play().catch(function () {});
    bar();
  }
  function show() { if (V) { V.mini = false; draw(); } }
  /** Minimised: a green bar on top of the app (Telegram's «بازگشت به تماس»). */
  function bar() {
    var b = document.getElementById('vc-bar'), v = V;
    if (!v || !v.mini || v.ended) { if (b) b.remove(); document.body.classList.remove('vc-on'); return; }
    if (!b) { b = el('button', { type: 'button', id: 'vc-bar', class: 'vc-bar', onclick: show }); document.body.append(b); }
    document.body.classList.add('vc-on');
    b.replaceChildren(el('span', { html: icon(v.video ? 'video' : 'phone') }), el('b', { text: v.name }), el('span', { text: status(v) }), el('small', { text: 'بازگشت به تماس' }));
  }
  // closing the app mid-call still ends it for the other side
  window.addEventListener('pagehide', function () {
    var v = V;
    if (!v || v.ended || !v.id) return;
    try { fetch(C.root + 'calls/' + v.id, { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': C.nonce }, body: JSON.stringify({ action: 'end' }) }); } catch (e) { /* closing */ }
  });
  ['touchend', 'click'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      var v = V; if (!v) return;
      if (v.actx && v.actx.state !== 'running') v.actx.resume();
      [v.loopEl, v.p2pEl, v.rvideo, v.selfEl].forEach(function (a) { if (a && a.paused && a.srcObject) a.play().catch(function () {}); });
    }, true);
  });

  // what the server says about our outgoing call: declined, or answered by a page too old to join it
  MP.on('live', function (d) {
    var v = V;
    if (!v || v.ended || !v.outgoing || !d.call || +d.call.id !== +v.id) return;
    if (d.call.state === 'declined') end(v.name + ' تماس را رد کرد', true);
    else if (d.call.state === 'accepted' && !+d.call.app && !v.peerCaps) { v.oldPeer = true; }
  });
  MP.voice = { start: start, join: join, end: function () { end('', true); }, show: show, mute: mute, camera: camera, current: function () { return V; }, diag: function () { return V ? diagText(V) : ''; } };
})();
