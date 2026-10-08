/*
 * The client portal's chat, made like the panel's (Telegram-style): grouped bubbles with tails, time and
 * ticks (✓ sent, ✓✓ read by the team), replies, editing and deleting one's own messages, reactions,
 * photos (albums, the photo viewer), videos, voice messages, files of any format (sent in 1.5 MB pieces),
 * drag & drop / paste, Apple emoji, «در حال نوشتن…» from the team.
 * client.js calls MPClientChat(options) once and then .start() / .load().
 */
window.MPClientChat = function (o) {
  'use strict';
  var h = o.h, icon = o.icon, fa = o.fa, base = o.base;
  var box = document.getElementById('chat-messages'), form = document.getElementById('client-form'), text = form.elements.message;
  var $ = function (id) { return document.getElementById(id); };
  var msgs = {}, rowsById = {}, lastId = 0, since = '', teamRead = 0, busy = null, started = false, first = true;
  var replyTo = null, editing = null, canEdit = true, sendQ = Promise.resolve(), tmpN = 0;
  var REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏', '🎉', '✅'];

  /* ------------------------------------------------------------ helpers */
  var key = (function () {
    var k = '';
    try { k = localStorage.getItem('mp-ck') || ''; } catch (e) { /* private */ }
    if (k.length < 16) {
      var a = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(a);
      k = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      try { localStorage.setItem('mp-ck', k); } catch (e) { /* private */ }
    }
    return k;
  })();
  function req(path, body, method) {
    var hd = { 'X-MP-Client-Key': key };
    if (body) hd['Content-Type'] = 'application/json';
    return fetch(base + path, { method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin', headers: hd, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { var e = new Error(d.message || 'خطا'); e.code = d.code; throw e; } return d; }); });
  }
  function hm(s) { return fa(String(s || '').slice(11, 16)); }
  function size(n) { n = +n || 0; return n < 1024 ? fa(n) + ' بایت' : n < 1048576 ? fa(Math.round(n / 1024)) + ' کیلوبایت' : fa((n / 1048576).toFixed(1)) + ' مگابایت'; }
  function clock(sec) { sec = isFinite(sec) ? Math.max(0, Math.round(sec || 0)) : 0; return fa(Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2)); }
  function stamp() { var d = new Date(); return o.today() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':00'; }
  function ts(m) { var d = new Date(String(m.created_at).replace(' ', 'T')); return isNaN(d) ? 0 : Math.round(d.getTime() / 1000); }
  function isPic(f) { return /^image\/(jpeg|png|webp|gif)$/i.test(f.type || ''); }
  function isVid(f) { return /^video\/(mp4|webm|quicktime)$/i.test(f.type || ''); }
  function kindOf(m) {
    var x = m.x || {};
    if (x.poll) return 'poll';
    if (x.loc) return 'loc';
    if (x.contact) return 'contact';
    if (x.card) return 'card';
    if (!m.file) return '';
    if (x.sticker || x.gif) return 'sticker';
    if (x.round) return 'round';
    if (/^audio\//.test(m.file.mime || '')) return 'voice';
    if (m.as_file) return 'file';
    if (m.file.image && /^image\/(jpeg|png|webp|gif|bmp)$/.test(m.file.mime || '')) return 'photo';
    if (/^video\/(mp4|webm|quicktime)$/.test(m.file.mime || '')) return 'video';
    return 'file';
  }
  function snippet(m) {
    var k = kindOf(m), b = String(m.body || '').replace(/\*\*|__|~~|\|\||`/g, '').trim();
    if (b) return b.slice(0, 120);
    return { photo: 'عکس', video: 'ویدیو', voice: 'پیام صوتی', sticker: 'استیکر', round: 'پیام ویدیویی', poll: 'نظرسنجی', loc: 'موقعیت مکانی', contact: 'مخاطب' }[k] || (m.file ? m.file.name : '');
  }

  /* Apple emoji (the same picture the panel uses), except on Apple devices that have them anyway. */
  var EMOJI_RE = null, tiles = null, appleNative = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  try { EMOJI_RE = new RegExp('(?:\\p{RI}\\p{RI}|[#*0-9]\\uFE0F?\\u20E3|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{EMod})?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{EMod})?)*)', 'gu'); } catch (e) { /* old browser */ }
  function emojiImg(seq) {
    if (appleNative) return document.createTextNode(seq);
    if (!tiles) { tiles = {}; String(window.MP_EMOJI_MAP || '').split(',').forEach(function (c, i) { if (c) tiles[c] = i; }); }
    var code = Array.from(seq).map(function (c) { return c.codePointAt(0).toString(16); }).join('-').replace(/-fe0f/g, ''), t = tiles[code];
    if (t === undefined) return document.createTextNode(seq);
    var i = h('i', { class: 'emj', role: 'img', 'aria-label': seq, text: seq });
    i.style.backgroundPosition = (t % 40) / 39 * 100 + '% ' + Math.floor(t / 40) / 32 * 100 + '%';
    return i;
  }
  function emojify(node) {
    if (appleNative || !EMOJI_RE || !node) return node;
    var w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null), list = [], t;
    while ((t = w.nextNode())) { EMOJI_RE.lastIndex = 0; if (!/\bemj/.test(t.parentNode.className || '') && EMOJI_RE.test(t.nodeValue)) list.push(t); }
    list.forEach(function (tn) {
      var s = tn.nodeValue, frag = document.createDocumentFragment(), last = 0, m;
      EMOJI_RE.lastIndex = 0;
      while ((m = EMOJI_RE.exec(s))) {
        if (/^[#*0-9]$/.test(m[0])) continue;
        if (m.index > last) frag.append(s.slice(last, m.index));
        frag.append(emojiImg(m[0])); last = m.index + m[0].length;
      }
      if (last < s.length) frag.append(s.slice(last));
      tn.replaceWith(frag);
    });
    return node;
  }
  function onlyEmoji(s) {
    if (!EMOJI_RE) return 0;
    var t = String(s || '').replace(/\s+/g, ''); if (!t) return 0;
    var m = t.match(EMOJI_RE); if (!m || m.join('') !== t) return 0;
    return m.length <= 3 ? m.length : 0;
  }
  /** The team's formatting (**bold**, __italic__, ~~strike~~, `code`, ||spoiler||, [text](link)) and bare links, as nodes. */
  function richText(t) {
    var p = h('p', { class: 'b-text', dir: 'auto' }), re = /\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|`([^`\n]+)`|\|\|([\s\S]+?)\|\||\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>"']+)/g, last = 0, m;
    while ((m = re.exec(t))) {
      if (m.index > last) p.append(t.slice(last, m.index));
      if (m[1]) p.append(h('strong', { text: m[1] })); else if (m[2]) p.append(h('em', { text: m[2] })); else if (m[3]) p.append(h('del', { text: m[3] }));
      else if (m[4]) p.append(h('code', { text: m[4] })); else if (m[5]) p.append(h('span', { class: 'cp-spoiler', text: m[5], onclick: function (e) { e.stopPropagation(); this.classList.add('open'); } }));
      else if (m[8]) { var u = m[8].replace(/[.,،)!؟?]+$/, ''); p.append(h('a', { href: u, target: '_blank', rel: 'noopener', dir: 'ltr', text: u })); if (u.length < m[8].length) p.append(m[8].slice(u.length)); }
      else if (/^https?:\/\//.test(m[7])) p.append(h('a', { href: m[7], target: '_blank', rel: 'noopener', text: m[6] })); else p.append(m[6].replace(/^#/, ''));
      last = m.index + m[0].length;
    }
    if (last < t.length) p.append(t.slice(last));
    var n = onlyEmoji(t); if (n) p.classList.add('b-jumbo', 'j' + n);
    return emojify(p);
  }

  /* ------------------------------------------------------------ rows */
  function place(m) {
    msgs[m.id] = m;
    if (typeof m.id === 'number') lastId = Math.max(lastId, m.id);
    var e = box.querySelector('.cp-empty'); if (e) e.remove();
    // Photos sent together share one row, while they arrive next to each other.
    var k = kindOf(m), prev = box.lastElementChild;
    if (m.album && (k === 'photo' || k === 'video') && prev && prev._album === m.album + (m.team ? m.author : 'c')) {
      var ids = prev._ids.concat([m.id]), r2 = row(ids.map(function (i) { return msgs[i]; }));
      prev.replaceWith(r2); ids.forEach(function (i) { rowsById[i] = r2; });
      return;
    }
    var r = row([m]);
    if (m.album) r._album = m.album + (m.team ? m.author : 'c');
    box.append(r); rowsById[m.id] = r;
  }
  function update(m) {
    msgs[m.id] = Object.assign(msgs[m.id] || {}, m);
    var old = rowsById[m.id]; if (!old) return;
    var ids = old._ids || [m.id], r = row(ids.map(function (i) { return msgs[i]; }).filter(Boolean));
    r.className = old.className.replace(/\bb-new\b/, ''); r._album = old._album;
    old.replaceWith(r); ids.forEach(function (i) { rowsById[i] = r; });
    decorate();
  }
  function removeRow(id) {
    var r = rowsById[id]; if (!r) return;
    delete rowsById[id]; delete msgs[id];
    var rest = (r._ids || []).filter(function (i) { return i !== id && msgs[i]; });
    if (rest.length) { var r2 = row(rest.map(function (i) { return msgs[i]; })); r2._album = r._album; r.replaceWith(r2); rest.forEach(function (i) { rowsById[i] = r2; }); decorate(); return; }
    r.style.transition = 'opacity .2s, transform .2s'; r.style.opacity = '0'; r.style.transform = 'scale(.96)';
    setTimeout(function () { r.remove(); decorate(); }, 200);
  }
  /** Day chips, and who starts / ends a run (tails, names). */
  function decorate() {
    Array.prototype.forEach.call(box.querySelectorAll('.day-sep'), function (n) { n.remove(); });
    var prevDay = '', prev = null, t = o.today();
    Array.prototype.forEach.call(box.querySelectorAll('.msg-row, .sys-msg'), function (r) {
      var day = r.dataset.day || '';
      if (day && day !== prevDay) { box.insertBefore(h('div', { class: 'day-sep' }, [h('span', { text: day === t ? 'امروز' : o.jal(day) })]), r); prevDay = day; prev = null; }
      if (!r.classList.contains('msg-row')) { prev = null; return; }
      var same = prev && prev.dataset.who === r.dataset.who && (+r.dataset.t - +prev.dataset.t) < 600;
      r.classList.toggle('g-first', !same);
      if (prev) prev.classList.toggle('g-last', !same);
      prev = r;
    });
    if (prev) prev.classList.add('g-last');
  }
  function row(list) {
    var m = list[0], last = list[list.length - 1];
    if (m.kind === 'system') { var s = o.sysCard(m); s.dataset.id = m.id; s.dataset.day = String(m.created_at).slice(0, 10); s._ids = [m.id]; return s; }
    // The team writes on the left, the client on the right (like their own phone).
    var mine = !m.team;
    var r = h('div', { class: 'msg-row in-group ' + (mine ? 'me' : 'other') + (m.pending ? ' b-pending' : '') + (m.failed ? ' b-failed' : ''), 'data-id': m.id, 'data-who': m.team ? 't' + m.author : 'c' + (m.mine ? 'me' : m.author), 'data-t': ts(m), 'data-day': String(m.created_at).slice(0, 10) });
    r._ids = list.map(function (x) { return x.id; });
    if (!mine) r.append(h('span', { class: 'msg-av' }, [m.avatar ? h('img', { class: 'avatar sm', src: m.avatar, alt: '' }) : h('span', { class: 'avatar sm cp-av', text: String(m.author || '؟').trim().slice(0, 1) })]));
    var b = h('div', { class: 'bubble' });
    r.append(b);
    b.append(h('span', { class: 'b-author', text: m.team ? m.author + ' · ' + o.team() : m.author }));
    if (m.reply) b.append(quote(m.reply));
    var x = m.x || {}, k = kindOf(m), caps = list.map(function (y) { return y.body; }).filter(Boolean), caption = caps[0] || '';
    if (!m.reply && x.quote) b.append(h('p', { class: 'cp-quote', text: '«' + x.quote + '»' }));
    if (k === 'sticker') { b.append(h('img', { class: 'b-stk', src: m.file.url, alt: '' })); b.classList.add('b-sticker', 'media-only'); }
    else if (k === 'round') { b.append(h('video', { class: 'b-round', src: m.file.url, playsinline: '', preload: 'metadata', controls: '' })); b.classList.add('b-sticker', 'media-only'); }
    else if (k === 'poll') {
      var tot = x.poll.counts.reduce(function (p, q) { return p + q; }, 0);
      b.append(h('div', { class: 'cp-poll' }, [h('b', { text: '📊 ' + x.poll.q })].concat(x.poll.o.map(function (op, i) { var pct = tot ? Math.round(x.poll.counts[i] / tot * 100) : 0; return h('div', { class: 'cp-poll-o' }, [h('span', { text: op }), h('small', { text: fa(pct) + '٪' }), h('i', { style: 'width:' + pct + '%' })]); }))));
    } else if (k === 'loc') b.append(h('a', { class: 'b-file', href: 'https://www.google.com/maps?q=' + x.loc.lat + ',' + x.loc.lng, target: '_blank', rel: 'noopener' }, [h('span', { class: 'bf-ico', text: '📍' }), h('span', { class: 'bf-copy' }, [h('strong', { text: x.loc.label || 'موقعیت مکانی' }), h('small', { text: 'دیدن روی نقشه' })])]));
    else if (k === 'contact') b.append(h('a', { class: 'b-file', href: 'tel:' + x.contact.phone }, [h('span', { class: 'bf-ico', text: '👤' }), h('span', { class: 'bf-copy' }, [h('strong', { text: x.contact.name }), h('small', { text: fa(x.contact.phone) })])]));
    else if (k === 'card') b.append(h('p', { class: 'cp-card', text: (x.card.t === 'task' ? '✅ ' : '📁 ') + x.card.title }));
    else if (list.length > 1 || k === 'photo' || k === 'video') { b.append(album(list)); b.classList.add('has-album'); if (!caption) b.classList.add('media-only'); }
    else if (k === 'voice') b.append(voice(m));
    else if (k === 'file') b.append(fileCard(m));
    if (caption) b.append(richText(caption));
    var reacts = reactionsOf(last); if (reacts) b.append(reacts);
    var meta = h('span', { class: 'b-meta' }, [last.edited ? h('em', { class: 'b-edited', text: 'ویرایش‌شده' }) : null, h('time', { text: hm(last.created_at) })]);
    if (mine && m.mine) meta.append(ticks(last));
    b.append(meta);
    if (meta.previousElementSibling && meta.previousElementSibling.classList.contains('b-text')) b.classList.add('meta-in');
    if (last.edited) b.classList.add('edited');
    if (m.pending) { var bar = h('div', { class: 'upload-progress b-progress' }, [h('i')]); b.append(bar); r._bar = bar; }
    if (m.failed) b.append(h('button', { type: 'button', class: 'b-retry', html: icon('repeat') + 'ارسال نشد — تلاش دوباره', onclick: function (e) { e.stopPropagation(); m.retry(); } }));
    if (typeof m.id === 'number') wire(r, list);
    return r;
  }
  function ticks(m) {
    if (m.pending || m.failed) return h('span', { class: 'b-sending', html: icon('clock') });
    var read = teamRead >= m.id;
    return h('span', { class: 'seen' + (read ? ' on' : ''), title: read ? 'تیم خواند' : 'ارسال شد', html: icon(read ? 'checks' : 'check') });
  }
  function paintTicks() {
    Object.keys(rowsById).forEach(function (id) {
      var m = msgs[id], r = rowsById[id]; if (!m || !m.mine || typeof m.id !== 'number') return;
      var s = r.querySelector('.b-meta .seen'); if (!s) return;
      var on = teamRead >= Math.max.apply(null, r._ids); if (s.classList.contains('on') === on) return;
      s.replaceWith(ticks(msgs[r._ids[r._ids.length - 1]]));
    });
  }
  function quote(q) {
    return h('button', { type: 'button', class: 'b-quote', onclick: function (e) { e.stopPropagation(); jumpTo(q.id); } }, [
      q.kind === 'photo' ? h('span', { class: 'bq-ico', html: icon('image') }) : q.kind === 'voice' ? h('span', { class: 'bq-ico', html: icon('mic') }) : null,
      h('span', { class: 'bq-copy' }, [h('b', { text: q.author }), emojify(h('small', { text: q.text || '…' }))])]);
  }
  function jumpTo(id) {
    var r = rowsById[id]; if (!r) { o.toast('این پیام قدیمی‌تر است'); return; }
    r.scrollIntoView({ block: 'center', behavior: 'smooth' });
    r.classList.remove('flash'); void r.offsetWidth; r.classList.add('flash');
  }
  function photos() {
    return Array.prototype.slice.call(box.querySelectorAll('.b-ph:not(.is-vid)')).map(function (c) { return { url: c.dataset.url, mid: c.dataset.mid, thumb: c.dataset.thumb, name: c.dataset.name }; });
  }
  function album(list) {
    var n = list.length, grid = h('div', { class: 'b-album n' + Math.min(n, 6) });
    list.forEach(function (x, i) {
      var f = x.file, vid = kindOf(x) === 'video';
      var cell = h('button', { type: 'button', class: 'b-ph' + (vid ? ' is-vid' : ''), 'aria-label': vid ? 'پخش ویدیو' : 'دیدن عکس', 'data-url': f.url, 'data-mid': f.mid || '', 'data-thumb': f.thumb || '', 'data-name': f.name || '' });
      if (f.thumb) cell.style.backgroundImage = 'url(' + f.thumb + ')';
      if (vid) cell.append(h('video', { src: f.url + '#t=0.5', muted: '', preload: 'metadata', playsinline: '' }), h('span', { class: 'bv-play', html: icon('play') }));
      else cell.append(h('img', { src: f.mid || f.url, alt: f.name || '', loading: 'lazy', decoding: 'async', onload: function () { cell.classList.add('ld'); } }));
      if (f.w && f.h && n === 1) cell.style.aspectRatio = Math.max(.6, Math.min(1.9, f.w / f.h));
      if (n >= 6 && i >= n - n % 3) { cell.style.gridColumn = 'span ' + 6 / (n % 3); cell.style.aspectRatio = n % 3 === 1 ? '2 / 1' : '3 / 2'; }
      cell.onclick = function (e) {
        e.stopPropagation();
        if (x.pending) return;
        if (vid) { playVideo(f); return; }
        if (!window.MPViewer) { window.open(f.url, '_blank'); return; }
        var all = photos(); MPViewer.open(all, Math.max(0, all.map(function (p) { return p.url; }).indexOf(f.url)));
      };
      grid.append(cell);
    });
    return grid;
  }
  function playVideo(f) {
    var v = h('video', { src: f.url, controls: '', autoplay: '', playsinline: '', class: 'cp-vplay' });
    var shade = h('div', { class: 'cp-vshade', onclick: function (e) { if (e.target === shade) shade.remove(); } }, [v, h('button', { type: 'button', class: 'cp-vclose', 'aria-label': 'بستن', html: icon('close'), onclick: function () { shade.remove(); } })]);
    document.body.append(shade);
  }
  function fileCard(m) {
    var f = m.file, ext = (f.name.split('.').pop() || '').slice(0, 4).toUpperCase();
    return h('a', { class: 'b-file', href: f.url + (f.url.indexOf('?') >= 0 ? '&' : '?') + 'download=1', target: '_blank', rel: 'noopener', onclick: function (e) { e.stopPropagation(); if (m.pending) e.preventDefault(); } }, [
      h('span', { class: 'bf-ico' }, [h('b', { text: ext || 'FILE' })]),
      h('span', { class: 'bf-copy' }, [h('strong', { text: f.name, dir: 'auto' }), h('small', { text: size(f.size) + (m.pending ? ' · در حال ارسال' : ' · دانلود') })])]);
  }
  /* Voice: one player for the chat; the bubble shows a waveform that fills while it plays. */
  var VP = { audio: new Audio(), m: null, views: {} };
  VP.audio.addEventListener('timeupdate', vpPaint);
  VP.audio.addEventListener('ended', function () { var id = VP.m && VP.m.id; VP.m = null; vpState(); var n = Object.keys(VP.views).map(Number).filter(function (i) { return i > id && msgs[i] && kindOf(msgs[i]) === 'voice'; }).sort(function (a, b) { return a - b; })[0]; if (n) vpPlay(msgs[n]); });
  function vpPaint() {
    var v = VP.m && VP.views[VP.m.id]; if (!v) return;
    var d = isFinite(VP.audio.duration) && VP.audio.duration > 0 ? VP.audio.duration : (VP.m.x && VP.m.x.dur) || 0, p = d ? VP.audio.currentTime / d : 0;
    Array.prototype.forEach.call(v.bars.children, function (b, i, all) { b.classList.toggle('on', i / all.length < p); });
    v.dur.textContent = clock(d ? d - VP.audio.currentTime : 0);
  }
  function vpState() {
    Object.keys(VP.views).forEach(function (id) {
      var v = VP.views[id]; if (!v.btn.isConnected) { delete VP.views[id]; return; }
      var on = VP.m && String(VP.m.id) === id && !VP.audio.paused;
      v.btn.innerHTML = icon(on ? 'pause' : 'play');
      if (!VP.m || String(VP.m.id) !== id) { Array.prototype.forEach.call(v.bars.children, function (b) { b.classList.remove('on'); }); v.dur.textContent = clock(v.m.x && v.m.x.dur); }
    });
  }
  function vpPlay(m) {
    if (VP.m && VP.m.id === m.id) { if (VP.audio.paused) VP.audio.play(); else VP.audio.pause(); vpState(); return; }
    VP.m = m; VP.audio.src = m.file.url; VP.audio.play().catch(function () { o.toast('پخش این صدا در این مرورگر ممکن نشد.'); });
    vpState();
  }
  VP.audio.addEventListener('play', vpState); VP.audio.addEventListener('pause', vpState);
  function voice(m) {
    var btn = h('button', { type: 'button', class: 'v-play', 'aria-label': 'پخش پیام صوتی', html: icon('play') });
    var bars = h('div', { class: 'v-wave' }), dur = h('span', { class: 'v-dur', text: clock(m.x && m.x.dur) });
    for (var i = 0, seed = (typeof m.id === 'number' ? m.id : 7) * 9301 + 49297; i < 32; i++) { seed = (seed * 9301 + 49297) % 233280; var bi = h('i'); bi.style.height = (25 + seed / 233280 * 75) + '%'; bars.append(bi); }
    btn.onclick = function (e) { e.stopPropagation(); if (typeof m.id === 'number') vpPlay(m); };
    bars.onclick = function (e) {
      e.stopPropagation(); if (typeof m.id !== 'number') return;
      if (!VP.m || VP.m.id !== m.id) { vpPlay(m); return; }
      var rc = bars.getBoundingClientRect(), d = VP.audio.duration; if (isFinite(d) && d) { VP.audio.currentTime = (rc.right - e.clientX) / rc.width * d; vpPaint(); }
    };
    if (typeof m.id === 'number') VP.views[m.id] = { btn: btn, bars: bars, dur: dur, m: m };
    return h('div', { class: 'v-msg' }, [h('div', { class: 'v-row' }, [btn, bars, h('div', { class: 'v-side' }, [dur])])]);
  }
  function reactionsOf(m) {
    if (!m.reactions || !m.reactions.length) return null;
    return emojify(h('div', { class: 'b-reacts' }, m.reactions.map(function (x) {
      return h('button', { type: 'button', class: 'b-react' + (x.mine ? ' mine' : ''), title: (x.names || []).join('، '), onclick: function (e) { e.stopPropagation(); react(m, x.emoji); } },
        [h('span', { class: 'br-e', text: x.emoji }), x.count > 1 ? h('span', { text: fa(x.count) }) : null]);
    })));
  }

  /* ------------------------------------------------------------ gestures and the message menu */
  var openMenu = null;
  function wire(r, list) {
    var m = list[0], last = list[list.length - 1], b = r.querySelector('.bubble'), lastTap = 0, timer = 0, st = null;
    r.addEventListener('click', function (e) {
      if (e.target.closest('a, button, video, audio, .v-msg, .cp-spoiler')) return;
      var now = Date.now();
      if (now - lastTap < 320) { lastTap = 0; if (canEdit) react(last, '❤️'); } else lastTap = now;
    });
    r.addEventListener('contextmenu', function (e) { e.preventDefault(); menu(m, list, r); });
    r.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      st = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, on: false };
      if (e.pointerType !== 'mouse') timer = setTimeout(function () { timer = 0; st = null; if (navigator.vibrate) navigator.vibrate(12); menu(m, list, r); }, 450);
    });
    r.addEventListener('pointermove', function (e) {
      if (!st || e.pointerId !== st.id) return;
      var dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { clearTimeout(timer); timer = 0; }
      // Swipe toward the start of the line: reply.
      if (!st.on) { if (Math.abs(dy) > 12 || dx > 12) { st = null; return; } if (dx > -14 || e.pointerType === 'mouse') return; st.on = true; b.style.transition = 'none'; }
      st.dx = Math.max(-100, Math.min(0, dx)); b.style.transform = 'translateX(' + st.dx + 'px)';
      r.classList.toggle('rp-armed', st.dx < -64); r.classList.add('rp-reveal');
    });
    function end() {
      clearTimeout(timer); timer = 0;
      if (!st) return; var s = st; st = null; if (!s.on) return;
      b.style.transition = 'transform .25s cubic-bezier(.2,.8,.2,1)'; b.style.transform = '';
      setTimeout(function () { r.classList.remove('rp-reveal', 'rp-armed'); }, 240);
      if (s.dx < -64 && canEdit) startReply(m);
    }
    r.addEventListener('pointerup', end);
    r.addEventListener('pointercancel', function () { clearTimeout(timer); timer = 0; if (st && st.on) { b.style.transform = ''; r.classList.remove('rp-reveal', 'rp-armed'); } st = null; });
  }
  function copyText(t) {
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { o.toast('کپی شد'); }, function () {
      var ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = t; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); o.toast('کپی شد');
    });
  }
  function menu(m, list, r) {
    if (openMenu) openMenu();
    var last = list[list.length - 1], k = kindOf(m), body = list.map(function (x) { return x.body; }).filter(Boolean)[0] || '';
    var fresh = Date.now() / 1000 - ts(m) < 2 * 86400, items = [];
    if (canEdit) items.push(['reply', 'پاسخ', function () { startReply(m); }]);
    if (body) items.push(['copy', 'کپی متن', function () { copyText(body.replace(/\*\*|__|~~|\|\||`/g, '')); }]);
    if (m.mine && canEdit && fresh && k !== 'voice') items.push(['edit', 'ویرایش', function () { startEdit(list.filter(function (x) { return x.body; })[0] || m); }]);
    if (m.file && k !== 'sticker') items.push(['download', 'دانلود', function () { list.forEach(function (x) { if (x.file) window.open(x.file.url + (x.file.url.indexOf('?') >= 0 ? '&' : '?') + 'download=1', '_blank'); }); }]);
    if (m.mine && canEdit && fresh) items.push(['trash', 'حذف', function () { askDelete(list); }, true]);
    var strip = canEdit ? h('div', { class: 'ctx-reacts' }, REACTIONS.map(function (e) {
      var on = (last.reactions || []).some(function (x) { return x.mine && x.emoji === e; });
      return h('button', { type: 'button', class: on ? 'on' : '', 'aria-label': e, onclick: function () { close(); react(last, e); } }, [emojiImg(e)]);
    })) : null;
    if (!items.length && !strip) return;
    var mn = h('div', { class: 'ctx-menu msg-menu', role: 'menu' }, [strip].concat(items.map(function (it) {
      var bt = h('button', { type: 'button', role: 'menuitem', class: it[3] ? 'danger' : '', html: icon(it[0]), onclick: function () { close(); it[2](); } });
      bt.append(h('span', { text: it[1] })); return bt;
    })));
    var shade = h('div', { class: 'ctx-shade', onclick: function () { close(); } });
    r.classList.add('ctx-lifted');
    document.body.append(shade, mn);
    var rc = r.querySelector('.bubble').getBoundingClientRect(), w = mn.offsetWidth, ht = mn.offsetHeight, pad = 8;
    var left = !m.team ? rc.right - w : rc.left;
    left = Math.max(pad, Math.min(left, innerWidth - w - pad));
    var top = rc.bottom + 6 + ht > innerHeight - pad ? Math.max(pad, rc.top - ht - 6) : rc.bottom + 6;
    mn.style.left = left + 'px'; mn.style.top = top + 'px';
    requestAnimationFrame(function () { mn.classList.add('in'); });
    function key2(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    document.addEventListener('keydown', key2, true);
    setTimeout(function () { if (openMenu === close) box.addEventListener('scroll', close, { once: true }); }, 350);
    function close() {
      if (openMenu !== close) return; openMenu = null;
      document.removeEventListener('keydown', key2, true); box.removeEventListener('scroll', close);
      r.classList.remove('ctx-lifted'); shade.remove(); mn.remove();
    }
    openMenu = close;
  }
  function react(m, emoji) {
    if (typeof m.id !== 'number' || !canEdit) return;
    var rs = (m.reactions || []).map(function (x) { return Object.assign({}, x); }), had = rs.filter(function (x) { return x.mine; })[0];
    rs.forEach(function (x) { if (x.mine) { x.mine = false; x.count--; } });
    if (!had || had.emoji !== emoji) { var t = rs.filter(function (x) { return x.emoji === emoji; })[0]; if (t) { t.count++; t.mine = true; } else rs.push({ emoji: emoji, count: 1, mine: true, names: [] }); }
    update(Object.assign({}, m, { reactions: rs.filter(function (x) { return x.count > 0; }) }));
    req('/messages/' + m.id + '/react', { emoji: emoji }).then(update).catch(function (e) { update(m); o.toast(e.message); });
  }
  function askDelete(list) {
    var mine = list.filter(function (x) { return x.mine && typeof x.id === 'number'; }); if (!mine.length) return;
    if (!confirm(mine.length > 1 ? 'این ' + fa(mine.length) + ' پیام حذف شود؟' : 'این پیام حذف شود؟')) return;
    mine.forEach(function (x) { req('/messages/' + x.id, null, 'DELETE').then(function () { removeRow(x.id); }).catch(function (e) { o.toast(e.message); }); });
  }

  /* ------------------------------------------------------------ composer: reply / edit bar, emoji, typing */
  function setCtx(kind, m) {
    $('cp-cc-ico').innerHTML = icon(kind === 'edit' ? 'edit' : 'reply');
    $('cp-cc-title').textContent = kind === 'edit' ? 'ویرایش پیام' : 'پاسخ به ' + (m.mine ? 'خودتان' : m.author);
    $('cp-cc-text').textContent = snippet(m); emojify($('cp-cc-text'));
    $('cp-ctx').hidden = false; text.focus();
  }
  function clearCtx() { var was = !!editing; replyTo = null; editing = null; $('cp-ctx').hidden = true; if (was) { text.value = ''; grow(); } state(); }
  function startReply(m) { editing = null; replyTo = m; setCtx('reply', m); state(); }
  function startEdit(m) { replyTo = null; editing = m; text.value = m.body || ''; grow(); setCtx('edit', m); state(); }
  $('cp-cc-x').onclick = clearCtx;
  function grow() { text.style.height = 'auto'; text.style.height = Math.min(160, text.scrollHeight) + 'px'; }
  function state() { form.classList.toggle('has-text', !!text.value.trim() || !!editing); }
  var typingAt = 0;
  function typing(s) {
    if (!canEdit) return;
    var now = Date.now(); if (s === 'typing' && now - typingAt < 3500) return; typingAt = s === 'idle' ? 0 : now;
    req('/typing', { state: s }).catch(function () {});
  }
  text.addEventListener('input', function () { grow(); state(); typing(text.value.trim() ? 'typing' : 'idle'); });
  text.addEventListener('keydown', function (e) {
    var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !mobile) { e.preventDefault(); form.requestSubmit(); }
    if (e.key === 'Escape' && (replyTo || editing)) { e.preventDefault(); clearCtx(); }
    if (e.key === 'ArrowUp' && !text.value) {
      var mine = Object.keys(msgs).map(function (k) { return msgs[k]; }).filter(function (x) { return x.mine && typeof x.id === 'number' && x.body && kindOf(x) !== 'voice'; }).sort(function (a, b) { return b.id - a.id; })[0];
      if (mine) { e.preventDefault(); startEdit(mine); }
    }
  });
  var EMOJI = ('😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😜 🤗 🤭 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😴 😷 🤒 🤯 🥳 😎 🤓 😕 😟 🙁 😮 😲 😳 🥺 😢 😭 😱 😖 😞 😓 😩 😫 😤 😡 👋 👌 ✌️ 🤞 👍 👎 👏 🙌 🤝 🙏 💪 👀 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💯 ✅ ❌ ⭐ 🌟 ✨ 🔥 🎉 🎊 🎁 🌹 🌸 🌺 🌻 ☕ 🍰 🎂 📎 📁 📷 🖼️ 🎨 ✏️ 📝 📌 📅 ⏰ 💡 💰 📞 💬').split(' ');
  var pop = $('cp-emoji-pop');
  function recent() { try { return JSON.parse(localStorage.getItem('mp_emoji_recent') || '[]'); } catch (e) { return []; } }
  function drawEmoji() {
    var r = recent().slice(0, 16), list = r.concat(EMOJI.filter(function (e) { return r.indexOf(e) < 0; }));
    pop.replaceChildren(h('div', { class: 'ep-grid' }, list.map(function (e) { return h('button', { type: 'button', 'aria-label': e, onclick: function () { pick(e); } }, [emojiImg(e)]); })));
  }
  function pick(e) {
    var r = recent().filter(function (x) { return x !== e; }); r.unshift(e);
    try { localStorage.setItem('mp_emoji_recent', JSON.stringify(r.slice(0, 32))); } catch (er) { /* private */ }
    var a = text.selectionStart || text.value.length, b = text.selectionEnd || a;
    text.value = text.value.slice(0, a) + e + text.value.slice(b); text.setSelectionRange(a + e.length, a + e.length);
    text.dispatchEvent(new Event('input'));
  }
  $('cp-emoji').onclick = function () { if (pop.hidden) drawEmoji(); pop.hidden = !pop.hidden; };
  document.addEventListener('pointerdown', function (e) { if (!pop.hidden && !e.target.closest('#cp-emoji-pop, #cp-emoji')) pop.hidden = true; });

  /* ------------------------------------------------------------ sending */
  function pendingRow(fields) {
    var m = Object.assign({ id: 'tmp' + (++tmpN), team: false, mine: true, author: o.myName() || 'شما', created_at: stamp(), pending: true, reactions: [] }, fields);
    msgs[m.id] = m; place(m); decorate(); box.scrollTop = box.scrollHeight;
    return m;
  }
  function swap(m, real) {
    var r = rowsById[m.id]; delete msgs[m.id]; delete rowsById[m.id];
    if (rowsById[real.id]) { if (r) { var ids = (r._ids || []).filter(function (i) { return i !== m.id; }); if (ids.length) { r._ids = ids; update(msgs[ids[0]]); } else r.remove(); } update(real); return; }
    if (!r) { place(real); decorate(); return; }
    var ids2 = (r._ids || [m.id]).map(function (i) { return i === m.id ? real.id : i; });
    msgs[real.id] = real; lastId = Math.max(lastId, real.id);
    var r2 = row(ids2.map(function (i) { return msgs[i]; }).filter(Boolean)); r2._album = r._album;
    r.replaceWith(r2); ids2.forEach(function (i) { rowsById[i] = r2; });
    decorate();
  }
  function fail(m, err, again) {
    m.pending = false; m.failed = true; m.retry = function () { m.failed = false; m.pending = true; update(m); again(); };
    update(m); o.toast(err && err.message ? err.message : 'ارسال نشد');
  }
  function sendText(body) {
    var rp = replyTo; clearCtx(); text.value = ''; grow(); state(); typing('idle');
    var m = pendingRow({ body: body, reply: rp ? { id: rp.id, author: rp.author, text: snippet(rp), kind: kindOf(rp) } : null });
    function go() {
      sendQ = sendQ.then(function () { return req('', { body: body, name: o.myName(), reply_to: rp ? rp.id : 0 }); })
        .then(function (d) { if (d.message) swap(m, d.message); else { removeRow(m.id); load(true); } }, function (e) { fail(m, e, go); });
    }
    go();
  }
  /** Any file, in 1.5 MB pieces with retries, so no host upload limit applies. */
  function upload(file, onProg) {
    var SIZE = 1572864, total = Math.max(1, Math.ceil(file.size / SIZE)), id = Date.now().toString(36) + Math.random().toString(36).slice(2, 12) + 'up';
    function piece(i, tries) {
      return new Promise(function (resolve, reject) {
        var fd = new FormData();
        fd.append('file', file.slice(i * SIZE, Math.min(file.size, (i + 1) * SIZE)), 'part');
        fd.append('upload', id); fd.append('index', i); fd.append('total', total); fd.append('name', file.name || 'file');
        var x = new XMLHttpRequest();
        x.open('POST', base + '/upload'); x.withCredentials = true; x.setRequestHeader('X-MP-Client-Key', key);
        x.upload.onprogress = function (e) { if (e.lengthComputable && onProg) onProg(Math.min(1, (i * SIZE + e.loaded / e.total * Math.min(SIZE, file.size - i * SIZE)) / Math.max(1, file.size))); };
        x.onload = function () {
          var d = {}; try { d = JSON.parse(x.responseText); } catch (e) { /* not json */ }
          if (x.status >= 200 && x.status < 300) resolve(d);
          else if (x.status >= 500 && tries < 4) setTimeout(function () { piece(i, tries + 1).then(resolve, reject); }, 1500 * (tries + 1));
          else reject(new Error(d.message || 'بارگذاری فایل انجام نشد.'));
        };
        x.onerror = function () { if (tries < 6) setTimeout(function () { piece(i, tries + 1).then(resolve, reject); }, 1500 * (tries + 1)); else reject(new Error('اتصال اینترنت برقرار نیست.')); };
        x.send(fd);
      });
    }
    function from(i) { return piece(i, 0).then(function (r) { if (r && r.id) return r; var n = r && typeof r.next === 'number' ? r.next : i + 1; if (n >= total) throw new Error('بارگذاری فایل انجام نشد.'); return from(n); }); }
    return from(0);
  }
  function sendFiles(files, caption, extra) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return;
    var rp = replyTo; clearCtx();
    var media = files.filter(function (f) { return isPic(f) || isVid(f); }), album = media.length > 1 ? Date.now().toString(36) + Math.random().toString(36).slice(2, 8) : '';
    files.forEach(function (f, i) {
      var local = URL.createObjectURL(f), pic = isPic(f), vid = isVid(f);
      var m = pendingRow({
        body: i === 0 ? caption || '' : '', album: (pic || vid) ? album : '', x: extra && extra.dur ? { dur: extra.dur } : null,
        reply: i === 0 && rp ? { id: rp.id, author: rp.author, text: snippet(rp), kind: kindOf(rp) } : null,
        file: { name: f.name || 'file', size: f.size, mime: f.type || 'application/octet-stream', image: pic, url: local }
      });
      function go() {
        upload(f, function (p) { var r = rowsById[m.id], b = r && r._bar; if (b) b.firstChild.style.width = Math.round(p * 100) + '%'; })
          .then(function (up) {
            sendQ = sendQ.then(function () {
              return req('', { body: i === 0 ? caption || '' : '', name: o.myName(), file_id: up.id, reply_to: i === 0 && rp ? rp.id : 0, album: (pic || vid) ? album : '', dur: extra && extra.dur ? Math.round(extra.dur) : 0 });
            }).then(function (d) { URL.revokeObjectURL(local); if (d.message) swap(m, d.message); else load(true); }, function (e) { fail(m, e, go); });
            return sendQ;
          }, function (e) { fail(m, e, go); });
      }
      go();
    });
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!canEdit) return;
    var body = text.value.trim();
    if (editing) {
      var m = editing; if (!body && !m.file) return;
      clearCtx(); text.value = ''; grow(); state();
      if (body === m.body) return;
      update(Object.assign({}, m, { body: body, edited: true }));
      req('/messages/' + m.id, { body: body }).then(update).catch(function (err) { update(m); o.toast(err.message); });
      return;
    }
    if (!body) return;
    if (!o.isLogged()) { try { localStorage.setItem('mp-client-name', o.myName()); } catch (err) { /* private */ } }
    sendText(body);
  });
  $('cp-clip').onclick = function () { $('cp-file').click(); };
  $('cp-file').onchange = function () { var c = text.value.trim(); text.value = ''; grow(); state(); sendFiles(this.files, c); this.value = ''; };
  // Paste a screenshot, or drop files on the chat.
  text.addEventListener('paste', function (e) {
    var fs = e.clipboardData && e.clipboardData.files; if (!fs || !fs.length || !canEdit) return;
    e.preventDefault(); sendFiles(fs, '');
  });
  var card = box.closest('.cp-chat-card') || box.parentNode;
  ['dragenter', 'dragover'].forEach(function (t) { card.addEventListener(t, function (e) { if (canEdit && e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); card.classList.add('cp-drop'); } }); });
  card.addEventListener('dragleave', function (e) { if (!card.contains(e.relatedTarget)) card.classList.remove('cp-drop'); });
  card.addEventListener('drop', function (e) { card.classList.remove('cp-drop'); if (!canEdit || !e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); sendFiles(e.dataTransfer.files, ''); });

  /* ------------------------------------------------------------ voice messages: tap the mic, then send or delete */
  var rec = null;
  function pickMime() {
    if (!window.MediaRecorder) return null;
    var l = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac'];
    for (var i = 0; i < l.length; i++) if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(l[i])) return l[i];
    return '';
  }
  function recUi(on) { form.classList.toggle('recording', on); $('cp-rec-bar').hidden = !on; }
  $('cp-mic').onclick = function () {
    if (rec || !canEdit) return;
    var mime = pickMime();
    if (mime === null || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { o.toast('ضبط صدا در این مرورگر پشتیبانی نمی‌شود.'); return; }
    var me = rec = { chunks: [] };
    recUi(true); $('cp-rec-time').textContent = clock(0);
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      if (rec !== me) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      var mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      me.mr = mr; me.stream = stream; me.started = Date.now();
      mr.ondataavailable = function (e) { if (e.data && e.data.size) me.chunks.push(e.data); };
      mr.start(250); typing('recording');
      try {
        var ac = new (window.AudioContext || window.webkitAudioContext)(), an = ac.createAnalyser(), data = new Uint8Array(32), wave = $('cp-rec-wave');
        ac.createMediaStreamSource(stream).connect(an); an.fftSize = 64; me.ac = ac;
        wave.replaceChildren(); for (var i = 0; i < 18; i++) wave.append(h('i'));
        (function tick() {
          if (rec !== me || mr.state !== 'recording') return;
          an.getByteFrequencyData(data);
          Array.prototype.forEach.call(wave.children, function (b, k) { b.style.height = (15 + (data[k + 2] || 0) / 255 * 85) + '%'; });
          requestAnimationFrame(tick);
        })();
      } catch (e) { /* the meter is optional */ }
      me.timer = setInterval(function () { var s = (Date.now() - me.started) / 1000; $('cp-rec-time').textContent = clock(s); if (s >= 300) finish(true); }, 250);
    }).catch(function () { if (rec === me) { rec = null; recUi(false); } o.toast('اجازه دسترسی به میکروفون داده نشد.'); });
  };
  function finish(send) {
    var r = rec; if (!r) return; rec = null; recUi(false); typing('idle');
    clearInterval(r.timer);
    if (!r.mr) return;
    var dur = (Date.now() - r.started) / 1000;
    r.mr.onstop = function () {
      r.stream.getTracks().forEach(function (t) { t.stop(); }); if (r.ac) r.ac.close();
      if (!send) return;
      var type = (r.mr.mimeType || 'audio/webm').split(';')[0], ext = /mp4|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
      var blob = new Blob(r.chunks, { type: type });
      if (blob.size < 1500 || dur < 0.5) { o.toast('پیام صوتی خیلی کوتاه بود.'); return; }
      sendFiles([new File([blob], 'voice-' + Date.now() + '.' + ext, { type: type })], '', { dur: dur });
    };
    r.mr.stop();
  }
  $('cp-rec-send').onclick = function () { finish(true); };
  $('cp-rec-cancel').onclick = function () { finish(false); };

  /* ------------------------------------------------------------ loading */
  var down = $('cp-down');
  function nearBottom() { return box.scrollHeight - box.scrollTop - box.clientHeight < 140; }
  box.addEventListener('scroll', function () { if (down) down.hidden = nearBottom(); }, { passive: true });
  if (down) down.onclick = function () { box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); };
  function load(scroll) {
    // One request at a time; a caller during a running one waits for it and then asks again.
    if (busy) return busy.then(function () { return load(scroll); });
    busy = fetchNew(scroll).then(function () { busy = null; }, function () { busy = null; });
    return busy;
  }
  function fetchNew(scroll) {
    return req('?after=' + lastId + (since ? '&since=' + encodeURIComponent(since) : '')).then(function (d) {
      var near = nearBottom(), stale = false, added = 0;
      since = d.now || since; canEdit = d.can_edit !== false && !o.preview();
      if (first && !d.messages.length && !box.querySelector('.msg-row, .sys-msg')) box.replaceChildren(o.empty());
      d.messages.forEach(function (m) {
        if (rowsById[m.id]) { update(m); return; }
        if (m.kind === 'system' && !first && m.meta && m.meta.t !== 'join') stale = true;
        place(m); added++;
        if (!first && !scroll && rowsById[m.id]) { var r = rowsById[m.id]; r.classList.add('b-new'); setTimeout(function () { r.classList.remove('b-new'); }, 1600); }
      });
      (d.changed || []).forEach(function (m) { if (m.deleted) removeRow(m.id); else if (rowsById[m.id]) update(m); });
      (d.removed || []).forEach(removeRow);
      if (added) decorate();
      if (d.read !== teamRead) { teamRead = d.read || 0; paintTicks(); }
      o.typing(d.typing || []);
      first = false;
      if (scroll || (added && near)) box.scrollTop = box.scrollHeight;
      if (stale) o.onStale();
    }).catch(function (e) { if (e.code === 'mp_login_required') location.reload(); });
  }

  return {
    load: load,
    upload: upload,
    start: function () { if (started) return load(false); started = true; return load(true); },
    preview: function () { canEdit = false; text.disabled = true; text.placeholder = 'در حالت نمای مشتری پیام فرستاده نمی‌شود'; ['cp-clip', 'cp-mic', 'cp-emoji'].forEach(function (id) { $(id).disabled = true; }); form.querySelector('.composer-send').disabled = true; }
  };
};
