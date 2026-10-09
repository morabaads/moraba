/*
 * Voice calls inside «مربع چت», built for a plain (Iranian) shared host — no STUN/TURN server is needed:
 * - first a direct WebRTC connection between the two devices is tried (signals go through the relay); inside the
 *   studio's network, or wherever the devices can reach each other, the sound then goes device to device;
 * - otherwise the sound goes through this site's media relay (MP_Relay / relay.php, no WordPress per request):
 *   Opus 48 kHz in 20 ms packets (μ-law 16 kHz where the browser has no Opus encoder), a sender every 40 ms and a
 *   held receiver (the relay answers as soon as the other side writes), an adaptive jitter buffer in an
 *   AudioWorklet (60…300 ms, catches up after a stall), and on Chrome the played sound goes through a loopback
 *   connection so the browser's echo canceller hears it;
 * - Telegram's call screen: avatar that pulses when the other talks, timer, quality bars, «مستقیم»/«از طریق سرور»,
 *   mute, speaker (output device / the Android app's speakerphone), minimise to a bar, end.
 * The ring itself, accept and decline stay in chat-calls.js; MP.voice.start / MP.voice.join are called from there.
 */
(function () {
  'use strict';
  var MP = window.MP, el = MP.el, icon = MP.icon, fa = MP.fa, C = window.MP_CONFIG || {};
  if (C.pop) return;
  var UA = navigator.userAgent, CHROMIUM = /Chrome\//.test(UA) || !!(window.chrome && window.chrome.webview);
  var IOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
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
    // too far behind (a stall delivered a burst): drop the oldest to get back near the target
    "if(this.size>this.target+9600){while(this.size>this.target+960&&this.q.length>1){var d=this.q.shift();this.size-=d.length;}}",
    "while(k<n){if(!this.cur){this.cur=this.q.shift();this.pos=0;if(!this.cur){for(;k<n;k++){this.last*=0.95;out[k]=this.last;}this.under++;this.on=false;this.target=Math.min(14400,this.target+960);this.calm=0;break;}}",
    "var c=this.cur,m=Math.min(n-k,c.length-this.pos);for(var j=0;j<m;j++)out[k+j]=c[this.pos+j];k+=m;this.pos+=m;this.size-=m;if(this.pos>=c.length)this.cur=null;}",
    "this.last=out[n-1]||0;if(++this.calm>3000&&this.target>2880){this.target-=480;this.calm=0;}return this.report(out,n);}",
    "report(out,n){var s=0;for(var z=0;z<n;z+=4)s+=out[z]*out[z];this.lvl=Math.max(Math.sqrt(s/(n/4)),this.lvl*0.92);",
    "if(++this.tick%30===0)this.port.postMessage({lvl:this.lvl,buf:Math.round(this.size/48),target:Math.round(this.target/48),under:this.under});return true;}}",
    "registerProcessor('mp-cap',Cap);registerProcessor('mp-play',Play);"
  ].join('');

  /* ------------------------------------------------------------ μ-law (browsers without an Opus encoder) */
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
  var V = null; // the one call at a time

  function caps() {
    return { ae: !!window.AudioEncoder, ad: !!window.AudioDecoder };
  }
  function mic() {
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: RATE } });
  }

  /** Inside the tap that started or answered the call: browsers only let sound start from one. */
  function makeCtx(v) {
    var AC = window.AudioContext || window.webkitAudioContext;
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) { /* older iOS */ }
    try { v.actx = new AC({ sampleRate: RATE, latencyHint: 'interactive' }); } catch (e) { v.actx = new AC(); }
    if (v.actx.state !== 'running') v.actx.resume();
  }
  function newCall(o) {
    V = {
      id: o.id, uid: o.uid, name: MP.user(o.uid).name, video: false, outgoing: !!o.outgoing,
      state: o.outgoing ? 'ringing' : 'connecting', started: 0, muted: false, peerMuted: false, p2p: false,
      relay: null, c: {}, out: [], pkts: [], ts: 0, sendBusy: false, recvOn: false, rtt: 0, fails: 0, rest: false,
      peerCaps: null, heard: 0, stream: null, actx: null, cap: null, play: null, playOut: null, enc: null, dec: null, dts: 0,
      loopEl: null, pc: null, iceQ: [], ended: false, ui: null, stats: { buf: 0, target: 0, under: 0, lvl: 0 }
    };
    return V;
  }

  /** MP.voice.start(uid): call a colleague. */
  function start(uid) {
    if (V) { MP.toast('یک تماس در جریان است'); show(); return; }
    var v = newCall({ uid: uid, outgoing: true });
    makeCtx(v);
    draw();
    mic().then(function (s) {
      v.stream = s;
      return MP.api('calls', { method: 'POST', body: { user_id: uid, video: 0 } });
    }).then(function (d) {
      if (v.ended) { MP.api('calls/' + d.id, { method: 'POST', body: { action: 'cancel' } }).catch(function () {}); return; }
      v.id = d.id; v.relay = d.voice;
      v.c[v.relay.other] = [0, 0]; // the callee's log starts later: read it from its very first record (the hello)
      audioStart();
      recvLoop();
      ringback(true);
      v.ringT = setTimeout(function () { if (v.state === 'ringing') end('پاسخ داده نشد', true); }, (d.ring || 45) * 1000 + 3000);
    }).catch(function (e) {
      end(e && e.name === 'NotAllowedError' ? 'اجازه میکروفون داده نشد' : (e && e.message) || 'تماس برقرار نشد', true);
    });
  }

  /** MP.voice.join(ring): the ring was accepted (chat-calls.js). */
  function join(r) {
    if (V) { V.ended || end('', true); }
    var v = newCall({ id: +r.id, uid: +r.from, outgoing: false });
    makeCtx(v);
    draw();
    mic().then(function (s) {
      v.stream = s;
      return MP.api('calls/' + v.id, { method: 'POST', body: { action: 'accept' } });
    }).then(function (d) {
      if (!d.voice) throw new Error('این تماس دیگر در دسترس نیست');
      v.relay = d.voice;
      audioStart();
      v.c[v.relay.other] = [0, 0]; // read the caller's signals from the start
      signal({ k: 'hi', caps: caps() });
      recvLoop();
    }).catch(function (e) {
      if (e && e.name === 'NotAllowedError') MP.api('calls/' + v.id, { method: 'POST', body: { action: 'decline' } }).catch(function () {});
      end(e && e.name === 'NotAllowedError' ? 'اجازه میکروفون داده نشد' : (e && e.message) || 'تماس برقرار نشد', true);
    });
  }

  /* ------------------------------------------------------------ Sound in and out */

  function audioStart() {
    var v = V;
    if (v.actx.state !== 'running') v.actx.resume();
    appCall('callAudio', true); // Android app: communication mode (phone's own echo canceller, earpiece), keep running
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { v.wake = l; }, function () {}); } catch (e) { /* none */ }
    var url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    (v.actx.audioWorklet ? v.actx.audioWorklet.addModule(url) : Promise.reject(new Error('no worklet'))).then(function () {
      if (v.ended) return;
      v.play = new AudioWorkletNode(v.actx, 'mp-play', { numberOfInputs: 0, outputChannelCount: [1] });
      v.play.port.onmessage = function (e) { v.stats = e.data; level(e.data.lvl); };
      v.playOut = v.actx.createGain();
      v.play.connect(v.playOut);
      if (CHROMIUM && window.RTCPeerConnection) loopback(v); else v.playOut.connect(v.actx.destination);
      var src = v.actx.createMediaStreamSource(v.stream);
      v.cap = new AudioWorkletNode(v.actx, 'mp-cap', { numberOfInputs: 1, numberOfOutputs: 0 });
      v.cap.port.onmessage = function (e) { captured(e.data); };
      src.connect(v.cap);
    }).catch(function () { end('مرورگر از تماس صوتی پشتیبانی نمی‌کند؛ آن را به‌روز کنید.', true); });
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
    if (!v || v.ended || v.muted || v.p2p || v.state === 'ringing' || !v.peerCaps) return;
    var useOpus = window.AudioEncoder && v.peerCaps.ad && v.actx.sampleRate === RATE && opusEnc(v);
    if (useOpus) {
      try {
        var ad = new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: f.length, numberOfChannels: 1, timestamp: v.ts, data: f });
        v.ts += 20000; v.enc.encode(ad); ad.close();
      } catch (e) { v.enc = null; }
      return;
    }
    var s16 = resample(f, v.actx.sampleRate, 16000), b = new Uint8Array(s16.length);
    for (var i = 0; i < s16.length; i++) b[i] = ulaw(s16[i]);
    v.out.push([1, b]);
  }
  function opusEnc(v) {
    if (v.enc) return true;
    if (v.encBad) return false;
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

  /** Sound from the other side → the jitter buffer. */
  function playFloat(v, f, rate) { if (v.play && !v.p2p) v.play.port.postMessage(resample(f, rate, v.actx.sampleRate)); }
  function heard(v, kind, bytes) {
    if (v.p2p) return;
    v.heard = Date.now();
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

  /* ------------------------------------------------------------ The relay: a sender every 40 ms, a held receiver */

  function relayUrl(v, extra) {
    var r = v.relay;
    return (v.rest ? r.rest + (r.rest.indexOf('?') >= 0 ? '&' : '?') : r.relay + '?') + r.q + extra;
  }
  function post(v, recs, extra, cursor) {
    var head = { r: recs.map(function (x) { return [x[0], x[1].length]; }), c: cursor ? v.c : {}, w: {} };
    var hj = new TextEncoder().encode(JSON.stringify(head)), len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, hj.length);
    return fetch(relayUrl(v, extra), {
      method: 'POST', body: new Blob([len, hj].concat(recs.map(function (x) { return x[1]; })), { type: 'application/octet-stream' }),
      headers: v.rest && C.nonce ? { 'X-WP-Nonce': C.nonce } : {}, credentials: v.rest ? 'same-origin' : 'omit', cache: 'no-store'
    }).then(function (r) {
      if (!r.ok) { var e = new Error('relay'); e.status = r.status; throw e; }
      return r.arrayBuffer();
    });
  }
  function relayFail(v, e) {
    v.fails++;
    if (e && e.status === 410) { setTimeout(function () { if (V === v && !v.ended) end(v.state === 'ringing' ? 'پاسخ داده نشد' : 'تماس پایان یافت', true); }, 1500); return true; }
    if (e && e.status === 403) { end('تماس پایان یافت', true); return true; }
    if (!v.rest && v.fails > 1 && (!e || !e.status || e.status === 404 || e.status === 503 || e.status === 500 || e.status === 405)) v.rest = true; // relay.php blocked → WordPress route
    return false;
  }
  function sendTick() {
    var v = V;
    if (!v || v.ended || !v.relay) return;
    clearTimeout(v.sendT);
    flushOpus(v);
    if (v.sendBusy || !v.out.length) { v.sendT = setTimeout(sendTick, 40); return; }
    var recs = v.out.splice(0), t0 = Date.now();
    v.sendBusy = true;
    post(v, recs, '&nr=1', false).then(function () {
      v.fails = 0;
      var rtt = Date.now() - t0; v.rtt = v.rtt ? Math.round(v.rtt * 0.85 + rtt * 0.15) : rtt;
    }).catch(function (e) {
      if (relayFail(v, e)) return;
      // keep signals and the last 300 ms of sound across a hiccup
      var keep = recs.filter(function (x) { return x[0] === 6; }).concat(recs.filter(function (x) { return x[0] !== 6; }).slice(-8));
      v.out = keep.concat(v.out);
    }).then(function () { v.sendBusy = false; v.sendT = setTimeout(sendTick, Math.max(10, 40 - (Date.now() - t0)) + (v.fails > 3 ? 1000 : 0)); });
  }
  function signal(o) { if (!V) return; V.out.push([6, new TextEncoder().encode(JSON.stringify(o))]); sendTick(); }
  function recvLoop() {
    var v = V;
    if (!v || v.ended || !v.relay || v.recvOn) return;
    v.recvOn = true;
    (function go() {
      if (V !== v || v.ended) { v.recvOn = false; return; }
      post(v, [], '&wait=' + (v.p2p ? 1500 : 1000), true).then(function (ab) {
        v.fails = 0;
        var dv = new DataView(ab), jl = dv.getUint32(0), res = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, jl))), at = 4 + jl;
        Object.keys(res.c || {}).forEach(function (k) { v.c[k] = res.c[k]; });
        (res.items || []).forEach(function (it) {
          var bytes = new Uint8Array(ab, at, it[2]); at += it[2];
          if (+it[0] !== v.relay.other) return;
          if (it[1] === 6) { try { onSignal(JSON.parse(new TextDecoder().decode(bytes))); } catch (e) { /* bad signal */ } }
          else if (it[1] <= 2) heard(v, it[1], bytes.slice());
        });
        go();
      }).catch(function (e) {
        if (relayFail(v, e)) { v.recvOn = false; return; }
        setTimeout(go, Math.min(3000, 300 * v.fails));
      });
    })();
    sendTick();
  }

  /* ------------------------------------------------------------ Signals: hello, direct connection, mute, bye */

  function onSignal(s) {
    var v = V;
    if (!v) return;
    if (s.k === 'hi') {
      v.peerCaps = s.caps || {};
      if (v.outgoing) {
        ringback(false); clearTimeout(v.ringT);
        signal({ k: 'hi', caps: caps() });
        if (v.state === 'ringing') { v.state = 'connecting'; draw(); }
        direct(true);
      }
      return;
    }
    if (s.k === 'offer') { direct(false, s.sdp); return; }
    if (s.k === 'answer' && v.pc) { v.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp }).then(flushIce).catch(function () {}); return; }
    if (s.k === 'ice' && s.c) { if (v.pc && v.pc.remoteDescription) v.pc.addIceCandidate(s.c).catch(function () {}); else v.iceQ.push(s.c); return; }
    if (s.k === 'mute') { v.peerMuted = !!s.on; draw(); return; }
    if (s.k === 'bye') { end('تماس پایان یافت', false); }
  }
  function flushIce() { var v = V; if (!v || !v.pc) return; v.iceQ.splice(0).forEach(function (c) { v.pc.addIceCandidate(c).catch(function () {}); }); }
  /** Opus at a voice-friendly high bitrate with in-band FEC on the direct path. */
  function tuneSdp(sdp) { return sdp.replace(/(a=fmtp:\d+ .*useinbandfec=1)/g, '$1;maxaveragebitrate=48000;stereo=0;cbr=0'); }
  /** The direct path: device to device when they can reach each other; the relay keeps going until it works. */
  function direct(offerer, sdp) {
    var v = V;
    if (!v || !window.RTCPeerConnection || store('mp_call_p2p') === '0' || (v.pc && offerer)) return;
    if (!v.pc) {
      var pc = v.pc = new RTCPeerConnection({ iceServers: (v.relay && v.relay.ice) || [] });
      v.stream.getAudioTracks().forEach(function (t) { pc.addTrack(t, v.stream); });
      pc.onicecandidate = function (e) { if (e.candidate) signal({ k: 'ice', c: e.candidate.toJSON() }); };
      pc.ontrack = function (e) {
        var a = v.p2pEl || (v.p2pEl = new Audio()); a.autoplay = true; a.srcObject = e.streams[0] || new MediaStream([e.track]);
        a.play().catch(function () {}); sink();
      };
      var st = function () {
        var s = pc.iceConnectionState, ok = s === 'connected' || s === 'completed';
        if (ok && !v.p2p) { v.p2p = true; if (v.play) v.play.port.postMessage('reset'); active(); draw(); }
        else if ((s === 'failed' || s === 'disconnected' || s === 'closed') && v.p2p) { v.p2p = false; draw(); }
      };
      pc.oniceconnectionstatechange = st;
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
    clearInterval(v.clock);
    v.clock = setInterval(tick, 1000);
  }
  function mute(on) {
    var v = V; if (!v) return;
    v.muted = on === undefined ? !v.muted : !!on;
    if (v.stream) v.stream.getAudioTracks().forEach(function (t) { t.enabled = !v.muted; });
    signal({ k: 'mute', on: v.muted });
    draw();
  }
  var outIx = 0;
  function sink() {
    var v = V, id = v && v.sinkId;
    if (!v || !id) return;
    [v.loopEl, v.p2pEl].forEach(function (a) { if (a && a.setSinkId) a.setSinkId(id).catch(function () {}); });
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
    clearInterval(v.clock); clearTimeout(v.ringT); clearTimeout(v.sendT); ringback(false);
    if (v.id) MP.api('calls/' + v.id, { method: 'POST', body: { action: 'end' } }).catch(function () {});
    setTimeout(function () {
      try { if (v.stream) v.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* */ }
      try { if (v.pc) v.pc.close(); } catch (e) { /* */ }
      (v.loopPcs || []).forEach(function (p) { try { p.close(); } catch (e) { /* */ } });
      try { if (v.enc) v.enc.close(); if (v.dec) v.dec.close(); } catch (e) { /* */ }
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
  function tick() {
    var v = V; if (!v || v.ended) return;
    if (!v.p2p && v.state === 'active' && v.heard && Date.now() - v.heard > 8000 && !v.peerMuted) v.weak = true; else v.weak = false;
    var t = v.ui && v.ui.querySelector('.vc-status');
    if (t) t.textContent = status(v);
    var q = v.ui && v.ui.querySelector('.vc-q');
    if (q) q.className = 'vc-q q' + quality(v);
    bar();
  }
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
  /** «در حال زنگ زدن»: the caller hears a soft ring-back. */
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
  function level(l) {
    var v = V; if (!v || !v.ui) return;
    var a = v.ui.querySelector('.vc-av');
    if (a) a.style.setProperty('--lvl', String(Math.min(1, l * 6)));
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
    v.ui.replaceChildren(
      el('div', { class: 'vc-top' },
        el('button', { type: 'button', class: 'icon-btn vc-min', 'aria-label': 'کوچک کردن', html: icon('down'), onclick: function () { v.mini = true; draw(); bar(); } }),
        el('span', { class: 'vc-path' }, el('i', { class: 'vc-q q' + quality(v) }, el('b'), el('b'), el('b'), el('b')),
          v.state === 'active' ? (v.p2p ? 'مستقیم' : 'از طریق سرور') : 'تماس صوتی')),
      el('div', { class: 'vc-mid' },
        el('div', { class: 'vc-av' + (v.state === 'active' ? ' live' : '') }, MP.avatar(u, 'xl')),
        el('strong', { class: 'vc-name', text: v.name }),
        el('span', { class: 'vc-status', text: status(v) }),
        v.peerMuted && !v.ended ? el('small', { class: 'vc-note', text: 'میکروفون ' + v.name.split(' ')[0] + ' خاموش است' }) : null),
      el('div', { class: 'vc-acts' },
        btn('vc-spk', 'speaker', 'بلندگو', speaker, !!v.loud),
        btn('vc-mute', 'mic', v.muted ? 'میکروفون خاموش' : 'بی‌صدا', function () { mute(); }, v.muted),
        btn('vc-end', 'phone', v.ended ? 'پایان' : 'پایان تماس', function () { end('', true); })));
    bar();
  }
  function show() { if (V) { V.mini = false; draw(); } }
  /** Minimised: a green bar on top of the app (Telegram's «بازگشت به تماس»). */
  function bar() {
    var b = document.getElementById('vc-bar'), v = V;
    if (!v || !v.mini || v.ended) { if (b) b.remove(); document.body.classList.remove('vc-on'); return; }
    if (!b) { b = el('button', { type: 'button', id: 'vc-bar', class: 'vc-bar', onclick: show }); document.body.append(b); }
    document.body.classList.add('vc-on');
    b.replaceChildren(el('span', { html: icon('phone') }), el('b', { text: v.name }), el('span', { text: status(v) }), el('small', { text: 'بازگشت به تماس' }));
  }
  // closing the app mid-call still ends it for the other side
  window.addEventListener('pagehide', function () {
    var v = V;
    if (!v || v.ended || !v.id) return;
    try { fetch(C.root + 'calls/' + v.id, { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': C.nonce }, body: JSON.stringify({ action: 'end' }) }); } catch (e) { /* closing */ }
  });
  ['touchend', 'click'].forEach(function (ev) { document.addEventListener(ev, function () { var v = V; if (v && v.actx && v.actx.state !== 'running') v.actx.resume(); [v && v.loopEl, v && v.p2pEl].forEach(function (a) { if (a && a.paused && a.srcObject) a.play().catch(function () {}); }); }, true); });

  MP.voice = { start: start, join: join, end: function () { end('', true); }, show: show, mute: mute, current: function () { return V; } };
})();
