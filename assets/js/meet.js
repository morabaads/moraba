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
  function toast(t) { var n = $('#toast'); n.textContent = t; n.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { n.hidden = true; }, 3500); }

  /* ------------------------------------------------------------ Local media */
  function getMedia() {
    var md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) return Promise.resolve(null);
    return md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } })
      .catch(function () { return md.getUserMedia({ audio: true }).catch(function () { return md.getUserMedia({ video: true }); }); })
      .catch(function () { return null; });
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

  getMedia().then(function (s) {
    setLocal(s);
    if (s) $('#pv').srcObject = s;
    $('#pv-hint').textContent = !s ? 'دسترسی به دوربین و میکروفون داده نشد؛ می‌توانید فقط ببینید و بشنوید.' : !vTrack ? 'دوربینی پیدا نشد.' : '';
  });
  $('#pv-mic').onclick = function () { want.mic = !want.mic; applyLocal(); };
  $('#pv-cam').onclick = function () { want.cam = !want.cam; applyLocal(); };

  $('#join-form').onsubmit = function (e) {
    e.preventDefault();
    var btn = $('#join-btn'), err = $('#join-err');
    err.textContent = ''; btn.disabled = true;
    var name = nameValue(); try { if (name) localStorage.setItem('mp-meet-name', name); } catch (x) { /* private */ }
    api('/join', { name: name, password: $('#j-pass') ? $('#j-pass').value : '', mic: want.mic, cam: want.cam })
      .then(function (d) {
        me = { id: d.peer, secret: d.secret, role: d.role, state: d.state };
        if (d.state === 'waiting') { show('wait'); poll(); } else enter();
      })
      .catch(function (x) { btn.disabled = false; err.textContent = x.message; });
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
    var v = el('video', { autoplay: '', playsinline: '' }); if (mine) v.muted = true;
    var t = el('div', { class: 'tile' + (mine ? ' mine' : '') }, v,
      el('div', { class: 'ph' }, el('span', { class: 'av' })),
      el('div', { class: 'tag' }, el('i', { class: 'm', html: ic('mic-off') }), el('b'), el('i', { class: 'h', html: ic('hand') })));
    p.tile = t; p.video = v;
    if (p.stream) v.srcObject = p.stream;
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

  /* --- peer connections */
  function conn(pid, init) {
    var pc = new RTCPeerConnection({ iceServers: ice });
    var o = { id: pid, pc: pc, q: [], stream: new MediaStream(), init: init, a: null, v: null };
    pc.ontrack = function (e) {
      if (o.stream.getTracks().indexOf(e.track) < 0) o.stream.addTrack(e.track);
      if (o.video && o.video.srcObject !== o.stream) o.video.srcObject = o.stream;
      if (o.video) o.video.play().catch(function () {});
    };
    pc.onicecandidate = function (e) { if (e.candidate) signal(pid, 'ice', e.candidate.toJSON()); };
    pc.onconnectionstatechange = function () {
      if (o.tile) o.tile.classList.toggle('weak', pc.connectionState === 'failed' || pc.connectionState === 'disconnected');
      if (pc.connectionState === 'failed' && o.init) offer(o, true);
    };
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
    try { o.pc.close(); } catch (e) { /* closed */ }
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
      if (!o) {
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
