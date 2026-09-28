/* Messages: project groups, direct chats and client groups; files, read receipts, fast polling while open. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, fa = MP.fa, icon = MP.icon;
  var chatLayer = null;
  function closeChat() { finishRecording(false); stopSpeaking();
    layout.classList.remove('open'); document.body.classList.remove('chat-full');
    current = 0; stop(); renderList();
    if (chatLayer) { var l = chatLayer; chatLayer = null; MP.popLayer(l); }
  }
  var current = 0, lastId = 0, timer = null, box = $('#chat-messages'), layout = $('#chat-layout'), pending = null, lastDay = '', mineRows = {}, rowsById = {};

  MP.loadChannels = function () { return MP.api('channels').then(function (l) { S.channels = l; MP.emit('channels'); if (MP.visible('messages')) renderList(); }); };

  function channelIcon(c) {
    if (c.type === 'direct') return MP.avatar(MP.user(c.other));
    return el('span', { class: 'ci-ico' + (c.type === 'client' ? ' client' : c.type === 'group' ? ' group' : ''), html: icon(c.type === 'client' ? 'user' : c.type === 'group' ? 'chat' : 'folder') });
  }
  /*
   * Chat list: search + tabs. Tabs are «all», «private», «team groups», one per project folder
   * (e.g. افزونه‌ها، قالب‌ها), «other projects» and «clients». Project groups nobody has written in yet
   * stay hidden unless searched for or «show quiet groups» is on, so the list shows real conversations.
   */
  var listTab = 'all', listQ = '', showQuiet = false;
  try { listTab = localStorage.getItem('mp_chat_tab') || 'all'; } catch (e) { /* private mode */ }
  function folderOf(c) { var p = c.project_id ? MP.project(c.project_id) : null; return p && p.folder_id ? p.folder_id : 0; }
  function tabsFor(chs) {
    var t = [['all', 'همه']];
    if (chs.some(function (c) { return c.type === 'direct'; })) t.push(['direct', 'خصوصی']);
    if (chs.some(function (c) { return c.type === 'group'; })) t.push(['group', 'گروه‌های تیم']);
    (S.folders || []).forEach(function (f) { if (chs.some(function (c) { return c.type === 'project' && folderOf(c) === f.id; })) t.push(['f' + f.id, f.name]); });
    if (chs.some(function (c) { return c.type === 'project' && !folderOf(c); })) t.push(['project', (S.folders || []).length ? 'سایر پروژه‌ها' : 'پروژه‌ها']);
    if (chs.some(function (c) { return c.type === 'client'; })) t.push(['client', 'مشتری‌ها']);
    return t;
  }
  function inTab(c, tab) {
    if (tab === 'all') return true;
    if (tab.charAt(0) === 'f') return c.type === 'project' && folderOf(c) === +tab.slice(1);
    if (tab === 'project') return c.type === 'project' && !folderOf(c);
    return c.type === tab;
  }
  function renderList() {
    var list = $('#chat-list'), keepFocus = document.activeElement && document.activeElement.id === 'chat-search';
    list.replaceChildren();
    var search = el('label', { class: 'search chat-search' }, MP.iconEl('search'), el('input', { type: 'search', id: 'chat-search', placeholder: 'جستجوی گفت‌وگو…', value: listQ, 'aria-label': 'جستجوی گفت‌وگو' }));
    $('input', search).oninput = function (e) { listQ = e.target.value; renderList(); };
    var tabs = tabsFor(S.channels);
    if (!tabs.some(function (t) { return t[0] === listTab; })) listTab = 'all';
    var unreadIn = function (tab) { return S.channels.filter(function (c) { return inTab(c, tab) && c.unread; }).length; };
    var bar = el('div', { class: 'chat-tabs', role: 'tablist' }, tabs.map(function (t) {
      var n = unreadIn(t[0]);
      return el('button', { type: 'button', role: 'tab', 'aria-selected': String(t[0] === listTab), onclick: function () { listTab = t[0]; try { localStorage.setItem('mp_chat_tab', listTab); } catch (e) { /* private mode */ } renderList(); } },
        t[1], n && t[0] !== 'all' ? el('i', { text: fa(n) }) : null);
    }));
    list.append(search, bar);
    var q = MP.norm(listQ);
    var all = S.channels.filter(function (c) { return inTab(c, listTab) && (!q || MP.norm(c.title + ' ' + (c.client_name || '')).indexOf(q) >= 0); });
    var quiet = all.filter(function (c) { return c.type === 'project' && !c.last && c.id !== current; });
    var items = (q || showQuiet) ? all : all.filter(function (c) { return quiet.indexOf(c) < 0; });
    items.sort(function (a, b) { return (b.unread ? 1 : 0) - (a.unread ? 1 : 0) || (b.last ? b.last.id : 0) - (a.last ? a.last.id : 0); });
    items.forEach(function (c) {
      list.append(el('button', { type: 'button', class: 'chat-item' + (c.id === current ? ' active' : ''), onclick: function () { select(c.id); } },
        channelIcon(c),
        el('span', { class: 'ci-copy' }, el('strong', { text: c.title }), preview(c)),
        c.unread ? el('span', { class: 'badge', text: fa(c.unread) }) : null));
    });
    if (!items.length) list.append(MP.empty(q ? 'search' : 'chat', q ? 'چیزی پیدا نشد' : 'گفت‌وگویی نیست', q ? null : 'با «پیام جدید» گفت‌وگو را شروع کنید.', q ? null : { text: 'پیام جدید', onclick: newDirect }, true));
    if (quiet.length && !q) list.append(el('button', { type: 'button', class: 'chat-archive-link', html: icon(showQuiet ? 'eye' : 'folder') + (showQuiet ? 'پنهان کردن گروه‌های بی‌پیام' : fa(quiet.length) + ' گروه پروژه بدون پیام'), onclick: function () { showQuiet = !showQuiet; renderList(); } }));
    list.append(el('button', { type: 'button', class: 'chat-archive-link', html: icon('folder') + 'گروه‌های آرشیو‌شده', onclick: archivedGroups }));
    if (keepFocus) { var i = $('#chat-search'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  /** Chat list preview: last message text, or an icon + label for voice / file / deleted. */
  function preview(c) {
    if (!c.last) return el('small', { text: c.type === 'client' ? 'مشتری: ' + c.client_name : 'هنوز پیامی نیست' });
    if (c.last.archived && !c.last.body && !c.last.file) return el('small', { class: 'ci-kind' }, MP.iconEl('ban'), 'پیام آرشیو شد');
    var who = c.last.mine ? 'شما: ' : '', l = c.last;
    if (!l.deleted && l.body) return el('small', { text: who + l.body });
    var kind = l.deleted ? ['ban', 'پیام آرشیو شد'] : l.file && /^audio\//.test(l.file.mime) ? ['mic', 'پیام صوتی'] : ['clip', 'فایل'];
    return el('small', { class: 'ci-kind' }, who, MP.iconEl(kind[0]), kind[1]);
  }
  function select(id) {
    var c = S.channels.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    current = id; lastId = 0; lastDay = ''; mineRows = {}; rowsById = {}; showActivity([]);
    layout.classList.add('open');
    if (MP.isMobile()) {
      document.body.classList.add('chat-full');
      if (!chatLayer) chatLayer = MP.pushLayer(function () { chatLayer = null; closeChat(); });
    }
    box.replaceChildren(MP.skeleton(3));
    $('#chat-title').textContent = c.title;
    $('#chat-sub').textContent = c.type === 'project' || c.type === 'group' ? fa(c.members) + ' عضو' : c.type === 'direct' ? (MP.user(c.other).title || 'گفت‌وگوی خصوصی') : 'گروه مشتری · ' + c.client_name;
    var tools = $('#chat-tools'); tools.replaceChildren();
    if (c.type === 'client') {
      tools.append(el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'لینک مشتری', onclick: function () { shareLink(c); } }));
    }
    if (c.type === 'group' && c.can_manage) tools.append(el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('user') + 'اعضا', onclick: function () { groupForm(c); } }));
    if (c.can_delete) tools.append(el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'آرشیو گروه', title: 'آرشیو گروه', html: icon('folder'), onclick: function () { deleteClient(c); } }));
    if (c.type === 'direct') tools.append(el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'پروفایل', html: icon('user'), onclick: function () { MP.openProfile(c.other); } }));
    $('#composer').hidden = false;
    c.unread = 0; renderList();
    fetchNew(true).then(function () { if (!MP.isMobile()) $('#composer-text').focus(); });
    stop(); timer = setInterval(function () { if (!document.hidden) fetchNew(false); }, 3000);
  }
  function bubble(m, fresh) {
    var day = m.created_at.slice(0, 10);
    var out = [];
    if (day !== lastDay) { lastDay = day; out.push(el('div', { class: 'day-sep', text: day === S.today ? 'امروز' : J.formatLong(day) })); }
    var content = el('div', { class: 'bubble' + (m.deleted ? ' b-deleted' : '') + (m.archived ? ' b-archived' : '') });
    if (m.archived) content.append(el('span', { class: 'b-arch', html: icon('folder') + 'آرشیو شده (فقط ناظر می‌بیند)' }));
    if (!m.mine) content.append(el('span', { class: 'b-author', text: m.author }));
    if (m.deleted) {
      content.append(el('p', { class: 'b-del' }, MP.iconEl('ban'), m.mine ? 'این پیام را آرشیو کردید' : 'این پیام آرشیو شد'), el('span', { class: 'b-meta', text: MP.timeFa(m.created_at.slice(11, 16)) }));
      var drow = el('div', { class: 'bubble-row ' + (m.mine ? 'me' : 'other') }, m.mine ? null : MP.avatar({ name: m.author, avatar: m.avatar }, 'sm'), content);
      drow.classList.add('gone'); rowsById[m.id] = drow; out.push(drow); return out;
    }
    var voice = m.file && /^audio\//.test(m.file.mime);
    if (voice) content.append(voiceBubble(m));
    else if (m.file) content.append(m.file.image ? el('img', { class: 'b-img', src: m.file.url, alt: m.file.name, loading: 'lazy', onclick: function () { MP.lightbox(m.file); } }) : MP.fileChip(m.file));
    if (m.body) content.append(el('p', { text: m.body }));
    var meta = el('span', { class: 'b-meta' }, MP.timeFa(m.created_at.slice(11, 16)));
    if (m.body && !voice) meta.prepend(el('button', { type: 'button', class: 'b-speak', 'aria-label': 'خواندن پیام با صدا', title: 'خواندن با صدا', html: SPEAKER, onclick: function (e) { speak(m, e.currentTarget); } }));
    if (m.pending) meta.append(el('span', { class: 'b-sending', html: icon('clock') }));
    else if (m.mine) { var seen = el('span', { class: 'seen', title: '' }); meta.append(seen); mineRows[m.id] = seen; setSeen(seen, m.seen_by); }
    content.append(meta);
    var row = el('div', { class: 'bubble-row ' + (m.mine ? 'me' : 'other') + (fresh ? ' b-new' : '') }, m.mine ? null : MP.avatar({ name: m.author, avatar: m.avatar }, 'sm'), content);
    if (fresh) setTimeout(function () { row.classList.remove('b-new'); }, 1600);
    rowsById[m.id] = row; row.dataset.time = MP.timeFa(m.created_at.slice(11, 16));
    if (m.pending) { row.classList.add('b-pending'); out.push(row); return out; }
    if (m.mine && !m.archived) { swipeToDelete(row, m); row.addEventListener('contextmenu', function (e) { e.preventDefault(); askDelete(m); }); }
    out.push(row);
    return out;
  }
  /* ------------------------------------------------------------ Delete (swipe left on your own message) */

  function markDeleted(id) {
    var row = rowsById[id]; if (!row || row.classList.contains('gone')) return;
    var mine = row.classList.contains('me');
    var b = $('.bubble', row);
    row.classList.add('gone');
    b.className = 'bubble b-deleted';
    b.replaceChildren(el('p', { class: 'b-del' }, MP.iconEl('ban'), mine ? 'این پیام را آرشیو کردید' : 'این پیام آرشیو شد'), el('span', { class: 'b-meta', text: row.dataset.time || '' }));
  }
  function askDelete(m) {
    MP.confirm('آرشیو پیام', 'این پیام از گفت‌وگو برداشته و آرشیو می‌شود (پاک نمی‌شود و ناظر همچنان آن را می‌بیند).', 'آرشیو').then(function (ok) {
      if (!ok) return;
      MP.api('messages/' + m.id, { method: 'DELETE' }).then(function () { if (S.manager) { lastId = 0; lastDay = ''; fetchNew(false); } else markDeleted(m.id); MP.loadChannels(); MP.toast('پیام آرشیو شد'); }).catch(MP.soft);
    });
  }
  function swipeToDelete(row, m) {
    var st = null, LIMIT = 80;
    row.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse' && !row.classList.contains('gone')) st = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, on: false }; });
    row.addEventListener('pointermove', function (e) {
      if (!st || e.pointerId !== st.id) return;
      var dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.on) {
        if (Math.abs(dy) > 12 || dx > 12) { st = null; return; }
        if (dx > -14) return;
        st.on = true; try { row.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ } row.style.transition = 'none';
      }
      st.dx = Math.min(0, dx);
      var d = Math.max(st.dx, -LIMIT - (Math.abs(st.dx) - LIMIT) * 0.2 * (Math.abs(st.dx) > LIMIT));
      row.style.transform = 'translateX(' + d + 'px)';
      var armed = st.dx < -LIMIT;
      if (armed && !row.classList.contains('del-armed')) MP.haptic && MP.haptic(12);
      row.classList.toggle('del-armed', armed); row.classList.add('del-reveal');
    });
    function end(e) {
      if (!st || e.pointerId !== st.id) return;
      var s = st; st = null; if (!s.on) return;
      row.style.transition = 'transform .25s cubic-bezier(.2,.8,.2,1)'; row.style.transform = '';
      setTimeout(function () { row.classList.remove('del-reveal', 'del-armed'); }, 240);
      if (s.dx < -LIMIT) askDelete(m);
    }
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', function () { if (st && st.on) { row.style.transform = ''; row.classList.remove('del-reveal', 'del-armed'); } st = null; });
  }

  /* ------------------------------------------------------------ Typing / recording indicator */

  var actEl = $('#chat-activity'), lastSent = { state: '', at: 0 };
  function showActivity(list) {
    list = list || [];
    var rec = list.filter(function (a) { return a.state === 'recording'; }), typ = list.filter(function (a) { return a.state === 'typing'; });
    var pick = rec.length ? rec : typ;
    if (!pick.length) { actEl.hidden = true; $('#chat-sub').hidden = false; return; }
    var c = S.channels.filter(function (x) { return x.id === current; })[0], direct = c && c.type === 'direct';
    var who = direct ? '' : pick.map(function (a) { return a.name.split(' ')[0]; }).slice(0, 2).join(' و ') + (pick.length > 2 ? ' و …' : '') + ' ';
    actEl.className = 'chat-activity ' + (rec.length ? 'is-rec' : 'is-typing');
    actEl.replaceChildren(el('i', { class: 'act-ico', html: rec.length ? icon('mic') : '' }), el('span', { text: who + (rec.length ? 'در حال ضبط ویس' : 'در حال نوشتن') }), el('span', { class: 'act-dots' }, el('b'), el('b'), el('b')));
    actEl.hidden = false; $('#chat-sub').hidden = true;
  }
  function sendActivity(state) {
    if (!current) return;
    var now = Date.now();
    if (state === lastSent.state && now - lastSent.at < 3000) return; // repeat at most every 3s
    if (state === 'idle' && !lastSent.state) return;
    lastSent = { state: state === 'idle' ? '' : state, at: now };
    MP.api('channels/' + current + '/activity', { method: 'POST', body: { state: state } }).catch(function () {});
  }
  MP.chatActivity = sendActivity;

  function setSeen(node, n) {
    node.innerHTML = icon(n ? 'checks' : 'check');
    node.title = n ? 'دیده شد' + (n > 1 ? ' توسط ' + fa(n) + ' نفر' : '') : 'ارسال شد';
  }
  function fetchNew(scroll) {
    if (!current) return Promise.resolve();
    var id = current;
    return MP.api('channels/' + id + '/messages', { query: { after: lastId } }).then(function (d) {
      if (id !== current) return;
      if (!lastId) box.replaceChildren();
      var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
      var fresh = !!lastId; // first load of a chat isn't animated, later arrivals are
      d.messages.forEach(function (m) { lastId = Math.max(lastId, m.id); bubble(m, fresh).forEach(function (n) { box.append(n); }); });
      if (fresh && d.messages.some(function (m) { return !m.mine; })) MP.haptic && MP.haptic(8);
      Object.keys(d.seen || {}).forEach(function (mid) { if (mineRows[mid]) setSeen(mineRows[mid], d.seen[mid]); });
      if (!S.manager) (d.deleted || []).forEach(markDeleted);
      showActivity(d.activity);
      if (!box.children.length) box.append(MP.empty('chat', 'اولین پیام را بفرستید', 'پیام‌ها برای همه اعضای گفت‌وگو نمایش داده می‌شود.', null, true));
      else { var e = $('.empty', box); if (e) e.remove(); }
      if (scroll || (d.messages.length && nearBottom)) box.scrollTop = box.scrollHeight;
      if (d.messages.length) { MP.refreshCounts(); if (!scroll) MP.loadChannels(); }
    }).catch(function () {});
  }
  function stop() { clearInterval(timer); timer = null; }

  /* ------------------------------------------------------------ Voice messages */

  var SPEAKER = icon('speaker');
  function clock(sec) { sec = isFinite(sec) ? Math.max(0, Math.round(sec || 0)) : 0; return J.faDigits(Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2)); }
  var playing = null;
  function voiceBubble(m) {
    var audio = new Audio(); audio.preload = 'metadata'; audio.src = m.file.url;
    var btn = el('button', { type: 'button', class: 'v-play', 'aria-label': 'پخش پیام صوتی', html: icon('play') });
    var bars = el('div', { class: 'v-wave' }), dur = el('span', { class: 'v-dur', text: '۰:۰۰' });
    // A stable pseudo-waveform from the message id, so every voice looks distinct but never changes.
    for (var i = 0, seed = m.id * 9301 + 49297; i < 28; i++) { seed = (seed * 9301 + 49297) % 233280; bars.append(el('i', { style: { height: (25 + seed / 233280 * 75) + '%' } })); }
    function paint() {
      var p = audio.duration ? audio.currentTime / audio.duration : 0, n = Math.round(p * bars.children.length);
      Array.prototype.forEach.call(bars.children, function (b, k) { b.classList.toggle('on', k < n); });
      dur.textContent = clock(probing ? 0 : audio.paused && !audio.currentTime ? audio.duration : audio.currentTime);
    }
    // WebM from MediaRecorder has no duration in its header: seeking far forces the browser to find it.
    var probing = false;
    audio.addEventListener('loadedmetadata', function () {
      if (audio.duration === Infinity) { probing = true; audio.currentTime = 1e7; }
      paint();
    });
    audio.addEventListener('durationchange', function () {
      if (probing && isFinite(audio.duration)) { probing = false; audio.currentTime = 0; }
      paint();
    });
    audio.addEventListener('timeupdate', paint);
    audio.addEventListener('play', function () { btn.innerHTML = icon('pause'); btn.classList.add('on'); });
    audio.addEventListener('pause', function () { btn.innerHTML = icon('play'); btn.classList.remove('on'); });
    audio.addEventListener('ended', function () { audio.currentTime = 0; paint(); });
    btn.onclick = function () {
      if (playing && playing !== audio) playing.pause();
      playing = audio;
      if (audio.paused) audio.play().catch(function () { MP.toast('پخش این صدا در این مرورگر ممکن نشد.', { error: true }); }); else audio.pause();
    };
    bars.onclick = function (e) { var r = bars.getBoundingClientRect(); if (audio.duration && isFinite(audio.duration)) { audio.currentTime = (r.right - e.clientX) / r.width * audio.duration; paint(); } };
    var textBox = el('div', { class: 'v-text', hidden: true });
    var toText = el('button', { type: 'button', class: 'v-totext', text: 'متن' });
    toText.onclick = function () {
      if (!textBox.hidden) { textBox.hidden = true; toText.classList.remove('on'); return; }
      function show(t) { textBox.textContent = t; textBox.hidden = false; toText.classList.add('on'); }
      if (m.transcript) { show(m.transcript); return; }
      toText.disabled = true; toText.textContent = '…';
      MP.api('messages/' + m.id + '/transcribe', { method: 'POST' })
        .then(function (d) { m.transcript = d.transcript; show(d.transcript); })
        .catch(MP.soft).then(function () { toText.disabled = false; toText.textContent = 'متن'; });
    };
    return el('div', { class: 'v-msg' }, el('div', { class: 'v-row' }, btn, bars, el('div', { class: 'v-side' }, dur, toText)), textBox);
  }

  // Text to speech: the device's Persian voice when it has one, else the server's service.
  var faVoice = null;
  function pickVoice() { var v = window.speechSynthesis ? speechSynthesis.getVoices() : []; faVoice = v.filter(function (x) { return /^fa/i.test(x.lang); })[0] || null; }
  if (window.speechSynthesis) { pickVoice(); speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', pickVoice); }
  var speakingBtn = null, ttsAudio = null;
  function stopSpeaking() {
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
    if (speakingBtn) speakingBtn.classList.remove('on');
    speakingBtn = null;
  }
  function speak(m, btn) {
    if (speakingBtn === btn) { stopSpeaking(); return; }
    stopSpeaking(); speakingBtn = btn; btn.classList.add('on');
    if (faVoice) {
      var u = new SpeechSynthesisUtterance(m.body); u.voice = faVoice; u.lang = faVoice.lang; u.rate = 1;
      u.onend = u.onerror = function () { if (speakingBtn === btn) stopSpeaking(); };
      speechSynthesis.speak(u); return;
    }
    if (!S.boot.channels.speech) { stopSpeaking(); MP.toast('این دستگاه صدای فارسی ندارد. مدیر سایت می‌تواند «سرویس تبدیل گفتار» را در تنظیمات پنل فعال کند.', { duration: 6000 }); return; }
    MP.api('messages/' + m.id + '/speech', { method: 'POST' }).then(function (d) {
      if (speakingBtn !== btn) return;
      ttsAudio = new Audio(d.audio); ttsAudio.onended = function () { if (speakingBtn === btn) stopSpeaking(); };
      return ttsAudio.play();
    }).catch(function (err) { stopSpeaking(); MP.soft(err); });
  }

  // Recorder: MediaRecorder (webm/opus or mp4/aac on iPhone); desktop Chrome also captures the text live.
  var rec = null;
  function pickMime() {
    if (!window.MediaRecorder) return null;
    var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac'];
    for (var i = 0; i < list.length; i++) if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(list[i])) return list[i];
    return '';
  }
  function startRecording() {
    if (!current || rec) return;
    var mime = pickMime();
    if (mime === null || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { MP.toast('ضبط صدا در این مرورگر پشتیبانی نمی‌شود.', { error: true }); return; }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      var mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks = [], started = Date.now();
      rec = { mr: mr, stream: stream, chunks: chunks, cancelled: false, transcript: '', stopListen: null };
      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mr.start(250);
      $('#composer').classList.add('recording'); $('#rec-bar').hidden = false; $('#rec-live').textContent = '';
      MP.haptic && MP.haptic(15);
      // Level meter from the live stream.
      try {
        var ac = new (window.AudioContext || window.webkitAudioContext)(), an = ac.createAnalyser(), data = new Uint8Array(32);
        ac.createMediaStreamSource(stream).connect(an); an.fftSize = 64; rec.ac = ac;
        var wave = $('#rec-wave'); wave.replaceChildren(); for (var i = 0; i < 18; i++) wave.append(el('i'));
        (function tick() {
          if (!rec || rec.mr !== mr) return;
          an.getByteFrequencyData(data);
          Array.prototype.forEach.call(wave.children, function (b, k) { b.style.height = (15 + (data[k + 2] || 0) / 255 * 85) + '%'; });
          requestAnimationFrame(tick);
        })();
      } catch (e) { /* meter is optional */ }
      sendActivity('recording');
      rec.timer = setInterval(function () {
        var s = (Date.now() - started) / 1000; $('#rec-time').textContent = clock(s); sendActivity('recording');
        if (s >= 300) finishRecording(true); // 5-minute cap
      }, 250);
      // Live text only where recognition and recording can share the mic (desktop).
      var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (MP.speechSupported && !mobile) {
        rec.stopListen = MP.listen({ continuous: true, onText: function (t) { rec && (rec.transcript = t); $('#rec-live').textContent = t; }, onError: function () {}, onEnd: function (t) { if (rec && t) rec.transcript = t; } });
      }
    }).catch(function () { MP.toast('اجازه دسترسی به میکروفون داده نشد.', { error: true }); });
  }
  function finishRecording(send) {
    if (!rec) return;
    var r = rec; rec = null;
    clearInterval(r.timer); sendActivity('idle');
    if (r.stopListen) r.stopListen();
    $('#composer').classList.remove('recording'); $('#rec-bar').hidden = true;
    r.mr.onstop = function () {
      r.stream.getTracks().forEach(function (t) { t.stop(); });
      if (r.ac) r.ac.close();
      if (!send) return;
      var type = (r.mr.mimeType || 'audio/webm').split(';')[0], ext = /mp4|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
      var blob = new Blob(r.chunks, { type: type });
      if (blob.size < 1500) { MP.toast('پیام صوتی خیلی کوتاه بود.'); return; }
      var file = new File([blob], 'voice-' + Date.now() + '.' + ext, { type: type });
      // Shown at once; uploading happens behind the bubble. Give live recognition a moment for its last words.
      sendNow({ file: file, transcript: function () { return r.transcript || ''; } });
    };
    r.mr.stop();
    MP.haptic && MP.haptic(10);
  }
  $('#composer-mic').onclick = startRecording;
  $('#rec-send').onclick = function () { finishRecording(true); };
  $('#rec-cancel').onclick = function () { finishRecording(false); MP.toast('ضبط لغو شد'); };

  var text = $('#composer-text');
  if (MP.isMobile()) text.placeholder = 'پیام…';
  text.addEventListener('input', function () { sendActivity(text.value.trim() ? 'typing' : 'idle'); text.style.height = 'auto'; text.style.height = Math.min(160, text.scrollHeight) + 'px'; });
  text.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } });
  $('#composer-file').multiple = true;
  $('#composer-file').onchange = function (e) {
    var files = Array.prototype.slice.call(e.target.files || []); e.target.value = '';
    sendFiles(files);
  };
  function sendFiles(files) {
    if (!current || !files.length) return;
    files.forEach(function (f) { sendNow({ file: f }); });
    text.focus();
  }
  // Paste an image or file into the message box, as in Telegram.
  text.addEventListener('paste', function (e) {
    var files = Array.prototype.slice.call((e.clipboardData && e.clipboardData.files) || []);
    if (!files.length) return;
    e.preventDefault();
    sendFiles(files.map(function (f, i) { return f.name && f.name !== 'image.png' ? f : new File([f], 'paste-' + Date.now() + (i ? '-' + i : '') + '.' + ((f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')), { type: f.type }); }));
  });
  // Drag files onto the chat.
  (function () {
    var pane = box.parentNode, depth = 0;
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
    pane.addEventListener('dragenter', function (e) { if (!hasFiles(e) || !current) return; e.preventDefault(); depth++; pane.classList.add('chat-drop'); });
    pane.addEventListener('dragover', function (e) { if (hasFiles(e) && current) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    pane.addEventListener('dragleave', function () { if (--depth <= 0) { depth = 0; pane.classList.remove('chat-drop'); } });
    pane.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; pane.classList.remove('chat-drop');
      sendFiles(Array.prototype.slice.call(e.dataTransfer.files));
    });
  })();

  /**
   * Optimistic send: the bubble appears immediately (local preview for images and voice) and is
   * swapped for the real message once the upload and post finish; a failed one can be retried.
   */
  var seq = 0, queue = Promise.resolve();
  function nowStamp() { var d = new Date(); return S.today + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':00'; }
  function sendNow(o) {
    var channel = current, f = o.file;
    var m = { id: 'tmp' + (++seq), mine: true, pending: true, body: o.body || '', author: S.me.name, created_at: nowStamp(), seen_by: 0,
      file: f ? { url: URL.createObjectURL(f), name: f.name, mime: f.type || 'application/octet-stream', size: f.size, image: /^image\//.test(f.type) } : null };
    var e = $('.empty', box); if (e) e.remove();
    var nodes = bubble(m, true); nodes.forEach(function (n) { box.append(n); });
    var row = nodes[nodes.length - 1], bar = null;
    if (f) { bar = el('div', { class: 'upload-progress b-progress' }, el('i')); $('.bubble', row).append(bar); }
    box.scrollTop = box.scrollHeight;
    function run() {
      row.classList.remove('b-failed');
      var up = f ? MP.upload('files', f, { context: 'message', context_id: channel }, function (p) { $('i', bar).style.width = p * 100 + '%'; }) : Promise.resolve(null);
      // Posts go one after another so messages keep their order.
      var done = up.then(function (file) {
        queue = queue.then(function () {
          return MP.api('channels/' + channel + '/messages', { method: 'POST', body: { body: m.body, file_id: file ? file.id : 0, transcript: typeof o.transcript === 'function' ? o.transcript() : '' } });
        });
        return queue;
      });
      queue = done.catch(function () {});
      done.then(function () {
        row.remove(); if (m.file) setTimeout(function () { URL.revokeObjectURL(m.file.url); }, 60000);
        if (channel === current) return fetchNew(true);
      }).then(MP.loadChannels).catch(function (err) {
        row.classList.add('b-failed');
        var b = $('.bubble', row), again = $('.b-retry', b);
        if (!again) b.append(el('button', { type: 'button', class: 'b-retry', html: icon('repeat') + 'ارسال نشد — تلاش دوباره', onclick: function () { this.remove(); run(); } }));
        MP.soft(err);
      });
    }
    run();
  }
  $('#composer').onsubmit = function (e) {
    e.preventDefault();
    var body = text.value.trim();
    if (!body || !current) return;
    text.value = ''; text.style.height = ''; sendActivity('idle');
    sendNow({ body: body });
  };
  $('#chat-back').onclick = closeChat;

  MP.openChannel = function () { return current; };
  MP.startDirect = function (userId) {
    MP.api('channels', { method: 'POST', body: { type: 'direct', user_id: userId } }).then(function (ch) {
      MP.dialog.close();
      if (!S.channels.some(function (c) { return c.id === ch.id; })) S.channels.push(ch);
      MP.showView('messages', { channel: ch.id });
    }).catch(MP.soft);
  };
  function newDirect() {
    var q = el('input', { type: 'search', class: 'input', placeholder: 'جستجوی همکار…' }), list = el('div', { class: 'menu', style: { padding: 0, maxHeight: '50vh', overflow: 'auto' } });
    function draw() {
      list.replaceChildren();
      S.users.filter(function (u) { return u.id !== S.me.id && MP.norm(u.name + ' ' + u.title).indexOf(MP.norm(q.value)) >= 0; }).forEach(function (u) {
        list.append(el('button', { type: 'button', onclick: function () { MP.startDirect(u.id); } }, MP.avatar(u, 'sm'), el('span', null, el('strong', { text: u.name, style: { display: 'block' } }), el('small', { class: 'muted', text: u.title || '' }))));
      });
      if (!list.children.length) list.append(el('p', { class: 'hint', text: 'همکاری پیدا نشد.' }));
    }
    q.oninput = draw; draw();
    MP.dialog.open('پیام جدید به…', el('div', { class: 'form' }, q, list));
  }
  function shareLink(c) {
    var link = S.boot.clientUrl + encodeURIComponent(c.token);
    var input = el('input', { class: 'input', value: link, readonly: true, dir: 'ltr', onfocus: function (e) { e.target.select(); } });
    MP.dialog.open('لینک گروه مشتری', el('div', { class: 'form' },
      el('p', { text: 'این لینک را برای ' + c.client_name + ' بفرستید. مشتری بدون ورود به سایت در این گروه پیام و فایل می‌بیند و پیام می‌فرستد.' }), input,
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'button', class: 'btn btn-primary', text: 'کپی لینک', onclick: function () {
          (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { MP.toast('لینک کپی شد'); }, function () { input.select(); document.execCommand('copy'); MP.toast('لینک کپی شد'); });
        } }),
        navigator.share ? el('button', { type: 'button', class: 'btn btn-secondary', text: 'اشتراک‌گذاری', onclick: function () { navigator.share({ title: c.title, url: link }).catch(function () {}); } }) : null)));
  }
  function deleteClient(c) {
    MP.confirm('آرشیو گروه', 'گروه «' + c.title + '» آرشیو شود؟ پیام‌ها پاک نمی‌شوند و از «گروه‌های آرشیو‌شده» قابل بازگرداندن است.' + (c.type === 'client' ? ' لینک مشتری تا بازگرداندن کار نمی‌کند.' : ''), 'آرشیو').then(function (ok) {
      if (!ok) return;
      MP.api('channels/' + c.id, { method: 'DELETE' }).then(function () { current = 0; layout.classList.remove('open'); MP.toast('گروه آرشیو شد'); return MP.loadChannels(); }).then(function () { open({}); }).catch(MP.soft);
    });
  }
  function archivedGroups() {
    var body = MP.dialog.open('گروه‌های آرشیو‌شده', MP.skeleton(2));
    MP.api('channels', { query: { archived: 1 } }).then(function (list) {
      var wrap = el('div', { class: 'tio-history' });
      if (!list.length) wrap.append(el('p', { class: 'muted', text: 'گروه آرشیو‌شده‌ای نیست.' }));
      list.forEach(function (c) {
        wrap.append(el('article', { class: 'tpl-card' }, channelIcon(c), el('div', { class: 'tpl-copy' }, el('strong', { text: c.title }), el('small', { text: c.type === 'client' ? 'گروه مشتری' : 'گروه تیم' })),
          c.can_delete ? el('div', { class: 'tpl-actions' }, el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('repeat') + 'بازگرداندن', onclick: function () {
            MP.api('channels/' + c.id + '/restore', { method: 'POST' }).then(function () { MP.toast('گروه بازگردانده شد'); MP.dialog.close(); MP.loadChannels(); }).catch(MP.soft);
          } })) : null));
      });
      body.replaceChildren(wrap);
    }).catch(MP.soft);
  }
  /** Supervisor's team group: a name and any members (not tied to a project). */
  function groupForm(c) {
    var f = el('form', { class: 'form' });
    var chosen = {}; (c ? c.member_ids : [S.me.id]).forEach(function (id) { chosen[id] = true; });
    var people = el('div', { class: 'check-list' });
    S.users.forEach(function (u) {
      var cb = el('input', { type: 'checkbox', value: u.id, checked: !!chosen[u.id] || u.id === S.me.id, disabled: u.id === S.me.id });
      people.append(el('label', { class: 'check' }, cb, MP.avatar(u, 'sm'), el('span', { text: u.name + (u.title ? ' — ' + u.title : '') })));
    });
    f.append(MP.field('نام گروه', el('input', { name: 'title', required: true, maxlength: 160, value: c ? c.title : '', placeholder: 'مثلاً تیم فنی' })), el('div', { class: 'field' }, el('span', { text: 'اعضا' }), people), MP.actions(c ? 'ذخیره' : 'ساخت گروه'));
    f.onsubmit = function (e) {
      e.preventDefault(); MP.busy(f, true);
      var ids = Array.prototype.map.call(f.querySelectorAll('.check-list input:checked'), function (x) { return +x.value; });
      (c ? MP.api('channels/' + c.id + '/members', { method: 'POST', body: { title: f.elements.title.value, members: ids } })
         : MP.api('channels', { method: 'POST', body: { type: 'group', title: f.elements.title.value, members: ids } }))
        .then(function (ch) { MP.dialog.close(); MP.toast(c ? 'گروه به‌روز شد' : 'گروه ساخته شد'); return MP.loadChannels().then(function () { select(ch.id); }); })
        .catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open(c ? 'اعضای گروه' : 'گروه تیم جدید', f);
  }
  var ng = $('#new-team-group'); if (ng) ng.onclick = function () { groupForm(null); };
  $('#new-dm').onclick = newDirect;
  $('#new-client-group').onclick = function () {
    var f = el('form', { class: 'form' },
      MP.field('نام گروه', el('input', { name: 'title', required: true, maxlength: 160, placeholder: 'مثلاً پشتیبانی وبسایت زیوا' })),
      MP.field('نام مشتری', el('input', { name: 'client', required: true, maxlength: 120 })),
      MP.field('پروژه', MP.projectSelect('project_id', S.projectId), 'اعضای پروژه پیام‌های مشتری را می‌بینند و اعلان می‌گیرند.'),
      MP.actions('ساخت و دریافت لینک'));
    f.onsubmit = function (e) {
      e.preventDefault(); MP.busy(f, true);
      MP.api('channels', { method: 'POST', body: { type: 'client', title: f.elements.title.value, client_name: f.elements.client.value, project_id: +f.elements.project_id.value } })
        .then(function (c) { S.channels.push(c); select(c.id); shareLink(c); }).catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open('گروه اختصاصی مشتری', f);
  };

  function open(opts) {
    renderList();
    MP.loadChannels().then(function () {
      var target = opts.channel || current || (window.innerWidth > 860 && S.channels[0] && S.channels[0].id);
      if (target) select(target);
      else { layout.classList.remove('open'); $('#composer').hidden = true; box.replaceChildren(MP.empty('chat', 'یک گفت‌وگو را انتخاب کنید', null, null, true)); }
    });
  }
  MP.view('messages', { open: open });
  var origShow = MP.showView;
  MP.showView = function (name, opts) {
    if (name !== 'messages') { stop(); document.body.classList.remove('chat-full'); layout.classList.remove('open'); if (chatLayer) { var l = chatLayer; chatLayer = null; MP.popLayer(l); } }
    origShow(name, opts);
  };
  MP.on('notification', function (n) { if (n.type === 'message') MP.loadChannels(); });
})();
