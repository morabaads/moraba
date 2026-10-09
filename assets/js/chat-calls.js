/*
 * One-to-one calls with ringing (MP_Calls): «تماس» in a private chat rings the other person (call-voice.js carries the call);
 * the other person's panel/chat app rings (overlay, tone; the Windows app comes forward and shows a notification)
 * for 45 seconds; accept opens the same room, decline tells the caller. Rooms open in their own window
 * (the Windows app: a native window; browsers: a popup).
 */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, el = MP.el, icon = MP.icon, C = window.MP_CONFIG || {};
  var host = window.chrome && window.chrome.webview && window.__MP_DESKTOP ? window.chrome.webview : null;
  if (C.pop) return; // separate chat windows leave calls to the main one

  function openRoom(url, title) {
    if (host) { host.postMessage({ t: 'window', url: url, title: title }); return; }
    var w = window.open(url, 'mpcall', 'popup,width=1100,height=720');
    if (!w) location.assign(url);
  }

  var outgoing = null;
  MP.call = function (uid, video) {
    // voice and video calls stay in the app (call-voice.js); the meeting room only without it
    if (MP.voice) { MP.voice.start(uid, !!video); return; }
    var u = MP.user(uid);
    MP.api('calls', { method: 'POST', body: { user_id: uid, video: video ? 1 : 0 } }).then(function (d) {
      outgoing = { id: d.id, name: u.name };
      openRoom(d.url, 'تماس با ' + u.name);
      MP.toast('در حال زنگ زدن به ' + u.name + '…', { duration: 6000 });
    }).catch(MP.soft);
  };

  /* the ring tone: two tones, like a phone (WebAudio, no file) */
  var ctx = null, toneT = 0;
  function tone(on) {
    clearInterval(toneT);
    if (!on) return;
    function burst() {
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        [0, 0.45].forEach(function (at) {
          var o = ctx.createOscillator(), g = ctx.createGain(), o2 = ctx.createOscillator();
          o.frequency.value = 440; o2.frequency.value = 480;
          g.gain.setValueAtTime(0, ctx.currentTime + at);
          g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + at + 0.03);
          g.gain.setValueAtTime(0.12, ctx.currentTime + at + 0.35);
          g.gain.linearRampToValueAtTime(0, ctx.currentTime + at + 0.4);
          o.connect(g); o2.connect(g); g.connect(ctx.destination);
          o.start(ctx.currentTime + at); o2.start(ctx.currentTime + at);
          o.stop(ctx.currentTime + at + 0.42); o2.stop(ctx.currentTime + at + 0.42);
        });
      } catch (e) { /* no audio */ }
    }
    burst();
    toneT = setInterval(burst, 3000);
  }

  var ringing = null, box = null, endT = 0;
  function hideRing() {
    tone(false); clearTimeout(endT);
    if (box) { box.remove(); box = null; }
    ringing = null;
  }
  function answer(action) {
    var r = ringing; if (!r) return;
    hideRing();
    if (action === 'accept' && MP.voice) { MP.voice.join(r); return; } // accepts it itself
    MP.api('calls/' + r.id, { method: 'POST', body: { action: action } }).then(function (d) {
      if (action === 'accept') openRoom(d.url || r.url, 'تماس با ' + r.name);
    }).catch(MP.soft);
  }
  function showRing(r) {
    hideRing();
    ringing = r;
    var u = MP.user(+r.from);
    box = el('div', { class: 'call-ring', role: 'alertdialog', 'aria-label': 'تماس از ' + r.name },
      el('div', { class: 'cr-card' },
        el('div', { class: 'cr-av' }, MP.avatar(u, 'xl')),
        el('strong', { text: r.name }),
        el('small', { text: (+r.video ? 'تماس تصویری' : 'تماس صوتی') + '…' }),
        el('div', { class: 'cr-acts' },
          el('button', { type: 'button', class: 'cr-no', title: 'رد تماس', 'aria-label': 'رد تماس', html: icon('phone'), onclick: function () { answer('decline'); } }),
          el('button', { type: 'button', class: 'cr-yes', title: 'پاسخ', 'aria-label': 'پاسخ', html: icon(+r.video ? 'video' : 'phone'), onclick: function () { answer('accept'); } }))));
    document.body.append(box);
    tone(true);
    if (host) {
      host.postMessage({ t: 'show' });
      host.postMessage({ t: 'notify', title: 'تماس از ' + r.name, body: +r.video ? 'تماس تصویری' : 'تماس صوتی', channel: +r.channel || 0, noreply: 1 });
    }
    var left = Math.max(5, 45 - (Date.now() / 1000 - r.at));
    endT = setTimeout(hideRing, left * 1000);
  }

  MP.on('live', function (d) {
    if (d.ring && (!ringing || ringing.id !== d.ring.id)) showRing(d.ring);
    else if (!d.ring && ringing) hideRing();
    if (d.call && outgoing && d.call.id === outgoing.id) {
      var st = d.call.state, n = outgoing.name;
      if (st === 'declined') MP.toast(n + ' تماس را رد کرد', { error: true });
      else if (st === 'missed') MP.toast(n + ' پاسخ نداد');
      else if (st === 'accepted') MP.toast(n + ' به تماس پیوست');
      outgoing = null;
    }
  });
  MP.callRing = showRing; // tests
})();
