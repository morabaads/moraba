/*
 * Messages, Telegram-style: project groups, team groups, direct chats, client groups and «saved messages».
 * Grouped bubbles with tails, replies, edits, reactions, a pinned message, forwarding, albums, photos or
 * files, link previews, mentions, search, drafts, an unread line, and a held request that brings news at once.
 */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, $$ = MP.$$, fa = MP.fa, icon = MP.icon;
  var chatLayer = null;
  function closeChat() { finishRecording(false); stopSpeaking(); endSelect(); closeFind(); clearCtx(); closeAttach();
    layout.classList.remove('open'); document.body.classList.remove('chat-full');
    current = 0; stop(); renderList(); liveRestart();
    if (chatLayer) { var l = chatLayer; chatLayer = null; MP.popLayer(l); }
  }
  var box = $('#chat-messages'), layout = $('#chat-layout'), text = $('#composer-text');
  var current = 0;          // open channel id
  var lastId = 0, firstId = 0, hasMore = false, sig = '', since = '', loopToken = 0, loadingOld = false;
  var msgs = {};            // id → payload (everything on screen)
  var rowsById = {};        // message id → its row (an album's messages share one row)
  var mineRows = {};        // my message id → its ticks node
  var unreadFrom = 0;       // first unread message when the chat was opened
  var newBelow = 0;         // others' messages that arrived while scrolled up
  var topic = 0;            // open topic, in a group with topics

  MP.loadChannels = function () { return MP.api('channels').then(function (l) { S.channels = l; MP.emit('channels'); if (MP.visible('messages')) renderList(); }); };
  function chan(id) { return S.channels.filter(function (x) { return x.id === (id || current); })[0] || null; }
  function isGroup(c) { return c && c.type !== 'direct' && c.type !== 'saved'; }

  function channelIcon(c, size) {
    if (c.type === 'direct') return MP.avatar(MP.user(c.other), size);
    if (c.type === 'saved') return el('span', { class: 'ci-ico saved', html: icon('bookmark') });
    if (c.logo) return el('span', { class: 'ci-ico ci-logo' }, el('img', { src: c.logo, alt: '' }));
    return el('span', { class: 'ci-ico' + (c.type === 'client' ? ' client' : c.type === 'group' ? ' group' : ''), html: icon(c.type === 'client' ? 'user' : c.type === 'group' ? 'chat' : 'folder') });
  }

  /* ------------------------------------------------------------ Small helpers */

  function hm(dt) { return MP.timeFa(String(dt).slice(11, 16)); }
  /** Chat list time: «۱۴:۳۰» today, «دیروز», a weekday this week, else the date. */
  function listTime(dt) {
    var d = String(dt).slice(0, 10);
    if (d === S.today) return hm(dt);
    if (d === J.addDays(S.today, -1)) return 'دیروز';
    if (d > J.addDays(S.today, -7)) return J.weekdays[J.weekday(d)];
    return J.format(d, d.slice(0, 4) !== S.today.slice(0, 4));
  }
  /** «آنلاین» or «آخرین بازدید …» from the heartbeat time (unix seconds). */
  function lastSeen(ts) {
    if (!ts) return 'آخرین بازدید خیلی وقت پیش';
    var ago = Date.now() / 1000 - ts;
    if (ago < 90) return 'آنلاین';
    if (ago < 3600) return 'آخرین بازدید ' + fa(Math.max(1, Math.round(ago / 60))) + ' دقیقه پیش';
    var d = new Date(ts * 1000), iso = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2), t = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    if (iso === S.today) return 'آخرین بازدید امروز ' + MP.timeFa(t);
    if (iso === J.addDays(S.today, -1)) return 'آخرین بازدید دیروز ' + MP.timeFa(t);
    return 'آخرین بازدید ' + J.format(iso, false);
  }
  function draftOf(id) { try { return localStorage.getItem('mp_draft_' + id) || ''; } catch (e) { return ''; } }
  function saveDraft(id, v) { try { if (v) localStorage.setItem('mp_draft_' + id, v); else localStorage.removeItem('mp_draft_' + id); } catch (e) { /* private mode */ } }
  function kindOf(m) {
    if (!m.file) return '';
    if (/^audio\//.test(m.file.mime)) return 'voice';
    if (m.as_file) return 'file';
    if (m.file.image) return 'photo';
    if (/^video\//.test(m.file.mime)) return 'video';
    return 'file';
  }
  function snippet(m) {
    if (m.deleted) return 'پیام آرشیو شد';
    if (m.body) return m.body.replace(/\s+/g, ' ').slice(0, 120);
    return { voice: 'پیام صوتی', photo: 'عکس', video: 'ویدیو', file: m.file ? m.file.name : 'فایل' }[kindOf(m)] || '';
  }
  var URL_RE = /https?:\/\/[^\s<>"']+/g;
  /** Message text: links clickable, «@نام» highlighted. Built as nodes, never as HTML. */
  function richText(body) {
    var p = el('p', { class: 'b-text', dir: 'auto' }), re = /(https?:\/\/[^\s<>"']+)|(@[^\s@،,.!؟?:]+(?:\s[^\s@،,.!؟?:]+)?)/g, last = 0, m;
    var names = {}; S.users.forEach(function (u) { names[u.name] = 1; names[u.name.split(' ')[0]] = 1; });
    while ((m = re.exec(body))) {
      if (m.index > last) p.append(body.slice(last, m.index));
      if (m[1]) { var url = m[1].replace(/[.,،)!؟?]+$/, ''); p.append(el('a', { href: url, target: '_blank', rel: 'noopener', dir: 'ltr', text: url })); last = m.index + url.length; re.lastIndex = last; continue; }
      var tag = m[2], full = tag.slice(1), first = full.split(' ')[0];
      if (names[full]) { p.append(el('span', { class: 'b-mention', text: tag })); last = m.index + tag.length; }
      else if (names[first]) { p.append(el('span', { class: 'b-mention', text: '@' + first })); last = m.index + first.length + 1; re.lastIndex = last; }
      else { p.append(tag); last = m.index + tag.length; }
    }
    if (last < body.length) p.append(body.slice(last));
    if (MP.onlyEmoji(body)) p.classList.add('b-jumbo', 'j' + MP.onlyEmoji(body));
    return MP.emojify(p);
  }

  /* ------------------------------------------------------------ Chat list */

  var listTab = 'all', listQ = '', showQuiet = false, foundMsgs = null, findTimer = 0;
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
    if (tab === 'direct') return c.type === 'direct' || c.type === 'saved';
    return c.type === tab;
  }
  function renderList() {
    var list = $('#chat-list'), keepFocus = document.activeElement && document.activeElement.id === 'chat-search';
    var scroll = list.scrollTop;
    list.replaceChildren();
    var search = el('label', { class: 'search chat-search' }, MP.iconEl('search'), el('input', { type: 'search', id: 'chat-search', placeholder: 'جستجوی گفت‌وگو و پیام…', value: listQ, 'aria-label': 'جستجوی گفت‌وگو و پیام', autocomplete: 'off' }));
    $('input', search).oninput = function (e) { listQ = e.target.value; foundMsgs = null; renderList(); findMessages(); };
    var saved = el('button', { type: 'button', class: 'icon-btn chat-saved-btn', title: 'پیام‌های ذخیره‌شده', 'aria-label': 'پیام‌های ذخیره‌شده', html: icon('bookmark'), onclick: openSaved });
    var tabs = tabsFor(S.channels);
    if (!tabs.some(function (t) { return t[0] === listTab; })) listTab = 'all';
    var unreadIn = function (tab) { return S.channels.filter(function (c) { return inTab(c, tab) && c.unread && !c.muted; }).length; };
    var bar = el('div', { class: 'chat-tabs', role: 'tablist' }, tabs.map(function (t) {
      var n = unreadIn(t[0]);
      return el('button', { type: 'button', role: 'tab', 'aria-selected': String(t[0] === listTab), onclick: function () { listTab = t[0]; try { localStorage.setItem('mp_chat_tab', listTab); } catch (e) { /* private mode */ } renderList(); } },
        t[1], n && t[0] !== 'all' ? el('i', { text: fa(n) }) : null);
    }));
    list.append(el('div', { class: 'chat-list-top' }, search, saved), bar);
    var q = MP.norm(listQ);
    var all = S.channels.filter(function (c) { return inTab(c, listTab) && (!q || MP.norm(c.title + ' ' + (c.client_name || '')).indexOf(q) >= 0); });
    var quiet = all.filter(function (c) { return (c.type === 'project' || c.type === 'saved') && !c.last && c.id !== current; });
    var items = (q || showQuiet) ? all : all.filter(function (c) { return quiet.indexOf(c) < 0; });
    var rank = function (c) { return c.pinned === 'all' ? 2 : c.pinned === 'me' ? 1 : 0; };
    items.sort(function (a, b) { return rank(b) - rank(a) || (b.last ? b.last.id : 0) - (a.last ? a.last.id : 0); });
    if (q && items.length) list.append(el('div', { class: 'chat-sec', text: 'گفت‌وگوها' }));
    items.forEach(function (c) { list.append(chatRow(c)); });
    if (q) {
      if (foundMsgs && foundMsgs.length) {
        list.append(el('div', { class: 'chat-sec', text: 'پیام‌ها' }));
        foundMsgs.forEach(function (h) {
          list.append(el('button', { type: 'button', class: 'chat-item found', onclick: function () { select(h.channel_id, h.id); } },
            channelIcon(chan(h.channel_id) || { type: 'project' }),
            el('span', { class: 'ci-copy' }, el('span', { class: 'ci-line' }, el('strong', { text: h.channel }), el('time', { text: listTime(h.created_at) })), el('small', { text: h.author + ': ' + h.text }))));
        });
      } else if (MP.norm(listQ).length >= 2) list.append(el('div', { class: 'chat-sec muted', text: foundMsgs ? 'پیامی با این متن پیدا نشد' : 'در حال جستجوی پیام‌ها…' }));
    }
    if (!items.length && !q) list.append(MP.empty('chat', 'گفت‌وگویی نیست', 'با «پیام جدید» گفت‌وگو را شروع کنید.', { text: 'پیام جدید', onclick: newDirect }, true));
    if (quiet.length && !q) list.append(el('button', { type: 'button', class: 'chat-archive-link', html: icon(showQuiet ? 'eye' : 'folder') + (showQuiet ? 'پنهان کردن گروه‌های بی‌پیام' : fa(quiet.length) + ' گروه بدون پیام'), onclick: function () { showQuiet = !showQuiet; renderList(); } }));
    list.append(el('button', { type: 'button', class: 'chat-archive-link', html: icon('folder') + 'گروه‌های آرشیو‌شده', onclick: archivedGroups }));
    if (keepFocus) { var i = $('#chat-search'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    MP.emojify(list);
    list.scrollTop = scroll;
  }
  function findMessages() {
    clearTimeout(findTimer);
    var q = listQ.trim(); if (MP.norm(q).length < 2) return;
    findTimer = setTimeout(function () {
      MP.api('messages/search', { query: { q: q } }).then(function (l) { if (listQ.trim() === q) { foundMsgs = l; renderList(); } }).catch(function () {});
    }, 350);
  }
  /** One conversation: avatar, name (+ muted), last message or draft, time, my ticks, unread badge or pin. */
  function chatRow(c) {
    var draft = c.id !== current ? draftOf(c.id) : '';
    var mine = c.last && c.last.mine && !c.last.deleted;
    var item = el('button', { type: 'button', class: 'chat-item' + (c.id === current ? ' active' : '') + (c.pinned ? ' pinned' : '') + (c.muted ? ' muted' : '') + (c.unread || c.marked ? ' has-unread' : '') + (c.type === 'direct' && isOnline(c.other) ? ' is-online' : ''), dataset: c.type === 'direct' ? { id: c.id, other: c.other } : { id: c.id }, onclick: function () { if (!item.dataset.swiped) select(c.id); } },
      channelIcon(c),
      el('span', { class: 'ci-copy' },
        el('span', { class: 'ci-line' },
          el('strong', null, c.title, c.muted ? el('i', { class: 'ci-mute', html: icon('bell-off') }) : null),
          c.last ? el('span', { class: 'ci-time' }, mine && c.type !== 'saved' ? el('i', { class: 'ci-tick' + (c.last.seen_by ? ' seen' : ''), html: icon(c.last.seen_by || c.last.got ? 'checks' : 'check') }) : null, el('time', { text: listTime(c.last.created_at) })) : null),
        el('span', { class: 'ci-line' },
          el('span', { class: 'ci-pv' }, draft ? el('small', { class: 'ci-draft' }, el('b', { text: 'پیش‌نویس: ' }), draft.replace(/\s+/g, ' ')) : preview(c)),
          c.mention && c.mention[0] ? el('span', { class: 'ci-at', title: 'شما را صدا زده‌اند', text: '@', onclick: function (e) { e.stopPropagation(); select(c.id, c.mention[1]); } }) : null,
          c.unread ? el('span', { class: 'badge' + (c.muted ? ' muted' : ''), text: fa(c.unread) }) : c.marked ? el('span', { class: 'badge ci-mark' }) : c.pinned ? el('span', { class: 'ci-pin', title: c.pinned === 'all' ? 'سنجاق برای همه' : 'سنجاق برای من', html: icon('pin') }) : null)));
    longPress(item, function () { chatMenu(c, item); });
    swipeRow(item, c);
    return item;
  }
  /** Chat list preview: «شما: …» / «سارا: …» in groups, or an icon + label for voice / photo / file. */
  function preview(c) {
    if (!c.last) return el('small', { text: c.type === 'client' ? 'مشتری: ' + c.client_name + (c.project_id && MP.project(c.project_id) ? ' · ' + MP.project(c.project_id).name : '') : c.type === 'saved' ? 'پیام‌ها، فایل‌ها و یادداشت‌های خودتان' : 'هنوز پیامی نیست' });
    var l = c.last;
    if (l.archived && !l.body && !l.file) return el('small', { class: 'ci-kind' }, MP.iconEl('ban'), 'پیام آرشیو شد');
    var who = l.mine ? 'شما: ' : isGroup(c) && l.author ? l.author.split(' ')[0] + ': ' : '';
    if (l.deleted) return el('small', { class: 'ci-kind' }, who, MP.iconEl('ban'), 'پیام آرشیو شد');
    var k = kindOf(l), lab = { voice: ['mic', 'پیام صوتی'], photo: ['image', 'عکس'], video: ['video', 'ویدیو'], file: ['clip', l.file ? l.file.name : 'فایل'] }[k];
    if (lab) return el('small', { class: 'ci-kind' }, who ? el('b', { text: who }) : null, MP.iconEl(lab[0]), l.body ? l.body : lab[1]);
    return el('small', null, who ? el('b', { text: who }) : null, l.body);
  }
  /** Swipe a conversation: toward the start pins/unpins it for me, toward the end marks it read. */
  function swipeRow(item, c) {
    var st = null, LIMIT = 70;
    item.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') st = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, on: false }; delete item.dataset.swiped; });
    item.addEventListener('pointermove', function (e) {
      if (!st || e.pointerId !== st.id) return;
      var dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.on) { if (Math.abs(dy) > 12) { st = null; return; } if (Math.abs(dx) < 16) return; st.on = true; item.style.transition = 'none'; }
      st.dx = Math.max(-110, Math.min(110, dx));
      item.style.transform = 'translateX(' + st.dx + 'px)';
      item.dataset.reveal = st.dx > 0 ? 'read' : 'pin';
      item.classList.toggle('sw-armed', Math.abs(st.dx) > LIMIT);
    });
    function end(e) {
      if (!st || e.pointerId !== st.id) return;
      var s = st; st = null; if (!s.on) return;
      item.dataset.swiped = '1'; setTimeout(function () { delete item.dataset.swiped; }, 350);
      item.style.transition = 'transform .25s var(--ease)'; item.style.transform = ''; item.classList.remove('sw-armed');
      if (Math.abs(s.dx) <= LIMIT) return;
      MP.haptic(12);
      if (s.dx > 0) markRead(c); else setPin(c, 'me', c.pinned !== 'me');
    }
    item.addEventListener('pointerup', end);
    item.addEventListener('pointercancel', function () { if (st && st.on) { item.style.transform = ''; item.classList.remove('sw-armed'); } st = null; });
  }
  function markRead(c) {
    MP.api('channels/' + c.id + '/read', { method: 'POST' }).then(function (n) { replaceChannel(n); MP.refreshCounts(); }).catch(MP.soft);
  }
  function replaceChannel(n) { S.channels = S.channels.map(function (x) { return x.id === n.id ? n : x; }); renderList(); }
  function setMute(c, on) {
    MP.api('channels/' + c.id + '/mute', { method: 'POST', body: { on: on } }).then(function (n) { replaceChannel(n); if (current === c.id) drawHead(); MP.toast(on ? 'اعلان این گفت‌وگو خاموش شد' : 'اعلان روشن شد', { icon: 'bell' }); }).catch(MP.soft);
  }
  function openSaved() {
    return MP.api('channels/saved', { method: 'POST' }).then(function (c) {
      if (!chan(c.id)) S.channels.push(c);
      select(c.id); return c;
    }).catch(MP.soft);
  }

  /* ------------------------------------------------------------ Header */

  function drawHead() {
    var c = chan(); if (!c) return;
    $('#chat-avatar').replaceChildren(channelIcon(c, 'sm'));
    $('#chat-title').replaceChildren(document.createTextNode(c.title));
    if (c.muted) $('#chat-title').append(el('i', { class: 'ci-mute', html: icon('bell-off') }));
    var sub = $('#chat-sub');
    var ls = c.type === 'direct' ? lastSeen(Math.max(seenOf(c.other), c.last_seen || 0)) : '';
    sub.classList.toggle('online', ls === 'آنلاین' && navigator.onLine);
    sub.textContent = !navigator.onLine ? 'در انتظار اتصال…' : c.type === 'direct' ? ls : c.settings && c.settings.mode === 'channel' ? 'کانال · ' + fa(c.members) + ' عضو' : c.type === 'saved' ? 'فقط خودتان می‌بینید' : c.type === 'client' ? 'گروه مشتری · ' + c.client_name + (c.project_id && MP.project(c.project_id) ? ' · ' + MP.project(c.project_id).name : '') : fa(c.members) + ' عضو';
    var tools = $('#chat-tools'); tools.replaceChildren();
    if (c.type === 'client') {
      tools.append(el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'لینک مشتری', onclick: function () { shareLink(c); } }));
      tools.append(el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('user') + 'مشتریان و ظاهر', onclick: function () { clientSettings(c); } }));
      if (c.project_id) tools.append(el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('eye') + 'پرتال', onclick: function () { MP.portal(c.project_id); } }));
    }
    if (c.type !== 'saved') tools.append(el('button', { type: 'button', class: 'icon-btn sm keep', title: 'جلسه آنلاین', 'aria-label': 'جلسه آنلاین', html: icon('video'), onclick: function () { startMeeting(c); } }));
    tools.append(el('button', { type: 'button', class: 'icon-btn sm keep', title: 'جستجو در گفت‌وگو', 'aria-label': 'جستجو در گفت‌وگو', html: icon('search'), onclick: openFind }));
    tools.append(el('button', { type: 'button', class: 'icon-btn sm keep', 'aria-label': 'گزینه‌های گفت‌وگو', title: 'گزینه‌ها', html: icon('more'), onclick: function (e) { chatMenu(c, e.currentTarget); } }));
  }
  function startMeeting(c) {
    MP.meetingForm(c.type === 'client' ? { channelId: c.id, projectId: c.project_id, title: 'جلسه با ' + (c.client_name || c.title) } : { title: 'جلسه ' + c.title, people: c.member_ids });
  }
  $('#chat-who').onclick = function () { if (current) chatInfo(chan()); };

  /* ------------------------------------------------------------ Opening a chat */

  function select(id, jump, opts) {
    var c = chan(id);
    if (!c) return;
    opts = opts || {};
    if (current && current !== id) { saveDraft(current, editing ? '' : text.value.trim()); }
    endSelect(); closeFind(); clearCtx(false);
    current = id; resetRows(); sig = ''; since = ''; newBelow = 0; hasNewer = false;
    topic = opts.topic || 0;
    unreadFrom = c.unread ? c.read_id + 1 : 0;
    showActivity([]);
    layout.classList.add('open');
    if (MP.isMobile()) {
      document.body.classList.add('chat-full');
      if (!chatLayer) chatLayer = MP.pushLayer(function () { chatLayer = null; closeChat(); });
    }
    box.replaceChildren(MP.skeleton(3));
    drawHead(); showPinned(null); downBtn();
    text.value = draftOf(id); composerState(); autoGrow();
    $('#composer').hidden = false;
    if (c.marked) { c.marked = false; MP.api('channels/' + id + '/mark', { method: 'POST', body: { on: false } }).catch(function () {}); }
    c.unread = 0; renderList();
    var token = ++loopToken;
    // At once: the copy kept on this device; the server's answer replaces it a moment later.
    MP.kv.get(snapKey(id)).then(function (snap) {
      if (token !== loopToken || !snap || !snap.messages || !snap.messages.length || !box.querySelector('.sk')) return;
      box.replaceChildren(); resetRows();
      snap.messages.forEach(function (m) { place(m, false); });
      decorate(); box.scrollTop = box.scrollHeight;
    });
    liveRestart();
    fetchFirst(token, jump).then(function () {
      if (token !== loopToken) return;
      if (jump) jumpTo(jump);
      if (opts.reply) text.focus();
      else if (!MP.isMobile()) text.focus();
    });
  }
  function resetRows() { lastId = 0; firstId = 0; hasMore = false; msgs = {}; rowsById = {}; mineRows = {}; albumRows = {}; }
  function snapKey(id) { return 'api:channels/' + id + '/messages?after=0'; }
  /** The newest messages of the open chat, kept on the device for an instant (and offline) start next time. */
  var snapTimer = 0;
  function saveSnapshot() {
    clearTimeout(snapTimer);
    var id = current;
    snapTimer = setTimeout(function () {
      if (id !== current || topic || hasNewer) return;
      var list = Object.keys(msgs).map(function (k) { return msgs[k]; }).filter(function (m) { return typeof m.id === 'number'; }).sort(function (a, b) { return a.id - b.id; }).slice(-80);
      MP.kv.set(snapKey(id), { messages: list.map(function (m) { var o = Object.assign({}, m); delete o.o; return o; }), has_more: true });
    }, 600);
  }
  var hasNewer = false;

  /** First page: the newest ~80 messages; then the unread line and the right scroll position. */
  function fetchFirst(token, around) {
    var q = { after: 0, topic: topic || '' };
    // A message far back (a link, a search hit, a date): open the page that holds it.
    if (around && typeof around === 'number') q.around = around;
    return MP.api('channels/' + current + '/messages', { query: q, noCache: !!(q.around || q.topic) }).then(function (d) {
      if (token !== loopToken) return;
      box.replaceChildren(); resetRows();
      hasMore = d.has_more || !!q.around; hasNewer = !!d.has_newer;
      d.messages.forEach(function (m) { place(m, false); });
      afterBatch(d);
      decorate();
      if (!box.querySelector('.msg-row, .sys-msg')) box.append(MP.empty('chat', current && chan() && chan().type === 'saved' ? 'پیام‌های ذخیره‌شده' : 'اولین پیام را بفرستید', current && chan() && chan().type === 'saved' ? 'هر پیامی را اینجا فوروارد کنید یا یادداشت بگذارید؛ فقط خودتان می‌بینید.' : 'پیام‌ها برای همه اعضای گفت‌وگو نمایش داده می‌شود.', null, true));
      var line = $('.unread-sep', box);
      if (line) box.scrollTop = Math.max(0, line.offsetTop - 60); else box.scrollTop = box.scrollHeight;
      downBtn();
      MP.refreshCounts();
      saveSnapshot();
    }).catch(function (e) { if (token === loopToken) box.replaceChildren(MP.empty('chat', 'پیام‌ها باز نشد', e.message, { text: 'تلاش دوباره', onclick: function () { select(current); } }, true)); });
  }

  /**
   * News for the open chat. The live connection says when something changed (sig); this fetches just that.
   * Without a live connection it also runs every few seconds as a fallback.
   */
  var pulling = false, pullAgain = false;
  function loop(token) { pull(token); }
  function pull(token) {
    token = token || loopToken;
    if (token !== loopToken || !current || !lastId && !firstId && !Object.keys(msgs).length && box.querySelector('.sk')) return;
    if (pulling) { pullAgain = true; return; }
    pulling = true;
    var id = current;
    MP.api('channels/' + id + '/messages', { query: { after: lastId, since: since, topic: topic || '' }, noCache: true }).then(function (d) {
      pulling = false;
      if (token !== loopToken || id !== current) return;
      var nearBottom = atBottom();
      var fresh = d.messages.filter(function (m) { return !msgs[m.id]; });
      fresh.forEach(function (m) { place(m, true); });
      afterBatch(d);
      if (fresh.length) {
        decorate();
        var theirs = fresh.filter(function (m) { return !m.mine; }).length;
        if (theirs) MP.haptic(8);
        if (nearBottom) box.scrollTop = box.scrollHeight; else { newBelow += theirs; downBtn(); }
        MP.loadChannels(); MP.refreshCounts();
        saveSnapshot();
      }
      if (pullAgain) { pullAgain = false; pull(token); }
    }).catch(function () { pulling = false; });
  }
  function stop() { loopToken++; }

  /* ------------------------------------------------------------ Live connection (Server-Sent Events, else a held request) */

  var C = window.MP_CONFIG;
  var live = { es: null, mode: 'sse', v: '', helloT: 0, fails: 0, polling: 0, open: 0, chTimer: 0, last: null };
  S.seen = S.seen || {}; S.act = S.act || {};
  function liveStart() {
    if (live.es || live.polling || document.hidden || !navigator.onLine) return;
    live.open = current;
    if (live.mode === 'poll' || !window.EventSource) { livePoll(); return; }
    var es;
    try { es = new EventSource(C.root + 'live?_wpnonce=' + encodeURIComponent(C.nonce) + (current ? '&open=' + current : ''), { withCredentials: true }); } catch (e) { live.mode = 'poll'; livePoll(); return; }
    live.es = es;
    var hello = false;
    // A host that holds streamed output back never says hello in time: the held request takes over.
    live.helloT = setTimeout(function () { if (!hello) { liveStop(); live.mode = 'poll'; liveStart(); } }, 6000);
    es.addEventListener('hello', function (e) { hello = true; clearTimeout(live.helloT); live.fails = 0; onLive(JSON.parse(e.data)); });
    es.addEventListener('state', function (e) { onLive(JSON.parse(e.data)); });
    es.onerror = function () {
      if (es.readyState === 2) { // closed for good (an error page, a lost session): try again a bit later
        liveStop(); live.fails++;
        if (live.fails > 3) live.mode = 'poll';
        setTimeout(liveStart, Math.min(30000, 2000 * live.fails));
      }
    };
  }
  function livePoll() {
    var my = ++live.polling;
    (function go() {
      if (live.polling !== my || document.hidden) { if (live.polling === my) live.polling = 0; return; }
      MP.api('live', { query: { mode: 'poll', v: live.v, open: current || '' }, noCache: true }).then(function (d) {
        if (live.polling !== my) return;
        onLive(d); go();
      }).catch(function () { if (live.polling === my) setTimeout(go, 4000); });
    })();
  }
  function liveStop() { clearTimeout(live.helloT); if (live.es) { live.es.close(); live.es = null; } live.polling = 0; }
  function liveRestart() { if (live.open === current && (live.es || live.polling)) return; liveStop(); liveStart(); }
  MP.liveStart = liveStart;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { liveStop(); return; }
    liveStart();
    if (current) pull();
    MP.loadChannels();
  });
  window.addEventListener('online', function () { liveStop(); liveStart(); if (current) { drawHead(); pull(); } });
  window.addEventListener('offline', function () { liveStop(); if (current) drawHead(); });
  // Safety net: if the live connection is down for a while, the open chat still updates.
  setInterval(function () { if (!document.hidden && current && !live.es && !live.polling) pull(); }, 8000);

  /** One live update: chat list changes, typing, presence and whether the open chat has news. */
  function onLive(d) {
    if (!d) return;
    if (d.v) live.v = d.v;
    var prevSeen = S.seen;
    S.seen = d.seen || S.seen; S.act = d.act || {};
    var changed = false, total = 0;
    Object.keys(d.ch || {}).forEach(function (k) {
      var st = d.ch[k], c = chan(+k);
      if (!c) { changed = true; return; }
      if (c.last_id !== st[0] || (+k !== current && c.unread !== st[1]) || (c.mention || [0])[0] !== st[2]) changed = true;
      // The others read or received my last message: the list's ticks change.
      if (live.last && live.last[k] && (live.last[k][4] !== st[4] || live.last[k][5] !== st[5]) && c.last && c.last.mine) changed = true;
      if (!c.muted && !c.arch_me) total += +k === current ? 0 : st[1];
    });
    if (S.channels && S.channels.some(function (c) { return !c.archived && d.ch && !d.ch[c.id]; })) changed = true;
    live.last = d.ch || live.last;
    if (changed) { clearTimeout(live.chTimer); live.chTimer = setTimeout(function () { MP.loadChannels(); }, 120); }
    if (S.boot && S.boot.counts && S.boot.counts.messages !== total) { S.boot.counts.messages = total; MP.updateBadges(S.boot.counts); }
    paintActivity();
    showActivity(current ? S.act[current] || [] : []);
    var c = chan();
    if (c && c.type === 'direct' && (!prevSeen || prevSeen[c.other] !== S.seen[c.other])) drawHead();
    paintOnline();
    if (current && d.sig && d.sig !== sig) pull();
  }
  function seenOf(uid) { return S.seen && S.seen[uid] ? S.seen[uid] : 0; }
  function isOnline(uid) { var t = seenOf(uid); return t && Date.now() / 1000 - t < 90; }
  /** Typing / recording shows in the chat list in place of the last message, as in Telegram. */
  function paintActivity() {
    $$('#chat-list .chat-item[data-id]').forEach(function (row) {
      var id = +row.dataset.id, a = S.act[id], pv = $('.ci-pv', row);
      if (!pv) return;
      if (a && a.length) {
        if (!pv._orig) pv._orig = Array.prototype.slice.call(pv.childNodes);
        var c = chan(id), rec = a.filter(function (x) { return x.state === 'recording'; }).length;
        var who = c && c.type === 'direct' ? '' : a.map(function (x) { return x.name.split(' ')[0]; }).slice(0, 2).join(' و ') + ' ';
        pv.replaceChildren(el('small', { class: 'ci-typing' }, who + (rec ? 'در حال ضبط ویس' : a[0].state === 'uploading' ? 'در حال ارسال فایل' : a[0].state === 'video' ? 'در حال ضبط ویدیو' : 'در حال نوشتن'), el('span', { class: 'act-dots' }, el('b'), el('b'), el('b'))));
      } else if (pv._orig) { pv.replaceChildren.apply(pv, pv._orig); pv._orig = null; }
    });
  }
  /** Green dot on a private chat's avatar while the other person is online. */
  function paintOnline() {
    $$('#chat-list .chat-item[data-other]').forEach(function (row) { row.classList.toggle('is-online', !!isOnline(+row.dataset.other)); });
  }
  setInterval(function () { paintOnline(); var c = chan(); if (c && c.type === 'direct' && !document.hidden) drawHead(); }, 30000);

  /** Everything except new messages: ticks, edits/reactions, deletions, typing, pinned message, sync point. */
  function afterBatch(d) {
    Object.keys(d.seen || {}).forEach(function (mid) { var g = !!(d.got && d.got[mid]); if (mineRows[mid]) setSeen(mineRows[mid], d.seen[mid], g); if (msgs[mid]) { msgs[mid].seen_by = d.seen[mid]; msgs[mid].got = g; } });
    (d.hidden || []).forEach(function (id) { if (msgs[id]) removeRow(id); });
    (d.changed || []).forEach(function (m) { if (msgs[m.id]) update(m); });
    if (!S.manager) (d.deleted || []).forEach(function (id) { if (msgs[id] && !msgs[id].deleted) { msgs[id].deleted = true; msgs[id].body = ''; msgs[id].file = null; update(msgs[id]); } });
    (d.removed || []).forEach(removeRow);
    if (d.activity) showActivity(d.activity);
    if (d.pinned !== undefined) showPinned(d.pinned);
    if (d.sig) sig = d.sig;
    if (d.now) since = d.now;
    var c = chan(); if (c && c.type === 'direct') drawHead();
  }

  /* ------------------------------------------------------------ Rows */

  var albumRows = {};
  /** Adds a message at the end (or, with old=true, it is being prepended by the caller). */
  function place(m, fresh, before) {
    msgs[m.id] = m;
    if (typeof m.id === 'number') {
      lastId = Math.max(lastId, m.id);
      firstId = firstId ? Math.min(firstId, m.id) : m.id;
    }
    // Photos sent together share one row (an album), as long as they arrive next to each other.
    var key = m.album && !m.deleted && kindOf(m) === 'photo' ? m.album + ':' + (m.user_id || m.author) : '';
    if (key && albumRows[key] && albumRows[key].row.isConnected) {
      var a = albumRows[key];
      a.ids.push(m.id); a.ids.sort(function (x, y) { return (typeof x === 'number' ? x : 1e15) - (typeof y === 'number' ? y : 1e15); });
      var r2 = row(a.ids.map(function (i) { return msgs[i]; }), false);
      a.row.replaceWith(r2); a.row = r2;
      a.ids.forEach(function (i) { rowsById[i] = r2; });
      return r2;
    }
    var r = row([m], fresh);
    if (before) box.insertBefore(r, before); else box.append(r);
    rowsById[m.id] = r;
    if (key) albumRows[key] = { row: r, ids: [m.id] };
    return r;
  }
  /** Re-draws a changed message (edit, reaction, deletion) in place. */
  function update(m) {
    msgs[m.id] = Object.assign(msgs[m.id] || {}, m);
    var old = rowsById[m.id]; if (!old) return;
    var ids = Object.keys(rowsById).filter(function (k) { return rowsById[k] === old; }).map(function (k) { return msgs[k] ? msgs[k].id : +k; });
    ids.sort(function (x, y) { return x - y; });
    var r = row(ids.map(function (i) { return msgs[i]; }).filter(Boolean), false);
    r.className = old.className.replace(/\bb-new\b/, '') + (r.classList.contains('sel') ? ' sel' : '');
    old.replaceWith(r);
    ids.forEach(function (i) { rowsById[i] = r; });
    Object.keys(albumRows).forEach(function (k) { if (albumRows[k].row === old) albumRows[k].row = r; });
  }
  function removeRow(id) {
    var r = rowsById[id]; if (!r) return;
    delete rowsById[id]; delete mineRows[id]; delete msgs[id];
    if (Object.keys(rowsById).some(function (k) { return rowsById[k] === r; })) { update(msgs[Object.keys(rowsById).filter(function (k) { return rowsById[k] === r; })[0]]); return; }
    r.style.transition = 'opacity .2s, transform .2s'; r.style.opacity = '0'; r.style.transform = 'scale(.96)';
    setTimeout(function () { r.remove(); decorate(); }, 200);
  }

  /** Day chips, the unread line, and who-starts/ends-a-run for tails, names and avatars. */
  function decorate() {
    $$('.day-sep, .unread-sep', box).forEach(function (n) { n.remove(); });
    var rows = $$('.msg-row, .sys-msg', box), prevDay = '', prev = null, unreadDone = false, c = chan(), group = isGroup(c);
    rows.forEach(function (r) {
      var m = msgs[r.dataset.id] || {}, day = String(m.created_at || '').slice(0, 10);
      if (day && day !== prevDay) { box.insertBefore(el('div', { class: 'day-sep' }, el('span', { text: day === S.today ? 'امروز' : day === J.addDays(S.today, -1) ? 'دیروز' : J.formatLong(day) })), r); prevDay = day; prev = null; }
      if (!unreadDone && unreadFrom && typeof m.id === 'number' && m.id >= unreadFrom && !m.mine) { box.insertBefore(el('div', { class: 'unread-sep' }, el('span', { text: 'پیام‌های خوانده‌نشده' })), r); unreadDone = true; prev = null; }
      if (!r.classList.contains('msg-row')) { prev = null; return; }
      var same = prev && prev.dataset.who === r.dataset.who && (+r.dataset.t - +prev.dataset.t) < 600;
      r.classList.toggle('g-first', !same);
      if (prev) prev.classList.toggle('g-last', !same);
      r.classList.toggle('in-group', group);
      prev = r;
    });
    if (prev) prev.classList.add('g-last');
  }

  function ts(m) { var d = new Date(String(m.created_at).replace(' ', 'T')); return isNaN(d) ? 0 : Math.round(d.getTime() / 1000); }

  /** One row: avatar slot, the bubble (author, forward, reply, media, text, link card, reactions, time/ticks). */
  function row(list, fresh) {
    var m = list[0], last = list[list.length - 1];
    if (m.kind === 'system') {
      var sys = el('div', { class: 'sys-msg' + (fresh ? ' b-new' : ''), dataset: { id: m.id } }, el('span', { class: 'sys-ico', html: icon(SYS_ICON[m.meta && m.meta.t] || 'bell') }), el('p', { text: m.body }),
        m.meta && m.meta.url ? el('a', { class: 'sys-link', href: m.meta.url, target: '_blank', rel: 'noopener', text: 'مشاهده' }) : null,
        el('time', { text: hm(m.created_at) }));
      if (S.manager) sys.addEventListener('contextmenu', function (e) { e.preventDefault(); askDelete(m); });
      return sys;
    }
    var mine = !!m.mine, c = chan();
    var r = el('div', { class: 'msg-row ' + (mine ? 'me' : 'other') + (fresh ? ' b-new' : '') + (m.pending ? ' b-pending' : '') + (m.failed ? ' b-failed' : ''), dataset: { id: m.id, who: mine ? 'me' : String(m.user_id || m.author), t: ts(m) } });
    if (fresh) setTimeout(function () { r.classList.remove('b-new'); }, 1600);
    if (!mine && isGroup(c)) r.append(el('span', { class: 'msg-av' }, MP.avatar({ name: m.author, avatar: m.avatar }, 'sm')));
    var b = el('div', { class: 'bubble' });
    r.append(b);
    if (m.archived) b.append(el('span', { class: 'b-arch', html: icon('folder') + 'آرشیو شده (فقط ناظر می‌بیند)' }));
    if (!mine && isGroup(c)) b.append(el('span', { class: 'b-author', text: m.author }));
    if (m.deleted) {
      b.classList.add('b-deleted');
      b.append(el('p', { class: 'b-del' }, MP.iconEl('ban'), mine ? 'این پیام را آرشیو کردید' : 'این پیام آرشیو شد'), metaOf(m));
      r.classList.add('gone');
      return r;
    }
    if (m.fwd_from) b.append(el('span', { class: 'b-fwd' }, MP.iconEl('forward'), 'فوروارد از ', el('b', { text: m.fwd_from })));
    if (m.reply) b.append(quote(m.reply));
    var kind = kindOf(m), caption = list.map(function (x) { return x.body; }).filter(Boolean)[0] || '';
    if (list.length > 1 || kind === 'photo') {
      b.append(album(list));
      if (!caption) b.classList.add('media-only');
    } else if (kind === 'voice') b.append(voiceBubble(m));
    else if (kind === 'video') b.append(el('video', { class: 'b-video', src: m.file.url, controls: true, preload: 'metadata', playsinline: true }));
    else if (kind === 'file') b.append(fileCard(m));
    if (caption) b.append(richText(caption));
    if (caption && !m.file && !m.reply && !m.fwd_from && MP.onlyEmoji(caption)) b.classList.add('jumbo');
    var url = caption && !m.file ? (caption.match(URL_RE) || [])[0] : '';
    if (url) b.append(linkCard(url.replace(/[.,،)!؟?]+$/, '')));
    var reacts = reactionsOf(list);
    if (reacts) b.append(reacts);
    var meta = metaOf(last, list);
    b.append(meta);
    $$('.b-quote, .b-reacts, .b-link', b).forEach(MP.emojify);
    // Time and ticks tuck into the end of the last text line; under media or cards they get their own line.
    var prevEl = meta.previousElementSibling;
    if (prevEl && prevEl.classList.contains('b-text')) b.classList.add('meta-in');
    if (last.edited) b.classList.add('edited');
    if (list.length > 1 || kind === 'photo') b.classList.add('has-album');
    if (m.pending) { var bar = el('div', { class: 'upload-progress b-progress' }, el('i')); b.append(bar); r._bar = bar; }
    if (m.failed) b.append(el('button', { type: 'button', class: 'b-retry', html: icon('repeat') + (m.offline ? 'در انتظار اینترنت — ارسال دوباره' : 'ارسال نشد — تلاش دوباره'), onclick: function (e) { e.stopPropagation(); retry(m); } }));
    if (!m.pending && !m.failed) wireRow(r, list);
    return r;
  }
  function metaOf(m, list) {
    var meta = el('span', { class: 'b-meta' }, m.edited ? el('em', { text: 'ویرایش‌شده' }) : null, el('time', { text: hm(m.created_at) }));
    if (m.pending || m.failed) meta.append(el('span', { class: 'b-sending', html: icon('clock') }));
    else if (m.mine && chan() && chan().type !== 'saved') {
      var seen = el('span', { class: 'seen' }); meta.append(seen);
      (list || [m]).forEach(function (x) { mineRows[x.id] = seen; });
      setSeen(seen, m.seen_by, m.got);
    }
    return meta;
  }
  /** ✓ sent · ✓✓ grey: reached the other person's device · ✓✓ coloured: read. */
  function setSeen(node, n, got) {
    node.innerHTML = icon(n || got ? 'checks' : 'check');
    node.classList.toggle('on', !!n);
    node.classList.toggle('got', !n && !!got);
    node.title = n ? 'خوانده شد' + (n > 1 ? ' توسط ' + fa(n) + ' نفر' : '') : got ? 'رسید (هنوز خوانده نشده)' : 'ارسال شد';
  }
  function quote(q) {
    return el('button', { type: 'button', class: 'b-quote', onclick: function (e) { e.stopPropagation(); jumpTo(q.id); } },
      q.kind === 'photo' ? el('span', { class: 'bq-ico', html: icon('image') }) : q.kind === 'voice' ? el('span', { class: 'bq-ico', html: icon('mic') }) : null,
      el('span', { class: 'bq-copy' }, el('b', { text: q.mine ? 'شما' : q.author }), el('small', { text: q.text || '…' })));
  }
  /** Photos: one fills the bubble; several sit in a Telegram-like mosaic. */
  function album(list) {
    var n = list.length, grid = el('div', { class: 'b-album n' + Math.min(n, 6) });
    list.forEach(function (x, i) {
      var cell = el('button', { type: 'button', class: 'b-ph', 'aria-label': 'دیدن عکس', onclick: function (e) { e.stopPropagation(); if (!selecting) gallery(x.id); } },
        el('img', { src: x.file.url, alt: x.file.name || '', loading: 'lazy', decoding: 'async' }));
      if (x.pending && x !== list[0]) cell.classList.add('ph-wait');
      if (n > 1 && x.body && i > 0) cell.title = x.body;
      // Six or more: three a row; a short last row stretches to the full width (no empty gap).
      if (n >= 6 && i >= n - n % 3) { cell.style.gridColumn = 'span ' + 6 / (n % 3); cell.style.aspectRatio = n % 3 === 1 ? '2 / 1' : '3 / 2'; }
      grid.append(cell);
      var img = cell.firstChild;
      if (n === 1) img.addEventListener('load', function () { var w = img.naturalWidth, h = img.naturalHeight; if (w && h) cell.style.aspectRatio = Math.max(.6, Math.min(1.9, w / h)); });
    });
    return grid;
  }
  function fileCard(m) {
    var f = m.file, ext = (f.name.split('.').pop() || '').slice(0, 4).toUpperCase();
    return el('a', { class: 'b-file', href: f.url + (f.url.indexOf('?') >= 0 ? '&' : '?') + 'download=1', target: '_blank', rel: 'noopener', onclick: function (e) { if (selecting) e.preventDefault(); e.stopPropagation(); } },
      el('span', { class: 'bf-ico' + (f.image ? ' img' : '') }, f.image ? el('img', { src: f.url, alt: '', loading: 'lazy' }) : el('b', { text: ext || 'FILE' })),
      el('span', { class: 'bf-copy' }, el('strong', { text: f.name, dir: 'auto' }), el('small', { text: MP.fileSize(f.size) + ' · دانلود' })));
  }
  var previews = {};
  function linkCard(url) {
    var card = el('a', { class: 'b-link', href: url, target: '_blank', rel: 'noopener', hidden: true });
    function fill(p) {
      if (!p || (!p.title && !p.description)) return;
      card.replaceChildren(el('span', { class: 'bl-copy' }, el('b', { text: p.site }), p.title ? el('strong', { text: p.title, dir: 'auto' }) : null, p.description ? el('small', { text: p.description, dir: 'auto' }) : null));
      if (p.image) card.append(el('img', { src: p.image, alt: '', loading: 'lazy', onerror: function () { this.remove(); } }));
      card.hidden = false;
    }
    if (previews[url]) previews[url].then(fill);
    else previews[url] = MP.api('link-preview', { query: { url: url } }).catch(function () { return null; }), previews[url].then(fill);
    return card;
  }
  function reactionsOf(list) {
    var m = list[list.length - 1]; // an album's reactions belong to its last photo
    if (!m.reactions || !m.reactions.length) return null;
    return el('div', { class: 'b-reacts' }, m.reactions.map(function (x) {
      return el('button', { type: 'button', class: 'b-react' + (x.mine ? ' mine' : ''), title: x.names.join('، '), onclick: function (e) { e.stopPropagation(); react(m, x.emoji); } },
        el('span', { class: 'br-e', text: x.emoji }), x.count > 1 || isGroup(chan()) ? el('span', { text: fa(x.count) }) : null);
    }));
  }

  /* ------------------------------------------------------------ Scrolling */

  function atBottom() { return box.scrollHeight - box.scrollTop - box.clientHeight < 140; }
  function downBtn() {
    var b = $('#chat-down'), n = $('#chat-down-n');
    b.hidden = !current || (atBottom() && !hasNewer);
    n.hidden = !newBelow; n.textContent = fa(newBelow);
  }
  // The date chip stuck at the top shows while scrolling and fades out a moment after (Telegram).
  var dayTimer = 0;
  function stuckDays(show) {
    var top = box.getBoundingClientRect().top;
    $$('.day-sep', box).forEach(function (d) { d.classList.toggle('faded', !show && Math.abs(d.getBoundingClientRect().top - top - 4) < 3 && d.offsetTop > 20); });
  }
  box.addEventListener('scroll', function () {
    stuckDays(true); clearTimeout(dayTimer); dayTimer = setTimeout(function () { stuckDays(false); }, 1200);
    if (atBottom()) newBelow = 0;
    downBtn();
    if (box.scrollTop < 300 && hasMore && !loadingOld && current) loadOlder();
  }, { passive: true });
  $('#chat-down').onclick = function () {
    if (hasNewer) { select(current, 0, { topic: topic }); return; }
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); newBelow = 0; downBtn();
  };

  /** Older history, kept in place on screen while it is added above. */
  function loadOlder() {
    if (!firstId || loadingOld) return Promise.resolve(false);
    loadingOld = true;
    var id = current, h = box.scrollHeight, top = box.scrollTop;
    return MP.api('channels/' + id + '/messages', { query: { before: firstId } }).then(function (d) {
      loadingOld = false;
      if (id !== current) return false;
      hasMore = d.has_more;
      var anchor = box.querySelector('.msg-row, .sys-msg');
      d.messages.forEach(function (m) { if (!msgs[m.id]) place(m, false, anchor); });
      decorate();
      box.scrollTop = top + (box.scrollHeight - h);
      return d.messages.length > 0;
    }).catch(function () { loadingOld = false; return false; });
  }
  /** Scrolls to a message (loading older pages if needed) and flashes it. */
  function jumpTo(id) {
    var tries = 0;
    (function go() {
      var r = rowsById[id];
      if (r) {
        r.scrollIntoView({ block: 'center', behavior: 'smooth' });
        r.classList.remove('flash'); void r.offsetWidth; r.classList.add('flash');
        return;
      }
      if (!hasMore || id > lastId) { MP.toast('این پیام در دسترس نیست'); return; }
      // Far back: open the page around it instead of loading page after page.
      if (tries++ > 3) { var t = ++loopToken; fetchFirst(t, id).then(function () { var r2 = rowsById[id]; if (r2) { r2.scrollIntoView({ block: 'center' }); r2.classList.add('flash'); } else MP.toast('این پیام در دسترس نیست'); }); return; }
      loadOlder().then(function (more) { if (more !== false) go(); });
    })();
  }

  /* ------------------------------------------------------------ Pinned message bar */

  var pinned = null;
  function showPinned(p) {
    pinned = p;
    var bar = $('#chat-pinbar'); bar.hidden = !p;
    if (!p) return;
    $('#chat-pin-text').textContent = (p.kind === 'photo' ? '🖼 ' : p.kind === 'voice' ? '🎤 ' : '') + (p.text || p.author);
    MP.emojify($('#chat-pin-text'));
  }
  $('#chat-pinbar').onclick = function (e) {
    if (e.target.closest('#chat-pin-x')) { if (pinned) pin({ id: pinned.id }, false); return; }
    if (pinned) jumpTo(pinned.id);
  };

  /* ------------------------------------------------------------ Typing / recording indicator */

  var actEl = $('#chat-activity'), lastSent = { state: '', at: 0 };
  function showActivity(list) {
    list = list || [];
    var rec = list.filter(function (a) { return a.state === 'recording'; }), typ = list.filter(function (a) { return a.state === 'typing'; });
    var pick = rec.length ? rec : typ;
    if (!pick.length) { actEl.hidden = true; $('#chat-sub').hidden = false; return; }
    var c = chan(), direct = c && c.type === 'direct';
    var who = direct ? '' : pick.map(function (a) { return a.name.split(' ')[0]; }).slice(0, 2).join(' و ') + (pick.length > 2 ? ' و …' : '') + ' ';
    actEl.className = 'chat-activity ' + (rec.length ? 'is-rec' : 'is-typing');
    actEl.replaceChildren(el('i', { class: 'act-ico', html: rec.length ? icon('mic') : '' }), el('span', { text: who + (rec.length ? 'در حال ضبط ویس' : 'در حال نوشتن') }), el('span', { class: 'act-dots' }, el('b'), el('b'), el('b')));
    actEl.hidden = false; $('#chat-sub').hidden = true;
  }
  function sendActivity(state) {
    if (!current || (chan() && chan().type === 'saved')) return;
    var now = Date.now();
    if (state === lastSent.state && now - lastSent.at < 3000) return; // repeat at most every 3s
    if (state === 'idle' && !lastSent.state) return;
    lastSent = { state: state === 'idle' ? '' : state, at: now };
    MP.api('channels/' + current + '/activity', { method: 'POST', body: { state: state } }).catch(function () {});
  }
  MP.chatActivity = sendActivity;

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
      var rp = replyTo; clearCtx(false);
      sendNow({ file: file, transcript: function () { return r.transcript || ''; }, reply: rp });
    };
    r.mr.stop();
    MP.haptic && MP.haptic(10);
  }
  $('#composer-mic').onclick = startRecording;
  $('#rec-send').onclick = function () { finishRecording(true); };
  $('#rec-cancel').onclick = function () { finishRecording(false); MP.toast('ضبط لغو شد'); };

  /* ------------------------------------------------------------ Composer: text, emoji, mentions, draft, reply/edit bar */

  var replyTo = null, editing = null;
  if (MP.isMobile()) text.placeholder = 'پیام…';
  function autoGrow() { text.style.height = 'auto'; text.style.height = Math.min(160, text.scrollHeight) + 'px'; }
  function composerState() { $('#composer').classList.toggle('has-text', !!text.value.trim() || !!editing); }
  var draftTimer = 0;
  text.addEventListener('input', function () {
    sendActivity(text.value.trim() ? 'typing' : 'idle'); autoGrow(); composerState(); mentionCheck();
    clearTimeout(draftTimer); var ch = current; draftTimer = setTimeout(function () { if (ch === current && !editing) saveDraft(ch, text.value.trim()); }, 400);
  });
  // iPhone: keep the page itself from scrolling away under the keyboard.
  text.addEventListener('focus', function () { if (MP.isMobile()) setTimeout(function () { window.scrollTo(0, 0); }, 60); });
  text.addEventListener('keydown', function (e) {
    if (mentionKeys(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !MP.isMobile()) { e.preventDefault(); $('#composer').requestSubmit(); }
    if (e.key === 'Escape' && (replyTo || editing)) { e.preventDefault(); clearCtx(); }
    if (e.key === 'ArrowUp' && !text.value) { // edit my last message, like Telegram desktop
      var mine = Object.keys(msgs).map(function (k) { return msgs[k]; }).filter(function (m) { return m.mine && typeof m.id === 'number' && !m.deleted && !m.kind && kindOf(m) !== 'voice'; }).sort(function (a, b) { return b.id - a.id; })[0];
      if (mine) { e.preventDefault(); startEdit(mine); }
    }
  });
  function setCtx(kind, m) {
    var bar = $('#compose-ctx');
    $('#cc-ico').innerHTML = icon(kind === 'edit' ? 'edit' : 'reply');
    $('#cc-title').textContent = kind === 'edit' ? 'ویرایش پیام' : 'پاسخ به ' + (m.mine ? 'خودتان' : m.author);
    $('#cc-text').textContent = snippet(m); MP.emojify($('#cc-text'));
    bar.hidden = false; bar.dataset.kind = kind;
    text.focus();
  }
  function clearCtx(keepText) {
    var wasEdit = !!editing;
    replyTo = null; editing = null; $('#compose-ctx').hidden = true;
    if (wasEdit && keepText !== false) { text.value = draftOf(current); autoGrow(); }
    composerState();
  }
  $('#cc-x').onclick = function () { clearCtx(); };
  function startReply(m) { if (editing) clearCtx(); replyTo = m; setCtx('reply', m); }
  function startEdit(m) { replyTo = null; editing = m; text.value = m.body || ''; autoGrow(); setCtx('edit', m); composerState(); text.setSelectionRange(text.value.length, text.value.length); }

  // Emoji panel, in groups like Telegram's, with «recent» first.
  var EMOJI = [
    ['🕒', 'اخیر', ''],
    ['😀', 'شکلک‌ها', '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 🫠 😉 😊 😇 🥰 😍 🤩 😘 😗 ☺️ 😚 😙 🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🫣 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 😵‍💫 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 ☹️ 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾 🙈 🙉 🙊'],
    ['👋', 'دست و آدم‌ها', '👋 🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🫴 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦵 🦶 👂 👃 🧠 🫀 🫁 🦷 🦴 👀 👁️ 👅 👄 🫦 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 🧑‍💻 👨‍💻 👩‍💻 🧑‍🎨 👨‍🎨 👩‍🎨 🧑‍💼 👨‍💼 👩‍💼 🧑‍🏫 🧑‍🔧 🧑‍🍳 🧑‍🎓 🕵️ 💂 🥷 👷 🤴 👸 🧕 🤵 👰 🤰 🤱 👼 🎅 🦸 🦹 🧙 🧚 🧛 🧜 🧝 🧞 🧟 💆 💇 🚶 🧍 🧎 🏃 💃 🕺 👯 🧖 🧗 🤸 🏋️ 🚴 🤹 🧘 🛀 🛌 👭 👫 👬 💏 💑 👪 🗣️ 👤 👥'],
    ['🐶', 'حیوانات و طبیعت', '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪱 🐛 🦋 🐌 🐞 🐜 🪰 🪲 🦟 🦗 🕷️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦞 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🦧 🐘 🦛 🦏 🐪 🐫 🦒 🦘 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐈 🐈‍⬛ 🪶 🐓 🦃 🦚 🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦫 🦦 🦥 🐁 🐀 🐿️ 🦔 🐾 🐉 🐲 🌵 🎄 🌲 🌳 🌴 🪵 🌱 🌿 ☘️ 🍀 🎍 🪴 🎋 🍃 🍂 🍁 🍄 🐚 🪨 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌜 🌚 🌕 🌙 🌎 🪐 💫 ⭐ 🌟 ✨ ⚡ ☄️ 💥 🔥 🌪️ 🌈 ☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ 🌨️ ❄️ ☃️ ⛄ 🌬️ 💨 💧 💦 ☔ ☂️ 🌊'],
    ['🍔', 'خوراکی', '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🫓 🥪 🥙 🧆 🌮 🌯 🫔 🥗 🥘 🫕 🥫 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 🫖 ☕ 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾 🧊 🥄 🍴 🍽️ 🥣 🥡 🥢 🧂'],
    ['⚽', 'فعالیت', '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🪃 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 ⛷️ 🏂 🪂 🏆 🥇 🥈 🥉 🏅 🎖️ 🏵️ 🎗️ 🎫 🎟️ 🎪 🤹 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🪘 🎷 🎺 🪗 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🎰 🧩'],
    ['🚗', 'سفر و مکان', '🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🦯 🦽 🦼 🛴 🚲 🛵 🏍️ 🛺 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ 🪝 ⛽ 🚧 🚦 🚥 🚏 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺ 🛖 🏠 🏡 🏘️ 🏚️ 🏗️ 🏭 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛️ ⛪ 🕌 🕍 🛕 🕋 ⛩️ 🛤️ 🛣️ 🗾 🎑 🏞️ 🌅 🌄 🌠 🎇 🎆 🌇 🌆 🏙️ 🌃 🌌 🌉 🌁'],
    ['💡', 'اشیا', '⌚ 📱 📲 💻 ⌨️ 🖥️ 🖨️ 🖱️ 🖲️ 🕹️ 🗜️ 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽️ 🎞️ 📞 ☎️ 📟 📠 📺 📻 🎙️ 🎚️ 🎛️ 🧭 ⏱️ ⏲️ ⏰ 🕰️ ⌛ ⏳ 📡 🔋 🪫 🔌 💡 🔦 🕯️ 🪔 🧯 🛢️ 💸 💵 💴 💶 💷 🪙 💰 💳 💎 ⚖️ 🪜 🧰 🪛 🔧 🔨 ⚒️ 🛠️ ⛏️ 🪚 🔩 ⚙️ 🪤 🧱 ⛓️ 🧲 🔫 💣 🧨 🪓 🔪 🗡️ ⚔️ 🛡️ 🚬 ⚰️ 🪦 ⚱️ 🏺 🔮 📿 🧿 💈 ⚗️ 🔭 🔬 🕳️ 🩹 🩺 💊 💉 🩸 🧬 🦠 🧫 🧪 🌡️ 🧹 🪠 🧺 🧻 🚽 🚰 🚿 🛁 🧼 🪥 🪒 🧽 🪣 🧴 🛎️ 🔑 🗝️ 🚪 🪑 🛋️ 🛏️ 🧸 🪆 🖼️ 🪞 🪟 🛍️ 🛒 🎁 🎈 🎏 🎀 🪄 🪅 🎊 🎉 🎎 🏮 🎐 🧧 ✉️ 📩 📨 📧 💌 📥 📤 📦 🏷️ 🪧 📪 📫 📬 📭 📮 📯 📜 📃 📄 📑 🧾 📊 📈 📉 🗒️ 🗓️ 📆 📅 🗑️ 📇 🗃️ 🗳️ 🗄️ 📋 📁 📂 🗂️ 🗞️ 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🧷 🔗 📎 🖇️ 📐 📏 🧮 📌 📍 ✂️ 🖊️ 🖋️ ✒️ 🖌️ 🖍️ 📝 ✏️ 🔍 🔎 🔏 🔐 🔒 🔓'],
    ['❤️', 'نمادها', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉️ ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🆚 💮 🉐 ㊙️ ㊗️ 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕ 🛑 ⛔ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿ 🅿️ 🛗 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 ⚧️ 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ⏏️ ▶️ ⏸️ ⏯️ ⏹️ ⏺️ ⏭️ ⏮️ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 🟰 ♾️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 🔜 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾ ◽ ◼️ ◻️ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 💬 💭 🗯️ ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄 🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛'],
    ['🏁', 'پرچم‌ها', '🏳️ 🏴 🏁 🚩 🏳️‍🌈 🇮🇷 🇦🇫 🇹🇯 🇮🇶 🇹🇷 🇦🇪 🇸🇦 🇶🇦 🇰🇼 🇴🇲 🇧🇭 🇦🇿 🇦🇲 🇬🇪 🇵🇰 🇮🇳 🇨🇳 🇯🇵 🇰🇷 🇷🇺 🇺🇦 🇩🇪 🇫🇷 🇬🇧 🇮🇹 🇪🇸 🇳🇱 🇧🇪 🇸🇪 🇳🇴 🇩🇰 🇫🇮 🇨🇭 🇦🇹 🇵🇱 🇬🇷 🇵🇹 🇮🇪 🇺🇸 🇨🇦 🇲🇽 🇧🇷 🇦🇷 🇦🇺 🇳🇿 🇿🇦 🇪🇬 🇲🇦 🇳🇬 🇰🇪 🇮🇩 🇲🇾 🇹🇭 🇻🇳 🇵🇭 🇸🇬 🇪🇺 🇺🇳']
  ];
  var pop = $('#emoji-pop'), emoTab = 1;
  function recentEmoji() { try { return JSON.parse(localStorage.getItem('mp_emoji_recent') || '[]'); } catch (e) { return []; } }
  function drawEmoji() {
    var list = emoTab === 0 ? recentEmoji() : EMOJI[emoTab][2].split(' ');
    var grid = el('div', { class: 'ep-grid' }, list.length ? list.map(function (e) { return el('button', { type: 'button', 'aria-label': e, onclick: function () { pickEmoji(e); } }, MP.emojiImg(e)); }) : el('p', { class: 'ep-none', text: 'هنوز ایموجی‌ای نفرستاده‌اید' }));
    var tabs = el('div', { class: 'ep-tabs' }, EMOJI.map(function (c, i) { return el('button', { type: 'button', class: i === emoTab ? 'on' : '', title: c[1], 'aria-label': c[1], onclick: function () { emoTab = i; drawEmoji(); } }, MP.emojiImg(c[0])); }));
    pop.replaceChildren(el('div', { class: 'ep-title', text: EMOJI[emoTab][1] }), grid, tabs);
  }
  function pickEmoji(e) {
    var r = recentEmoji().filter(function (x) { return x !== e; }); r.unshift(e);
    try { localStorage.setItem('mp_emoji_recent', JSON.stringify(r.slice(0, 32))); } catch (er) { /* private mode */ }
    insertAt(e);
  }
  $('#composer-emoji').onclick = function () { if (pop.hidden) { emoTab = recentEmoji().length ? 0 : 1; drawEmoji(); } pop.hidden = !pop.hidden; if (!pop.hidden && !MP.isMobile()) text.focus(); };
  document.addEventListener('pointerdown', function (e) { if (!pop.hidden && !e.target.closest('#emoji-pop, #composer-emoji')) pop.hidden = true; });
  function insertAt(s) {
    var a = text.selectionStart || text.value.length, b = text.selectionEnd || a;
    text.value = text.value.slice(0, a) + s + text.value.slice(b);
    text.setSelectionRange(a + s.length, a + s.length);
    text.dispatchEvent(new Event('input'));
  }

  // «@» suggestions: the chat's members.
  var mPop = $('#mention-pop'), mList = [], mIdx = 0, mStart = -1;
  function mentionCheck() {
    var c = chan(), pos = text.selectionStart, before = text.value.slice(0, pos), m = before.match(/(^|\s)@([^\s@]*)$/);
    if (!c || !isGroup(c) || !m) { mPop.hidden = true; return; }
    mStart = pos - m[2].length - 1;
    var q = MP.norm(m[2]);
    mList = (c.member_ids || []).filter(function (id) { return id !== S.me.id; }).map(MP.user).filter(function (u) { return !q || MP.norm(u.name).indexOf(q) >= 0; }).slice(0, 6);
    if (!mList.length) { mPop.hidden = true; return; }
    mIdx = 0; drawMentions();
  }
  function drawMentions() {
    mPop.replaceChildren.apply(mPop, mList.map(function (u, i) {
      return el('button', { type: 'button', class: i === mIdx ? 'on' : '', onpointerdown: function (e) { e.preventDefault(); pickMention(u); } }, MP.avatar(u, 'sm'), el('span', null, el('b', { text: u.name }), u.title ? el('small', { text: u.title }) : null));
    }));
    mPop.hidden = false;
  }
  function pickMention(u) {
    var pos = text.selectionStart;
    text.value = text.value.slice(0, mStart) + '@' + u.name + ' ' + text.value.slice(pos);
    var at = mStart + u.name.length + 2; text.setSelectionRange(at, at);
    mPop.hidden = true; text.focus(); composerState();
  }
  function mentionKeys(e) {
    if (mPop.hidden) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mIdx = (mIdx + (e.key === 'ArrowDown' ? 1 : -1) + mList.length) % mList.length; drawMentions(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mList[mIdx]); return true; }
    if (e.key === 'Escape') { mPop.hidden = true; return true; }
    return false;
  }

  /* ------------------------------------------------------------ Sending (optimistic, ordered, with an offline queue) */

  var SYS_ICON = { design: 'eye', file: 'download', invoice: 'file', join: 'user', contract: 'edit' };
  var seq = 0, queue = Promise.resolve();
  function nowStamp() { var d = new Date(); return S.today + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }
  /** o: {body, file, transcript, reply, album, asFile, channel} */
  function sendNow(o) {
    var channel = o.channel || current, f = o.file;
    var m = { id: 'tmp' + (++seq), mine: true, pending: true, body: o.body || '', author: S.me.name, user_id: S.me.id, created_at: nowStamp(), seen_by: 0,
      reply: o.reply ? { id: o.reply.id, author: o.reply.author, text: snippet(o.reply), kind: kindOf(o.reply), mine: o.reply.mine } : null,
      album: o.album || '', as_file: !!o.asFile, reactions: [],
      file: f ? { url: URL.createObjectURL(f), name: f.name, mime: f.type || 'application/octet-stream', size: f.size, image: /^image\//.test(f.type) } : null };
    m.o = o; m.channel = channel;
    if (channel === current) {
      var e = $('.empty', box); if (e) e.remove();
      place(m, true); decorate();
      box.scrollTop = box.scrollHeight;
    }
    post(m);
    return m;
  }
  /** At most three files go up at once; the rest wait their turn (a hundred photos don't choke the connection). */
  var running = 0, waiting = [];
  function slot(job) {
    return new Promise(function (resolve, reject) {
      function go() {
        running++;
        job().then(resolve, reject).then(function () { running--; if (waiting.length) waiting.shift()(); });
      }
      if (running < 3) go(); else waiting.push(go);
    });
  }
  function post(m) {
    var o = m.o, f = o.file, channel = m.channel;
    var up = f && !o.fileId ? slot(function () { return MP.uploadChunked('chat-upload', f, { context_id: channel }, function (p) { var r = rowsById[m.id]; if (r && r._bar) $('i', r._bar).style.width = p * 100 + '%'; }); }) : Promise.resolve(o.fileId ? { id: o.fileId } : null);
    // Posts go one after another so messages keep their order: each waits for the one sent before it.
    var before = queue;
    var done = up.then(function (file) {
      if (file) o.fileId = file.id;
      return before.then(function () {
        return MP.api('channels/' + channel + '/messages', { method: 'POST', body: { body: m.body, file_id: file ? file.id : 0, transcript: typeof o.transcript === 'function' ? o.transcript() : '', reply_to: o.reply ? o.reply.id : 0, album: o.album || '', as_file: o.asFile ? 1 : 0 } });
      });
    });
    queue = done.catch(function () {});
    done.then(function (real) {
      dropOutbox(m);
      if (m.file) setTimeout(function () { URL.revokeObjectURL(m.file.url); }, 60000);
      if (channel !== current) return MP.loadChannels();
      swapReal(m, real);
      MP.loadChannels();
    }).catch(function (err) {
      var offline = !navigator.onLine || /اینترنت/.test(err.message || '');
      m.pending = false; m.failed = true; m.offline = offline;
      if (offline && !f) keepOutbox(m);
      if (channel === current) update(m);
      if (!offline) MP.soft(err);
    });
  }
  /** The real message takes the place of its stand-in (keeping an album together). */
  function swapReal(m, real) {
    var r = rowsById[m.id];
    delete msgs[m.id]; delete rowsById[m.id];
    if (msgs[real.id]) { // the held request was faster
      if (r && !Object.keys(rowsById).some(function (k) { return rowsById[k] === r; })) r.remove();
      decorate(); return;
    }
    msgs[real.id] = real; lastId = Math.max(lastId, real.id); firstId = firstId || real.id;
    if (r) {
      rowsById[real.id] = r;
      update(real);
    } else place(real, false);
    Object.keys(albumRows).forEach(function (k) { var a = albumRows[k]; var i = a.ids.indexOf(m.id); if (i >= 0) a.ids[i] = real.id; });
    decorate();
  }
  function retry(m) { m.failed = false; m.pending = true; update(m); post(m); }
  // Offline: text messages wait in the browser and go as soon as the connection is back.
  function outbox() { try { return JSON.parse(localStorage.getItem('mp_outbox') || '[]'); } catch (e) { return []; } }
  function keepOutbox(m) { var l = outbox().filter(function (x) { return x.k !== m.id; }); l.push({ k: m.id, c: m.channel, b: m.body, r: m.o.reply ? m.o.reply.id : 0 }); try { localStorage.setItem('mp_outbox', JSON.stringify(l)); } catch (e) { /* full */ } }
  function dropOutbox(m) { var l = outbox(), n = l.filter(function (x) { return x.k !== m.id; }); if (n.length !== l.length) try { localStorage.setItem('mp_outbox', JSON.stringify(n)); } catch (e) { /* ignore */ } }
  window.addEventListener('online', function () {
    Object.keys(msgs).forEach(function (k) { var m = msgs[k]; if (m.failed && m.offline) retry(m); });
    flushOutbox();
  });
  function flushOutbox() {
    var l = outbox(); if (!l.length || !navigator.onLine) return;
    try { localStorage.removeItem('mp_outbox'); } catch (e) { /* ignore */ }
    l.forEach(function (x) { if (!Object.keys(msgs).some(function (k) { return k === x.k; })) sendNow({ body: x.b, channel: x.c, reply: x.r ? { id: x.r } : null }); });
  }
  setTimeout(flushOutbox, 4000);

  $('#composer').onsubmit = function (e) {
    e.preventDefault();
    var body = text.value.trim();
    if (!current) return;
    if (editing) {
      var m = editing;
      if (!body && !m.file) return;
      clearCtx(false); text.value = draftOf(current); autoGrow(); composerState();
      if (body === m.body) return;
      update(Object.assign({}, m, { body: body, edited: true }));
      MP.api('messages/' + m.id + '/edit', { method: 'POST', body: { body: body } }).then(update).catch(function (err) { update(m); MP.soft(err); });
      return;
    }
    if (!body) return;
    text.value = ''; autoGrow(); sendActivity('idle'); saveDraft(current, ''); mPop.hidden = true; pop.hidden = true;
    var r = replyTo; clearCtx(false); composerState();
    sendNow({ body: body, reply: r });
    if (MP.isMobile()) text.focus();
  };
  $('#composer .composer-send').addEventListener('pointerdown', function (e) { if (MP.isMobile()) e.preventDefault(); }); // keep the keyboard open

  /* ------------------------------------------------------------ Attach: photos (album) or files, like Telegram */

  // Each picker sends its own way: gallery → photos, «without compression» and «file» → as files.
  var pickMode = '';
  ['composer-file', 'composer-media', 'composer-camera', 'composer-doc'].forEach(function (id) {
    $('#' + id).onchange = function (e) { var files = Array.prototype.slice.call(e.target.files || []); e.target.value = ''; closeAttach(); sendSheet(files, pickMode); pickMode = ''; };
  });

  /* ------------------------------------------------------------ Attach sheet (Telegram's paperclip) */

  var attach = $('#attach-sheet'), attachLayer = null;
  function closeAttach() {
    if (attach.hidden) return;
    attach.classList.remove('in'); setTimeout(function () { attach.hidden = true; attach.replaceChildren(); }, 180);
    if (attachLayer) { var l = attachLayer; attachLayer = null; MP.popLayer(l); }
  }
  function pick(id, mode) { pickMode = mode; $('#' + id).click(); }
  function openAttach() {
    if (!current) return;
    if (!attach.hidden) { closeAttach(); return; }
    var c = chan(), mobile = MP.isMobile();
    var row = function (ic, color, title, sub, fn) {
      return el('button', { type: 'button', class: 'as-row', onclick: fn }, el('span', { class: 'as-ico ' + color, html: icon(ic) }), el('span', { class: 'as-copy' }, el('b', { text: title }), el('small', { text: sub })));
    };
    var recent = el('div', { class: 'as-recent' }, el('div', { class: 'as-sec', text: 'فایل‌های اخیر این گفت‌وگو' }), el('div', { class: 'as-list' }, MP.skeleton(1)));
    var tab = function (ic, label, fn, on) { return el('button', { type: 'button', class: 'as-tab' + (on ? ' on' : ''), onclick: fn }, MP.iconEl(ic), el('span', { text: label })); };
    attach.replaceChildren(
      el('div', { class: 'as-shade', onclick: closeAttach }),
      el('div', { class: 'as-sheet', role: 'dialog', 'aria-label': 'پیوست' },
        el('div', { class: 'as-handle' }),
        el('div', { class: 'as-body' },
          el('div', { class: 'as-card' },
            row('image', 'green', 'گالری', 'عکس و ویدیو، فشرده و سریع؛ چند عکس با هم آلبوم می‌شوند', function () { pick('composer-media', 'photo'); }),
            row('file', 'blue', 'فایل از حافظه', 'PDF، ورد، اکسل، فایل طراحی و هر فایلی، بدون فشرده‌سازی', function () { pick('composer-doc', 'file'); }),
            row('download', 'orange', 'گالری بدون فشرده‌سازی', 'عکس با کیفیت اصلی، به‌صورت فایل', function () { pick('composer-media', 'file'); })),
          recent),
        el('div', { class: 'as-tabs' },
          tab('image', 'گالری', function () { pick('composer-media', 'photo'); }, true),
          tab('file', 'فایل', function () { pick('composer-doc', 'file'); }),
          mobile ? tab('eye', 'دوربین', function () { pick('composer-camera', 'photo'); }) : null,
          c && c.type !== 'saved' ? tab('video', 'جلسه', function () { closeAttach(); startMeeting(c); }) : null,
          tab('tasks', 'تسک', function () { closeAttach(); MP.taskForm({ projectId: c && c.project_id ? c.project_id : 0 }); }))));
    attach.hidden = false; requestAnimationFrame(function () { attach.classList.add('in'); });
    attachLayer = MP.pushLayer(function () { attachLayer = null; closeAttach(); });
    MP.emojify(attach);
    // Files already in this chat: one tap sends the same file again (no upload).
    MP.api('channels/' + current + '/media', { query: { kind: 'files' } }).then(function (l) {
      var list = $('.as-list', recent); if (!list) return;
      if (!l.length) { recent.remove(); return; }
      list.replaceChildren.apply(list, l.slice(0, 12).map(function (x) {
        var f = x.file, ext = (f.name.split('.').pop() || '').slice(0, 4).toLowerCase();
        return el('button', { type: 'button', class: 'as-file', onclick: function () { closeAttach(); var ch = current; MP.api('messages/' + x.id + '/forward', { method: 'POST', body: { channel_ids: [ch], resend: 1 } }).then(function () { MP.loadChannels(); }).catch(MP.soft); } },
          f.image ? el('img', { class: 'as-thumb', src: f.url, alt: '', loading: 'lazy' }) : el('span', { class: 'as-ext', text: ext || 'file' }),
          el('span', { class: 'as-copy' }, el('b', { text: f.name, dir: 'auto' }), el('small', { text: MP.fileSize(f.size) + ' · ' + listTime(x.created_at) })));
      }));
    }).catch(function () { recent.remove(); });
  }
  $('#composer-clip').onclick = openAttach;
  text.addEventListener('paste', function (e) {
    var files = Array.prototype.slice.call((e.clipboardData && e.clipboardData.files) || []);
    if (!files.length) return;
    e.preventDefault();
    sendSheet(files.map(function (f, i) { return f.name && f.name !== 'image.png' ? f : new File([f], 'paste-' + Date.now() + (i ? '-' + i : '') + '.' + ((f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')), { type: f.type }); }));
  });
  (function () {
    var pane = box.parentNode, depth = 0;
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
    pane.addEventListener('dragenter', function (e) { if (!hasFiles(e) || !current) return; e.preventDefault(); depth++; pane.classList.add('chat-drop'); });
    pane.addEventListener('dragover', function (e) { if (hasFiles(e) && current) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    pane.addEventListener('dragleave', function () { if (--depth <= 0) { depth = 0; pane.classList.remove('chat-drop'); } });
    pane.addEventListener('drop', function (e) { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; pane.classList.remove('chat-drop'); sendSheet(Array.prototype.slice.call(e.dataTransfer.files)); });
  })();
  function isPic(f) { return /^image\/(jpeg|png|webp|gif|bmp|heic|heif)$/i.test(f.type) || /\.(jpe?g|png|webp|gif|heic)$/i.test(f.name); }
  /** Before sending: thumbnails, «عکس» (compressed, grouped in an album) or «فایل» (original), and a caption. */
  function sendSheet(files, want) {
    if (!current || !files.length) return;
    var list = files.slice(), pics = list.filter(isPic).length, mode = pics && want !== 'file' ? 'photo' : 'file', group = true;
    var grid = el('div', { class: 'ss-grid' }), cap = el('textarea', { class: 'ss-cap', rows: 1, placeholder: 'توضیح (اختیاری)…', maxlength: 4000, dir: 'auto' });
    if (text.value.trim() && !editing) { cap.value = text.value.trim(); }
    var seg = el('div', { class: 'seg ss-seg', role: 'tablist' });
    var groupBox = el('label', { class: 'check ss-group' }, el('input', { type: 'checkbox', checked: true, onchange: function (e) { group = e.target.checked; } }), el('span', { text: 'گروه‌بندی در یک آلبوم' }));
    var title = el('span');
    function draw() {
      grid.replaceChildren.apply(grid, list.map(function (f, i) {
        var pic = isPic(f) && mode === 'photo';
        var cell = el('div', { class: 'ss-item' + (pic ? ' pic' : ' doc') }, pic ? el('img', { src: f._url || (f._url = URL.createObjectURL(f)), alt: '' }) : el('span', { class: 'ss-doc' }, el('b', { text: (f.name.split('.').pop() || '').slice(0, 4).toUpperCase() }), el('small', { text: f.name, dir: 'auto' }), el('small', { text: MP.fileSize(f.size) })),
          el('button', { type: 'button', class: 'ss-x', 'aria-label': 'حذف', text: '×', onclick: function () { list.splice(i, 1); if (!list.length) MP.dialog.close(); else { pics = list.filter(isPic).length; if (!pics) mode = 'file'; draw(); } } }));
        return cell;
      }));
      seg.hidden = !pics;
      seg.replaceChildren(
        el('button', { type: 'button', 'aria-selected': String(mode === 'photo'), text: 'ارسال به‌صورت عکس', onclick: function () { mode = 'photo'; draw(); } }),
        el('button', { type: 'button', 'aria-selected': String(mode === 'file'), text: 'ارسال به‌صورت فایل', onclick: function () { mode = 'file'; draw(); } }));
      groupBox.hidden = !(mode === 'photo' && pics > 1);
      title.textContent = mode === 'photo' && pics === list.length ? (list.length > 1 ? fa(list.length) + ' عکس' : 'یک عکس') : (list.length > 1 ? fa(list.length) + ' فایل' : 'یک فایل');
    }
    draw();
    var hint = el('p', { class: 'ss-hint' });
    var go = el('button', { type: 'submit', class: 'btn btn-primary', html: icon('send') + 'ارسال' });
    var f = el('form', { class: 'ss' }, el('div', { class: 'ss-top' }, title, seg), grid, groupBox, hint, el('div', { class: 'ss-foot' }, cap, go));
    hint.textContent = 'عکس: کم‌حجم و زود می‌رسد، داخل گفت‌وگو نمایش داده می‌شود. فایل: همان فایل اصلی با کیفیت کامل.';
    f.onsubmit = function (e) {
      e.preventDefault();
      var channel = current, caption = cap.value.trim(), r = replyTo;
      if (caption && caption === text.value.trim()) { text.value = ''; autoGrow(); saveDraft(channel, ''); composerState(); }
      clearCtx(false);
      MP.dialog.close();
      var photos = mode === 'photo' ? list.filter(isPic) : [], others = list.filter(function (x) { return photos.indexOf(x) < 0; });
      // Albums hold up to ten photos, as in Telegram; more photos make more albums.
      var albums = [], stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      photos.forEach(function (x, i) { albums.push(photos.length > 1 && group ? 'a' + stamp + Math.floor(i / 10) : ''); });
      // Caption: under the (first) album or on the last file, as in Telegram.
      var capOnPhotos = photos.length && (group || photos.length === 1) && !others.length;
      // Photos are shrunk one by one (dozens of big photos at once would run a phone out of memory), each sent as soon as it is ready.
      var chain = Promise.resolve();
      photos.forEach(function (x, i) {
        chain = chain.then(function () { return shrink(x); }).then(function (small) {
          sendNow({ file: small, album: albums[i], body: capOnPhotos && i === 0 ? caption : '', reply: i === 0 ? r : null, channel: channel });
        });
      });
      chain.then(function () {
        others.forEach(function (x, i) { sendNow({ file: x, asFile: true, body: !capOnPhotos && i === others.length - 1 ? caption : '', reply: !photos.length && i === 0 ? r : null, channel: channel }); });
      });
    };
    MP.dialog.open('ارسال', f, { focus: false });
    cap.focus();
  }
  /** «عکس»: long side at most 2560 px, JPEG ~85% (GIFs and small images stay as they are). */
  function shrink(file) {
    if (/gif|svg/i.test(file.type) || file.size < 350 * 1024) return Promise.resolve(file);
    return new Promise(function (resolve) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 2560, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
        var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(function (b) { resolve(b && b.size < file.size ? new File([b], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  /* ------------------------------------------------------------ Message gestures and menu */

  var selecting = false, selected = {};
  /** Tap (select mode), double tap (❤️), long press / right click (menu), swipe toward the start (reply). */
  function wireRow(r, list) {
    var m = list[list.length - 1], first = list[0];
    var b = $('.bubble', r), lastTap = 0, timer = 0, st = null, LIMIT = 64;
    r.addEventListener('click', function (e) {
      if (selecting) { e.preventDefault(); toggleSel(r, list); return; }
      if (e.target.closest('a, button, video, audio, .v-msg')) return;
      var now = Date.now();
      if (now - lastTap < 320) { lastTap = 0; react(m, '❤️'); heartPop(b); } else lastTap = now;
    });
    r.addEventListener('contextmenu', function (e) { e.preventDefault(); if (!selecting) msgMenu(first, list, r); });
    r.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      st = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, on: false };
      if (e.pointerType !== 'mouse') timer = setTimeout(function () { timer = 0; st = null; MP.haptic(15); if (selecting) toggleSel(r, list); else msgMenu(first, list, r); }, 450);
    });
    r.addEventListener('pointermove', function (e) {
      if (!st || e.pointerId !== st.id) return;
      var dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { clearTimeout(timer); timer = 0; }
      if (!st.on) { if (Math.abs(dy) > 12 || dx > 12) { st = null; return; } if (dx > -14 || e.pointerType === 'mouse') return; st.on = true; try { r.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ } b.style.transition = 'none'; }
      st.dx = Math.max(-100, Math.min(0, dx));
      b.style.transform = 'translateX(' + st.dx + 'px)';
      var armed = st.dx < -LIMIT;
      if (armed && !r.classList.contains('rp-armed')) MP.haptic(10);
      r.classList.toggle('rp-armed', armed); r.classList.add('rp-reveal');
    });
    function end() {
      clearTimeout(timer); timer = 0;
      if (!st) return; var s = st; st = null; if (!s.on) return;
      b.style.transition = 'transform .25s cubic-bezier(.2,.8,.2,1)'; b.style.transform = '';
      setTimeout(function () { r.classList.remove('rp-reveal', 'rp-armed'); }, 240);
      if (s.dx < -LIMIT) startReply(first);
    }
    r.addEventListener('pointerup', end);
    r.addEventListener('pointercancel', function () { clearTimeout(timer); timer = 0; if (st && st.on) { b.style.transform = ''; r.classList.remove('rp-reveal', 'rp-armed'); } st = null; });
  }
  function heartPop(b) { var h = el('span', { class: 'heart-pop', text: '❤️' }); b.append(h); setTimeout(function () { h.remove(); }, 800); }

  function react(m, emoji) {
    if (typeof m.id !== 'number') return;
    // Shown at once; the answer brings the real counts.
    var rs = (m.reactions || []).map(function (x) { return Object.assign({}, x); }), had = rs.filter(function (x) { return x.mine; })[0];
    rs.forEach(function (x) { if (x.mine) { x.mine = false; x.count--; } });
    if (!had || had.emoji !== emoji) { var t = rs.filter(function (x) { return x.emoji === emoji; })[0]; if (t) { t.count++; t.mine = true; } else rs.push({ emoji: emoji, count: 1, mine: true, names: [S.me.name] }); }
    update(Object.assign({}, m, { reactions: rs.filter(function (x) { return x.count > 0; }) }));
    MP.api('messages/' + m.id + '/react', { method: 'POST', body: { emoji: emoji } }).then(update).catch(function (e) { update(m); MP.soft(e); });
  }
  function pin(m, on) {
    MP.api('messages/' + m.id + '/pin', { method: 'POST', body: { on: on } }).then(function (d) { showPinned(d.pinned); MP.toast(on ? 'پیام سنجاق شد' : 'سنجاق برداشته شد', { icon: 'pin' }); }).catch(MP.soft);
  }
  function copyText(t) {
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { MP.toast('کپی شد', { icon: 'check' }); }, function () {
      var ta = el('textarea', { value: t, style: { position: 'fixed', opacity: '0' } }); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); MP.toast('کپی شد');
    });
  }
  var REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏', '🎉', '✅'];
  /** Telegram's message menu: a reaction strip, then reply, copy, edit, pin, forward, to task, select, delete. */
  function msgMenu(m, list, r) {
    if (openMenu) openMenu();
    var last = list[list.length - 1], c = chan(), k = kindOf(m), mineNum = typeof m.id === 'number';
    if (!mineNum) return;
    var body = list.map(function (x) { return x.body; }).filter(Boolean)[0] || '';
    var items = [];
    items.push(['reply', 'پاسخ', function () { startReply(m); }]);
    if (body) items.push(['copy', 'کپی متن', function () { copyText(body); }]);
    if (m.mine && !m.kind && k !== 'voice') items.push(['edit', 'ویرایش', function () { startEdit(list.filter(function (x) { return x.body; })[0] || m); }]);
    items.push(pinned && pinned.id === m.id ? ['pin', 'برداشتن سنجاق', function () { pin(m, false); }] : ['pin', 'سنجاق کردن', function () { pin(m, true); }]);
    items.push(['forward', 'فوروارد', function () { forwardPick(list); }]);
    if (c && c.type !== 'saved') items.push(['bookmark', 'ذخیره در پیام‌های ذخیره‌شده', function () { forwardTo(list, null); }]);
    if (body || m.file) items.push(['tasks', 'تبدیل به تسک', function () { toTask(m, body); }]);
    if (m.file && k !== 'voice') items.push(['download', 'دانلود', function () { list.forEach(function (x) { if (x.file) window.open(x.file.url + (x.file.url.indexOf('?') >= 0 ? '&' : '?') + 'download=1', '_blank'); }); }]);
    if (body) items.push(['speaker', 'خواندن با صدا', function () { speak(m, el('span')); }]);
    if (m.mine && isGroup(c)) items.push(['checks', 'دیده‌شده توسط…', function () { seenList(m); }]);
    items.push(['checks', 'انتخاب', function () { startSelect(r, list); }]);
    if ((m.mine && !m.archived) || S.manager) items.push(['trash', 'حذف', function () { list.forEach(function (x, i) { if (i === 0) askDelete(x); else if (!S.manager) archiveMsg(x, true); }); }, true]);
    var strip = el('div', { class: 'ctx-reacts' }, REACTIONS.map(function (e) {
      var mine = (last.reactions || []).some(function (x) { return x.mine && x.emoji === e; });
      return el('button', { type: 'button', class: mine ? 'on' : '', 'aria-label': e, onclick: function () { close(); react(last, e); } }, MP.emojiImg(e));
    }));
    var menu = el('div', { class: 'ctx-menu msg-menu', role: 'menu' }, strip,
      items.map(function (it) {
        var b = el('button', { type: 'button', role: 'menuitem', class: it[3] ? 'danger' : '', html: icon(it[0]), onclick: function () { close(); it[2](); } });
        b.append(el('span', { text: it[1] }));
        return b;
      }));
    var shade = el('div', { class: 'ctx-shade', onclick: function () { close(); } });
    r.classList.add('ctx-lifted');
    document.body.append(shade, menu);
    var rect = $('.bubble', r).getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight, pad = 8;
    var left = m.mine ? Math.min(rect.right - w, innerWidth - w - pad) : rect.left;
    left = Math.max(pad, Math.min(left, innerWidth - w - pad));
    var top = rect.bottom + 6 + h > innerHeight - pad ? Math.max(pad, rect.top - h - 6) : rect.bottom + 6;
    if (top < pad) top = pad;
    menu.style.left = left + 'px'; menu.style.top = top + 'px';
    menu.style.transformOrigin = (m.mine ? 'right' : 'left') + (top < rect.top ? ' bottom' : ' top');
    requestAnimationFrame(function () { menu.classList.add('in'); });
    function key(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', close);
    box.addEventListener('scroll', close, { once: true });
    function close() {
      if (openMenu !== close) return;
      openMenu = null;
      document.removeEventListener('keydown', key, true); window.removeEventListener('resize', close);
      r.classList.remove('ctx-lifted'); shade.remove(); menu.remove();
    }
    openMenu = close;
  }
  function seenList(m) {
    var body = MP.dialog.open('دیده‌شده توسط', MP.skeleton(2));
    MP.api('messages/' + m.id + '/seen').then(function (l) {
      body.replaceChildren(l.length ? el('div', { class: 'menu' }, l.map(function (u) { return el('div', { class: 'seen-row' }, MP.avatar(u, 'sm'), el('span', { text: u.name })); })) : el('p', { class: 'muted', text: 'هنوز کسی ندیده است.' }));
    }).catch(MP.soft);
  }
  function toTask(m, body) {
    var c = chan(), t = (body || (m.file ? m.file.name : '')).replace(/\s+/g, ' ').trim();
    MP.taskForm({ taskTitle: t.slice(0, 190), projectId: c && c.project_id ? c.project_id : 0 });
  }

  /* ------------------------------------------------------------ Forward */

  function forwardTo(list, channelId) {
    var go = channelId ? Promise.resolve({ id: channelId }) : MP.api('channels/saved', { method: 'POST' });
    return go.then(function (c) {
      var ids = list.map(function (x) { return x.id; }).filter(function (x) { return typeof x === 'number'; });
      return ids.reduce(function (p, id) { return p.then(function () { return MP.api('messages/' + id + '/forward', { method: 'POST', body: { channel_ids: [c.id] } }); }); }, Promise.resolve()).then(function () {
        MP.loadChannels();
        var target = chan(c.id) || c;
        MP.toast(channelId ? 'به «' + (target.title || 'گفت‌وگو') + '» فوروارد شد' : 'در پیام‌های ذخیره‌شده ذخیره شد', { icon: 'check', action: 'باز کردن', onAction: function () { select(c.id); } });
      });
    }).catch(MP.soft);
  }
  function forwardPick(list) {
    var q = el('input', { type: 'search', class: 'input', placeholder: 'جستجوی گفت‌وگو…' }), out = el('div', { class: 'fw-list' });
    function draw() {
      var nq = MP.norm(q.value);
      var chs = S.channels.filter(function (c) { return !c.archived && (!nq || MP.norm(c.title).indexOf(nq) >= 0); })
        .sort(function (a, b) { return (b.type === 'saved') - (a.type === 'saved') || (b.last ? b.last.id : 0) - (a.last ? a.last.id : 0); });
      if (!chs.some(function (c) { return c.type === 'saved'; }) && (!nq || 'پیام‌های ذخیره‌شده'.indexOf(q.value) >= 0)) chs.unshift({ id: 0, type: 'saved', title: 'پیام‌های ذخیره‌شده' });
      out.replaceChildren.apply(out, chs.map(function (c) {
        return el('button', { type: 'button', class: 'chat-item', onclick: function () { MP.dialog.close(); if (selecting) endSelect(); forwardTo(list, c.id); } }, channelIcon(c), el('span', { class: 'ci-copy' }, el('strong', { text: c.title }), el('small', { text: c.type === 'saved' ? 'فقط خودتان' : c.type === 'direct' ? 'خصوصی' : fa(c.members || 0) + ' عضو' })));
      }));
    }
    q.oninput = draw; draw();
    MP.dialog.open(list.length > 1 ? 'فوروارد ' + fa(list.length) + ' پیام به…' : 'فوروارد به…', el('div', { class: 'form' }, q, out));
  }

  /* ------------------------------------------------------------ Select several messages */

  function startSelect(r, list) { selecting = true; selected = {}; layout.classList.add('selecting'); $('#chat-select').hidden = false; toggleSel(r, list); }
  function toggleSel(r, list) {
    var on = !r.classList.contains('sel');
    r.classList.toggle('sel', on);
    list.forEach(function (x) { if (on) selected[x.id] = x; else delete selected[x.id]; });
    var n = Object.keys(selected).length;
    if (!n) { endSelect(); return; }
    $('#sel-count').textContent = fa(n) + ' پیام';
    $('#sel-delete').hidden = !Object.keys(selected).every(function (k) { return selected[k].mine || S.manager; });
  }
  function endSelect() {
    selecting = false; selected = {}; layout.classList.remove('selecting'); $('#chat-select').hidden = true;
    $$('.msg-row.sel', box).forEach(function (r) { r.classList.remove('sel'); });
  }
  function selList() { return Object.keys(selected).map(function (k) { return selected[k]; }).sort(function (a, b) { return a.id - b.id; }); }
  $('#sel-close').onclick = endSelect;
  $('#sel-copy').onclick = function () { var l = selList(); copyText(l.map(function (m) { return (isGroup(chan()) ? m.author + ': ' : '') + (m.body || snippet(m)); }).join('\n')); endSelect(); };
  $('#sel-forward').onclick = function () { forwardPick(selList()); };
  $('#sel-delete').onclick = function () {
    var l = selList();
    MP.confirm('حذف ' + fa(l.length) + ' پیام', 'پیام‌های انتخاب‌شده از گفت‌وگو برداشته و آرشیو می‌شوند.', 'حذف').then(function (ok) { if (ok) { l.forEach(function (m) { archiveMsg(m, true); }); endSelect(); } });
  };

  /* ------------------------------------------------------------ Find in this chat */

  var hits = [], hitAt = 0, findTimer2 = 0;
  function openFind() {
    $('#chat-find').hidden = false; layout.classList.add('finding');
    var q = $('#chat-find-q'); q.value = ''; q.focus(); $('#chat-find-n').textContent = '';
  }
  function closeFind() { $('#chat-find').hidden = true; layout.classList.remove('finding'); $('#chat-find-list').hidden = true; hits = []; }
  $('#chat-find-close').onclick = closeFind;
  $('#chat-find-q').oninput = function () {
    clearTimeout(findTimer2);
    var q = this.value.trim(), list = $('#chat-find-list');
    if (q.length < 2) { hits = []; list.hidden = true; $('#chat-find-n').textContent = ''; return; }
    findTimer2 = setTimeout(function () {
      MP.api('channels/' + current + '/search', { query: { q: q } }).then(function (l) {
        hits = l; hitAt = 0;
        $('#chat-find-n').textContent = l.length ? fa(1) + ' از ' + fa(l.length) : 'نتیجه‌ای نیست';
        list.replaceChildren.apply(list, l.map(function (h, i) {
          return el('button', { type: 'button', onclick: function () { hitAt = i; showHit(); list.hidden = true; } }, el('b', { text: h.author }), el('span', { text: h.text, dir: 'auto' }), el('time', { text: listTime(h.created_at) }));
        }));
        list.hidden = !l.length;
      }).catch(function () {});
    }, 300);
  };
  $('#chat-find-q').onkeydown = function (e) { if (e.key === 'Enter' && hits.length) { e.preventDefault(); $('#chat-find-list').hidden = true; showHit(); hitAt = (hitAt + 1) % hits.length; } if (e.key === 'Escape') closeFind(); };
  function showHit() { if (!hits.length) return; $('#chat-find-n').textContent = fa(hitAt + 1) + ' از ' + fa(hits.length); jumpTo(hits[hitAt].id); }
  $('#chat-find-up').onclick = function () { if (!hits.length) return; hitAt = (hitAt + 1) % hits.length; $('#chat-find-list').hidden = true; showHit(); };
  $('#chat-find-down').onclick = function () { if (!hits.length) return; hitAt = (hitAt - 1 + hits.length) % hits.length; $('#chat-find-list').hidden = true; showHit(); };

  /* ------------------------------------------------------------ Gallery (all photos of the chat, swipe between them) */

  function gallery(startId) {
    var photos = Object.keys(msgs).map(function (k) { return msgs[k]; }).filter(function (m) { return kindOf(m) === 'photo' && !m.deleted && m.file; }).sort(function (a, b) { return (typeof a.id === 'number' ? a.id : 1e15) - (typeof b.id === 'number' ? b.id : 1e15); });
    var i = Math.max(0, photos.map(function (m) { return m.id; }).indexOf(startId));
    if (!photos.length) return;
    var img = el('img', { alt: '' }), cap = el('div', { class: 'gv-cap' }), count = el('span', { class: 'gv-n' });
    var dl = el('a', { class: 'icon-btn gv-btn', 'aria-label': 'دانلود', html: icon('download'), target: '_blank', rel: 'noopener' });
    var v = el('div', { class: 'gv', role: 'dialog', 'aria-label': 'عکس‌ها' },
      el('div', { class: 'gv-top' }, el('button', { type: 'button', class: 'icon-btn gv-btn', 'aria-label': 'بستن', html: icon('close'), onclick: close }), count, el('span', { class: 'gv-sp' }),
        el('button', { type: 'button', class: 'icon-btn gv-btn', 'aria-label': 'رفتن به پیام', html: icon('chat'), onclick: function () { var id = photos[i].id; close(); jumpTo(id); } }), dl),
      el('button', { type: 'button', class: 'gv-nav gv-next', 'aria-label': 'بعدی', html: icon('left'), onclick: function () { go(1); } }),
      el('button', { type: 'button', class: 'gv-nav gv-prev', 'aria-label': 'قبلی', html: icon('right'), onclick: function () { go(-1); } }),
      el('div', { class: 'gv-stage' }, img), cap);
    var z = MP.zoomable(img, $('.gv-stage', v));
    function show() {
      var m = photos[i]; z.reset(); img.src = m.file.url;
      count.textContent = fa(i + 1) + ' از ' + fa(photos.length);
      cap.replaceChildren(el('b', { text: m.mine ? 'شما' : m.author }), el('small', { text: MP.relTime(m.created_at) }));
      if (m.body) cap.append(el('p', { text: m.body, dir: 'auto' }));
      dl.href = m.file.url + (m.file.url.indexOf('?') >= 0 ? '&' : '?') + 'download=1';
      $('.gv-prev', v).hidden = i === 0; $('.gv-next', v).hidden = i === photos.length - 1;
    }
    function go(d) { var n = i + d; if (n < 0 || n >= photos.length) return; i = n; show(); }
    function key(e) { if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') go(1); else if (e.key === 'ArrowRight') go(-1); }
    var sx = null;
    // Swipe for the next photo / down to close — only when not zoomed (zoomed, a drag moves the photo).
    v.addEventListener('pointerdown', function (e) { sx = z.zoomed() || e.target.closest('button, a') ? null : { x: e.clientX, y: e.clientY }; });
    v.addEventListener('pointerup', function (e) { if (!sx) return; var dx = e.clientX - sx.x, dy = e.clientY - sx.y; sx = null; if (z.touched()) return; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1); else if (dy > 120) close(); });
    var layer = MP.pushLayer(function () { layer = null; close(); });
    function close() { document.removeEventListener('keydown', key); v.remove(); if (layer) { var l = layer; layer = null; MP.popLayer(l); } }
    document.addEventListener('keydown', key);
    document.body.append(v); show();
  }

  /* ------------------------------------------------------------ Chat info: members, media, files, links, voice */

  function chatInfo(c) {
    if (!c) return;
    var tabs = [['media', 'رسانه'], ['files', 'فایل‌ها'], ['links', 'لینک‌ها'], ['voice', 'ویس']], tab = 'media';
    var pane = el('div', { class: 'ci-pane' }), seg = el('div', { class: 'seg ci-tabs', role: 'tablist' });
    function load() {
      seg.replaceChildren.apply(seg, tabs.map(function (t) { return el('button', { type: 'button', 'aria-selected': String(t[0] === tab), text: t[1], onclick: function () { tab = t[0]; load(); } }); }));
      pane.replaceChildren(MP.skeleton(2));
      MP.api('channels/' + c.id + '/media', { query: { kind: tab } }).then(function (l) {
        if (!l.length) { pane.replaceChildren(el('p', { class: 'muted ci-none', text: { media: 'عکسی فرستاده نشده', files: 'فایلی فرستاده نشده', links: 'لینکی فرستاده نشده', voice: 'ویسی فرستاده نشده' }[tab] })); return; }
        if (tab === 'media') {
          pane.replaceChildren(el('div', { class: 'ci-grid' }, l.map(function (x) {
            return el('button', { type: 'button', onclick: function () { MP.dialog.close(); if (!msgs[x.id]) { jumpTo(x.id); } else gallery(x.id); } }, el('img', { src: x.file.url, alt: '', loading: 'lazy' }));
          })));
        } else if (tab === 'links') {
          pane.replaceChildren(el('div', { class: 'ci-rows' }, l.map(function (x) {
            return el('div', { class: 'ci-row' }, el('span', { class: 'ci-row-ico', html: icon('send') }), el('span', { class: 'ci-row-copy' }, el('a', { href: x.url, target: '_blank', rel: 'noopener', dir: 'ltr', text: x.url }), el('small', { text: x.author + ' · ' + listTime(x.created_at) })),
              el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'رفتن به پیام', html: icon('chat'), onclick: function () { MP.dialog.close(); jumpTo(x.id); } }));
          })));
        } else {
          pane.replaceChildren(el('div', { class: 'ci-rows' }, l.map(function (x) {
            var f = x.file;
            return el('div', { class: 'ci-row' }, el('span', { class: 'ci-row-ico', html: icon(tab === 'voice' ? 'mic' : 'file') }),
              el('span', { class: 'ci-row-copy' }, el('a', { href: f.url + (f.url.indexOf('?') >= 0 ? '&' : '?') + 'download=1', target: '_blank', rel: 'noopener', text: tab === 'voice' ? 'پیام صوتی ' + x.author : f.name, dir: 'auto' }), el('small', { text: (tab === 'voice' && x.transcript ? x.transcript.slice(0, 60) + ' · ' : '') + MP.fileSize(f.size) + ' · ' + listTime(x.created_at) })),
              el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'رفتن به پیام', html: icon('chat'), onclick: function () { MP.dialog.close(); jumpTo(x.id); } }));
          })));
        }
      }).catch(function (e) { pane.replaceChildren(el('p', { class: 'muted', text: e.message })); });
    }
    var sub = c.type === 'direct' ? lastSeen(c.last_seen) : c.type === 'saved' ? 'فقط خودتان می‌بینید' : fa(c.members) + ' عضو';
    var acts = el('div', { class: 'ci-acts' },
      el('button', { type: 'button', onclick: function () { MP.dialog.close(); text.focus(); } }, MP.iconEl('chat'), el('span', { text: 'پیام' })),
      c.type !== 'saved' ? el('button', { type: 'button', onclick: function () { MP.dialog.close(); setMute(c, !c.muted); } }, MP.iconEl(c.muted ? 'bell' : 'bell-off'), el('span', { text: c.muted ? 'صدادار' : 'بی‌صدا' })) : null,
      c.type !== 'saved' ? el('button', { type: 'button', onclick: function () { MP.dialog.close(); startMeeting(c); } }, MP.iconEl('video'), el('span', { text: 'جلسه' })) : null,
      el('button', { type: 'button', onclick: function () { MP.dialog.close(); openFind(); } }, MP.iconEl('search'), el('span', { text: 'جستجو' })));
    var members = null;
    if (isGroup(c) && c.member_ids && c.member_ids.length) {
      members = el('section', { class: 'ci-members' }, el('h4', { text: fa(c.members) + ' عضو' }), c.member_ids.map(function (id) {
        var u = MP.user(id);
        return el('button', { type: 'button', class: 'ci-member', onclick: function () { if (id !== S.me.id) MP.startDirect(id); } }, MP.avatar(u, 'sm'), el('span', null, el('b', { text: u.name + (id === S.me.id ? ' (شما)' : '') }), el('small', { text: u.title || '' })));
      }));
    }
    var head = el('div', { class: 'ci-head' }, channelIcon(c, 'xl'), el('h3', { text: c.title }), el('small', { class: c.type === 'direct' && sub === 'آنلاین' ? 'online' : '', text: sub }));
    if (c.type === 'direct') head.append(el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'پروفایل', onclick: function () { MP.dialog.close(); MP.openProfile(c.other); } }));
    MP.dialog.open('اطلاعات گفت‌وگو', el('div', { class: 'ci-info' }, head, acts, members, seg, pane), { wide: true, focus: false });
    load();
  }

  /* ------------------------------------------------------------ Phone: swipe right anywhere in a chat to go back */

  (function () {
    var pane = box.parentNode, st = null;
    pane.addEventListener('pointerdown', function (e) {
      if (!MP.isMobile() || !current || e.pointerType === 'mouse' || selecting) return;
      if (e.target.closest('.composer, .chat-head, .v-wave, input, textarea, video')) return;
      st = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, on: false };
    }, true);
    pane.addEventListener('pointermove', function (e) {
      if (!st || e.pointerId !== st.id) return;
      var dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.on) { if (Math.abs(dy) > 14 || dx < -10) { st = null; return; } if (dx < 18) return; st.on = true; pane.style.transition = 'none'; layout.classList.add('swiping-back'); }
      st.dx = Math.max(0, dx);
      pane.style.transform = 'translateX(' + st.dx + 'px)';
    }, true);
    function end(e) {
      if (!st || (e && e.pointerId !== st.id)) return;
      var s = st; st = null; if (!s.on) return;
      var w = pane.offsetWidth || innerWidth, go = s.dx > w * 0.32;
      pane.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)';
      pane.style.transform = go ? 'translateX(' + w + 'px)' : '';
      setTimeout(function () { pane.style.transition = ''; pane.style.transform = ''; layout.classList.remove('swiping-back'); if (go) closeChat(); }, 220);
      if (go) MP.haptic(10);
    }
    pane.addEventListener('pointerup', end, true);
    pane.addEventListener('pointercancel', end, true);
  })();

  /* ------------------------------------------------------------ Delete (archive / managers: erase) */

  function archiveMsg(m, quiet) {
    MP.api('messages/' + m.id, { method: 'DELETE' }).then(function (n) { update(S.manager ? n : Object.assign({}, m, { deleted: true, body: '', file: null })); MP.loadChannels(); if (!quiet) MP.toast('پیام آرشیو شد'); }).catch(MP.soft);
  }
  function eraseMsg(m) {
    MP.confirm('پاک کردن برای همیشه', 'این پیام' + (m.file ? ' و فایل آن' : '') + ' برای همه اعضا و برای همیشه پاک می‌شود و قابل بازگرداندن نیست؛ در «پیام‌های حذف‌شده» پیشخوان هم نمی‌ماند.', 'پاک کن', true).then(function (ok) {
      if (!ok) return;
      MP.api('messages/' + m.id, { method: 'DELETE', body: { hard: 1 } }).then(function () { removeRow(m.id); MP.loadChannels(); MP.toast('پیام برای همیشه پاک شد'); }).catch(MP.soft);
    });
  }
  function askDelete(m) {
    if (!S.manager) {
      MP.confirm('حذف پیام', 'این پیام از گفت‌وگو برداشته و آرشیو می‌شود (پاک نمی‌شود و ناظر همچنان آن را می‌بیند).', 'حذف').then(function (ok) { if (ok) archiveMsg(m); });
      return;
    }
    var who = m.mine ? 'پیام شما' : 'پیام ' + (m.author || 'این فرد');
    MP.dialog.open('مدیریت پیام', el('div', { class: 'form' },
      el('p', { class: 'hint', text: who + (m.body ? ': «' + (m.body.length > 80 ? m.body.slice(0, 80) + '…' : m.body) + '»' : '') }),
      m.archived || m.kind ? null : el('button', { type: 'button', class: 'btn btn-secondary', html: icon('folder') + 'آرشیو پیام (از گفت‌وگو برداشته می‌شود، ناظر همچنان می‌بیند)', onclick: function () { MP.dialog.close(); archiveMsg(m); } }),
      el('button', { type: 'button', class: 'btn btn-danger', html: icon('trash') + 'پاک کردن برای همیشه', onclick: function () { MP.dialog.close(); eraseMsg(m); } })));
  }

  // Composer button: microphone while empty, send once there is text (Telegram).
  composerState();
  $('#chat-back').onclick = closeChat;

  MP.openChannel = function () { return current; };
  MP.clientSettings = function (c) { clientSettings(c); };
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
  /* Project / team group logo: shown in the chat list instead of the generic icon. */
  function groupLogo(c) {
    var file = el('input', { type: 'file', accept: 'image/*', hidden: true });
    var prev = el('div', { class: 'cs-logo cs-hero-logo gl-prev' }, c.logo ? el('img', { src: c.logo, alt: '' }) : el('span', { text: (c.title || '؟').slice(0, 2) }));
    prev.onclick = function () { file.click(); };
    function save(fid) { return MP.api('channels/' + c.id + '/logo', { method: 'POST', body: { logo_file_id: fid } }).then(function () { MP.toast(fid ? 'لوگو ذخیره شد' : 'لوگو حذف شد'); MP.dialog.close(); return MP.loadChannels(); }).catch(MP.soft); }
    file.onchange = function () {
      var f = file.files[0]; if (!f) return;
      prev.classList.add('loading');
      MP.upload('files', f, { context: 'client_logo', context_id: c.id }).then(function (up) { return save(up.id); }).catch(function (e) { prev.classList.remove('loading'); MP.soft(e); });
    };
    MP.dialog.open('لوگوی گروه «' + c.title + '»', el('div', { class: 'gl-box' }, prev, file,
      el('small', { class: 'cs-hint', text: 'روی مربع بزنید و یک تصویر (ترجیحاً مربعی) انتخاب کنید؛ در فهرست گفت‌وگوها به‌جای آیکون نمایش داده می‌شود.' }),
      el('div', { class: 'gl-actions' }, el('button', { type: 'button', class: 'btn btn-primary', html: icon('image') + 'انتخاب تصویر', onclick: function () { file.click(); } }),
        c.logo ? el('button', { type: 'button', class: 'btn btn-secondary', text: 'حذف لوگو', onclick: function () { save(0); } }) : null)));
  }

  /* Client group: its client people (mobile login), the SMS-code requirement and the logo. */
  function esc(t) { return String(t || '').replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }
  function clientSettings(c) {
    var body = MP.dialog.open('مشتری و پرتال', MP.skeleton(3), { wide: true, focus: false });
    function draw(d) {
      var logoBox = el('div', { class: 'cs-logo' }, d.logo ? el('img', { src: d.logo, alt: '' }) : el('span', { text: (d.client || '؟').slice(0, 2) }));
      var file = el('input', { type: 'file', accept: 'image/*', hidden: true });
      file.onchange = function () {
        var f = file.files[0]; if (!f) return;
        MP.upload('files', f, { context: 'client_logo', context_id: c.id }).then(function (up) { return MP.api('channels/' + c.id + '/client', { method: 'POST', body: { logo_file_id: up.id } }); })
          .then(function (n) { MP.toast('لوگو ذخیره شد'); draw(n); }).catch(MP.soft);
      };
      var auth = el('input', { type: 'checkbox', checked: d.auth_required });
      auth.onchange = function () {
        MP.api('channels/' + c.id + '/client', { method: 'POST', body: { auth_required: auth.checked } }).then(function (n) { MP.toast(n.auth_required ? 'از این به بعد مشتری با کد پیامک وارد می‌شود' : 'ورود با کد خاموش شد'); draw(n); })
          .catch(function (err) { auth.checked = !auth.checked; MP.soft(err); });
      };
      var name = el('input', { placeholder: 'مثلاً آقای احمدی', maxlength: 80, required: true });
      var mobile = el('input', { placeholder: '۰۹۱۲ ۱۲۳ ۴۵۶۷', inputmode: 'tel', dir: 'ltr', maxlength: 20, required: true });
      mobile.addEventListener('input', function () { mobile.value = J.faDigits(J.latinDigits(mobile.value).replace(/[^\d ]/g, '')); });
      var sms = el('input', { type: 'checkbox', checked: d.sms });
      var add = el('form', { class: 'cs-add' }, MP.field('نام', name), MP.field('شماره موبایل', mobile), el('button', { type: 'submit', class: 'btn btn-primary', html: icon('plus') + 'افزودن' }));
      add.onsubmit = function (e) {
        e.preventDefault();
        MP.api('channels/' + c.id + '/contacts', { method: 'POST', body: { name: name.value, mobile: J.latinDigits(mobile.value), sms: sms.checked } })
          .then(function (n) {
            var who = name.value;
            if (n.sms_sent === false) MP.toast(who + ' اضافه شد، ولی پیامک ارسال نشد: ' + (n.sms_error || 'خطای سرویس پیامک'), { error: true, duration: 9000 });
            else MP.toast(who + ' اضافه شد' + (n.sms_sent ? ' و لینک برایش پیامک شد' : ''));
            draw(n); if (c.id === current) pull();
          }).catch(MP.soft);
      };
      var list = el('div', { class: 'tio-history' });
      list.classList.add('cs-people');
      if (!d.contacts.length) list.append(el('div', { class: 'cs-empty' }, el('span', { html: icon('user') }), el('p', { text: 'هنوز کسی ثبت نشده' })));
      d.contacts.forEach(function (x) {
        list.append(el('article', { class: 'tpl-card' },
          el('span', { class: 'cs-av', text: (x.name || '؟').slice(0, 1) }),
          el('div', { class: 'tpl-copy' }, el('strong', { text: x.name }), el('small', { dir: 'ltr', class: 'cs-mob', text: J.faDigits(x.mobile) })),
          el('span', { class: 'chip ' + (x.last_login ? 'ok' : ''), text: x.last_login ? 'ورود ' + MP.relTime(x.last_login) : 'هنوز وارد نشده' }),
          el('div', { class: 'tpl-actions' },
            el('button', { type: 'button', class: 'icon-btn sm', title: 'دیدن پرتال مثل ' + x.name, 'aria-label': 'دیدن پرتال مثل ' + x.name, html: icon('eye'), onclick: function () { viewAs(x.id); } }),
            d.sms ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', html: icon('send') + 'پیامک لینک', onclick: function () { MP.api('client-contacts/' + x.id + '/sms', { method: 'POST' }).then(function () { MP.toast('لینک پیامک شد'); }).catch(MP.soft); } }) : null,
            el('button', { type: 'button', class: 'icon-btn sm', title: 'حذف', 'aria-label': 'حذف', html: icon('close'), onclick: function () {
              MP.confirm('حذف از گروه', x.name + ' دیگر نمی‌تواند وارد پرتال شود.', 'حذف').then(function (ok) { if (ok) MP.api('client-contacts/' + x.id, { method: 'DELETE' }).then(draw).catch(MP.soft); });
            } }))));
      });
      var proj = MP.projectSelect('project_id', d.project_id);
      var title = el('input', { class: 'input', value: d.title, maxlength: 160 }), client = el('input', { class: 'input', value: d.client, maxlength: 120 });
      function save(bodyObj, msg) {
        return MP.api('channels/' + c.id + '/client', { method: 'POST', body: bodyObj }).then(function (n) {
          MP.toast(msg); c.title = n.title; c.client_name = n.client; c.project_id = n.project_id; MP.loadChannels(); if (c.id === current) { $('#chat-title').textContent = n.title; } draw(n);
        }).catch(MP.soft);
      }
      proj.onchange = function () { save({ project_id: +proj.value }, +proj.value ? 'گروه به پروژه «' + proj.options[proj.selectedIndex].text + '» وصل شد' : 'اتصال به پروژه برداشته شد'); };
      // Opens the portal in a new tab as this person (or as «a client»); view only, two hours.
      var viewAs = function (contactId) {
        var w = window.open('', '_blank');
        MP.api('channels/' + c.id + '/client/preview', { method: 'POST', body: { contact_id: contactId || 0 } })
          .then(function (r) { if (w) w.location = r.url; else location.href = r.url; })
          .catch(function (err) { if (w) w.close(); MP.soft(err); });
      };
      var copyLink = function () { (navigator.clipboard ? navigator.clipboard.writeText(d.url) : Promise.reject()).then(function () { MP.toast('لینک پرتال کپی شد'); }, function () { MP.toast('لینک را انتخاب و کپی کنید'); }); };
      var p = MP.project(+d.project_id);
      var locked = d.sms || d.auth_required;
      logoBox.classList.add('cs-hero-logo'); logoBox.title = d.logo ? 'تغییر لوگو' : 'بارگذاری لوگو'; logoBox.onclick = function () { file.click(); };
      logoBox.append(el('i', { class: 'cs-logo-edit', html: icon('edit') }));
      body.replaceChildren.apply(body, [
        // Who this is, where it leads, and whether it is protected — at a glance.
        el('section', { class: 'cs-hero' },
          logoBox, file,
          el('div', { class: 'cs-hero-copy' },
            el('small', { text: 'گروه مشتری' }),
            el('h2', { text: d.client || d.title }),
            el('div', { class: 'cs-hero-chips' },
              el('span', { class: 'chip', html: icon('chat') + ' ' + esc(d.title) }),
              p ? el('span', { class: 'chip brand', html: icon('folder') + ' ' + esc(p.name) }) : el('span', { class: 'chip danger', text: 'بدون پروژه' }),
              el('span', { class: 'chip ' + (locked ? 'ok' : 'danger'), html: icon('lock') + (locked ? ' ورود با کد پیامکی' : ' بدون ورود') }),
              el('span', { class: 'chip', html: icon('user') + ' ' + fa(d.contacts.length) + ' نفر' })),
            d.logo ? el('button', { type: 'button', class: 'cs-mini-link', text: 'حذف لوگو', onclick: function () { MP.api('channels/' + c.id + '/client', { method: 'POST', body: { logo_file_id: 0 } }).then(draw).catch(MP.soft); } }) : el('small', { class: 'cs-hint', text: 'روی مربع بزنید تا لوگوی مشتری بارگذاری شود؛ کنار لوگوی مربع در پرتال و صفحه ورود نمایش داده می‌شود.' })),
          el('div', { class: 'cs-linkbox' },
            el('small', { text: 'لینک پرتال' }),
            el('input', { value: d.url, readonly: true, dir: 'ltr', onfocus: function (e) { e.target.select(); } }),
            el('div', { class: 'cs-link-actions' },
              el('button', { type: 'button', class: 'btn btn-primary btn-sm', html: icon('clip') + 'کپی لینک', onclick: copyLink }),
              el('button', { type: 'button', class: 'btn btn-secondary btn-sm', title: 'پرتال را همان‌طور که مشتری می‌بیند باز می‌کند (فقط مشاهده)', html: icon('eye') + 'دیدن مثل مشتری', onclick: function () { viewAs(d.contacts.length ? d.contacts[0].id : 0); } })))),
        d.sms && !d.contacts.length ? el('div', { class: 'cs-alert' }, el('span', { html: icon('alarm') }), el('div', null, el('b', { text: 'هنوز هیچ شماره‌ای ثبت نشده' }), el('small', { text: 'ورود پرتال فقط با کد پیامکی است؛ تا شماره مشتری را اضافه نکنید، کسی نمی‌تواند وارد لینک شود.' }))) : null,
        el('div', { class: 'cs-grid' },
          el('section', { class: 'cs-card' },
            el('header', null, el('span', { class: 'cs-ico', html: icon('user') }), el('div', null, el('h3', { text: 'افراد مشتری' }), el('small', { text: 'هر تعداد نفر، حتی وسط گفت‌وگو؛ هر کدام با شماره خودش وارد می‌شود.' }))),
            list,
            el('div', { class: 'cs-addbox' },
              el('strong', { text: 'افزودن نفر جدید' }),
              add,
              d.sms ? el('label', { class: 'check' }, sms, el('span', { text: 'لینک پرتال برایش پیامک شود' })) : el('p', { class: 'hint', text: 'برای ورود با کد و پیامک لینک، سرویس پیامک را در تنظیمات افزونه فعال کنید.' }))),
          el('div', { class: 'cs-side' },
            el('section', { class: 'cs-card' },
              el('header', null, el('span', { class: 'cs-ico', html: icon('folder') }), el('div', null, el('h3', { text: 'پروژه و نام‌ها' }), el('small', { text: 'پرتال، پیشرفت و طرح‌ها و فاکتورهای همین پروژه را نشان می‌دهد.' }))),
              MP.field('پروژه', proj), MP.field('نام مشتری', client), MP.field('نام گروه', title),
              el('button', { type: 'button', class: 'btn btn-secondary btn-sm cs-save', text: 'ذخیره نام‌ها', onclick: function () { save({ title: title.value, client_name: client.value }, 'ذخیره شد'); } })),
            staffCard(d),
            el('section', { class: 'cs-card' },
              el('header', null, el('span', { class: 'cs-ico', html: icon('lock') }), el('div', null, el('h3', { text: 'امنیت ورود' }))),
              d.sms ? el('p', { class: 'cs-note', text: 'ورود همیشه با شماره موبایل و کد یک‌بارمصرف است؛ فقط شماره‌های ثبت‌شده وارد می‌شوند و ۳۰ روز وارد می‌مانند.' })
                : el('div', null, el('label', { class: 'check' }, auth, el('span', { text: 'ورود با شماره موبایل و کد پیامک الزامی باشد' })), el('p', { class: 'hint', text: 'سرویس پیامک فعال نیست؛ تا فعال نشود ورود با کد ممکن نیست.' })))))].filter(Boolean));
      if (d.manager) body.append(brandCard());
      var dlg = body.closest('.dialog'); if (dlg) dlg.classList.add('cs-dialog');
    }
    /* Colleagues: the project's members always see the group; others can be added here. */
    function staffCard(d) {
      var card = el('section', { class: 'cs-card' },
        el('header', null, el('span', { class: 'cs-ico', html: icon('chat') }), el('div', null, el('h3', { text: 'همکاران این گروه' }), el('small', { text: 'پیام‌های مشتری را می‌بینند و اعلانش را می‌گیرند.' }))));
      var chips = el('div', { class: 'cs-staff' }, d.staff.map(function (s) {
        return el('span', { class: 'chip' + (s.fixed ? '' : ' brand'), title: s.fixed ? 'عضو پروژه' : 'اضافه‌شده به همین گروه' }, MP.avatar(MP.user(s.id), 'sm'), el('span', { text: s.name }),
          !s.fixed && d.can_staff ? el('button', { type: 'button', class: 'cs-x', 'aria-label': 'برداشتن ' + s.name, text: '×', onclick: function () { saveStaff(d.staff.filter(function (y) { return !y.fixed && y.id !== s.id; }).map(function (y) { return y.id; })); } }) : null);
      }));
      card.append(chips);
      if (d.can_staff) card.append(el('button', { type: 'button', class: 'btn btn-secondary btn-sm cs-save', html: icon('plus') + 'افزودن همکار', onclick: function () {
        var extra = d.staff.filter(function (y) { return !y.fixed; }).map(function (y) { return y.id; });
        var fixed = d.staff.filter(function (y) { return y.fixed; }).map(function (y) { return y.id; });
        var f = el('form', { class: 'form' }, el('div', { class: 'field' }, el('span', { text: 'همکارانی که این گروه را ببینند' }), MP.peoplePicker('staff', extra, null, fixed)), MP.actions('ذخیره'));
        f.onsubmit = function (e) { e.preventDefault(); MP.dialog.close(); saveStaff(MP.checked(f, 'staff')); };
        MP.dialog.open('همکاران گروه «' + d.title + '»', f);
      } }));
      function saveStaff(ids) {
        MP.api('channels/' + c.id + '/staff', { method: 'POST', body: { user_ids: ids } }).then(function (n) { MP.toast('همکاران گروه ذخیره شد'); if (document.body.contains(body)) draw(n); else clientSettings(c); MP.loadChannels(); }).catch(MP.soft);
      }
      return card;
    }
    /* Managers: the studio's logo, icon and team name in every client portal. */
    function brandCard() {
      var card = el('section', { class: 'cs-card cs-brand-card' },
        el('header', null, el('span', { class: 'cs-ico', html: icon('image') }), el('div', null, el('h3', { text: 'ظاهر استودیو در پرتال‌ها' }), el('small', { text: 'برای همه پرتال‌های مشتری؛ جای لوگو و نام مربع.' }))), MP.skeleton(1));
      MP.api('portal-brand').then(function (b) {
        var name = el('input', { class: 'input', value: b.name, maxlength: 60 });
        function pick(kind, label, url, isDefault) {
          var input = el('input', { type: 'file', accept: 'image/*', hidden: true });
          var box = el('button', { type: 'button', class: 'cs-brand-img ' + kind, title: 'تغییر ' + label, onclick: function () { input.click(); } }, el('img', { src: url, alt: '' }));
          input.onchange = function () {
            var f = input.files[0]; if (!f) return;
            box.classList.add('loading');
            MP.upload('files', f, { context: 'client_logo', context_id: c.id }).then(function (up) { var body2 = {}; body2[kind + '_file_id'] = up.id; return MP.api('portal-brand', { method: 'POST', body: body2 }); })
              .then(function () { MP.toast(label + ' عوض شد'); card.replaceWith(brandCard()); }).catch(function (e) { box.classList.remove('loading'); MP.soft(e); });
          };
          return el('div', { class: 'cs-brand-pick' }, box, input, el('small', { text: label }),
            !isDefault ? el('button', { type: 'button', class: 'cs-mini-link', text: 'برگرداندن پیش‌فرض', onclick: function () { var b2 = {}; b2[kind + '_file_id'] = 0; MP.api('portal-brand', { method: 'POST', body: b2 }).then(function () { card.replaceWith(brandCard()); }).catch(MP.soft); } }) : null);
        }
        card.replaceChildren(card.firstChild,
          el('div', { class: 'cs-brand-row' }, pick('logo', 'لوگو (افقی)', b.logo, !b.logo_id), pick('icon', 'آیکون گفت‌وگو (مربع)', b.icon, !b.icon_id)),
          MP.field('نام تیم در پرتال', name),
          el('button', { type: 'button', class: 'btn btn-secondary btn-sm cs-save', text: 'ذخیره نام', onclick: function () { MP.api('portal-brand', { method: 'POST', body: { name: name.value } }).then(function () { MP.toast('نام تیم ذخیره شد'); }).catch(MP.soft); } }));
      }).catch(function () { card.remove(); });
      return card;
    }
    MP.api('channels/' + c.id + '/client').then(draw).catch(MP.soft);
  }

  /**
   * Hold a conversation (about half a second, finger or mouse) or right-click it: a menu opens beside it,
   * like Telegram. The click that ends a long press does not open the chat.
   */
  function longPress(node, fire) {
    var timer = 0, x = 0, y = 0, fired = false;
    function cancel() { clearTimeout(timer); timer = 0; node.classList.remove('pressing'); }
    node.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      fired = false; x = e.clientX; y = e.clientY;
      node.classList.add('pressing');
      timer = setTimeout(function () { timer = 0; fired = true; node.classList.remove('pressing'); MP.haptic(15); fire(); }, 480);
    });
    node.addEventListener('pointermove', function (e) { if (timer && (Math.abs(e.clientX - x) > 10 || Math.abs(e.clientY - y) > 10)) cancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { node.addEventListener(ev, cancel); });
    node.addEventListener('click', function (e) { if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; } }, true);
    node.addEventListener('contextmenu', function (e) { e.preventDefault(); cancel(); fired = false; fire(); });
  }

  function setPin(c, scope, on) {
    MP.api('channels/' + c.id + '/pin', { method: 'POST', body: { scope: scope, on: on } }).then(function (n) {
      S.channels = S.channels.map(function (x) { return x.id === n.id ? n : x; });
      renderList();
      if (current === c.id) select(c.id);
      MP.toast(on ? (scope === 'all' ? 'برای همه سنجاق شد' : 'برای شما سنجاق شد') : 'سنجاق برداشته شد', { icon: 'pin' });
    }).catch(MP.soft);
  }

  /** The conversation's menu, floating beside it: pin (for me / for everyone), open, members, profile, archive. */
  var openMenu = null;
  function chatMenu(c, anchor) {
    if (openMenu) openMenu();
    var forAll = S.manager && c.type !== 'direct', items = [], sep = null;
    if (current !== c.id) items.push(['chat', 'باز کردن گفت‌وگو', function () { select(c.id); }]);
    // Pin
    if (c.pinned === 'all') {
      if (forAll) items.push(['pin', 'برداشتن سنجاق برای همه', function () { setPin(c, 'all', false); }]);
    } else {
      items.push(c.pinned === 'me' ? ['pin', 'برداشتن سنجاق', function () { setPin(c, 'me', false); }] : ['pin', 'سنجاق برای خودم', function () { setPin(c, 'me', true); }]);
      if (forAll) items.push(['pin', 'سنجاق برای همه اعضا', function () { setPin(c, 'all', true); }]);
    }
    if (c.type !== 'saved') items.push(c.muted ? ['bell', 'روشن کردن اعلان', function () { setMute(c, false); }] : ['bell-off', 'بی‌صدا کردن', function () { setMute(c, true); }]);
    if (c.unread) items.push(['checks', 'علامت خوانده‌شده', function () { markRead(c); }]);
    items.push(['eye', 'اطلاعات گفت‌وگو', function () { chatInfo(c); }]);
    items.push(sep);
    // The same settings as the buttons above an open conversation.
    if (c.type === 'client') {
      items.push(['send', 'لینک مشتری', function () { shareLink(c); }]);
      items.push(['user', 'مشتریان و ظاهر', function () { clientSettings(c); }]);
      if (c.project_id) items.push(['eye', 'پرتال پروژه', function () { MP.portal(c.project_id); }]);
      items.push(['video', 'جلسه آنلاین', function () { MP.meetingForm({ channelId: c.id, projectId: c.project_id, title: 'جلسه با ' + (c.client_name || c.title) }); }]);
    }
    if (c.type === 'direct') items.push(['user', 'پروفایل', function () { MP.openProfile(c.other); }]);
    if (c.type === 'group' && c.can_manage) items.push(['user', 'اعضای گروه', function () { groupForm(c); }]);
    if (c.can_logo && c.type !== 'client') items.push(['image', 'لوگوی گروه', function () { groupLogo(c); }]);
    if (c.can_delete) { items.push(sep); items.push(['folder', 'آرشیو گروه', function () { deleteClient(c); }, true]); }
    // No separators at the ends or twice in a row.
    items = items.filter(function (it, i, a) { return it || (i > 0 && i < a.length - 1 && a[i - 1]); });
    while (items.length && !items[items.length - 1]) items.pop();

    var menu = el('div', { class: 'ctx-menu', role: 'menu', 'aria-label': c.title },
      c.pinned === 'all' && !forAll ? el('div', { class: 'ctx-note', text: 'ناظر این گفت‌وگو را برای همه سنجاق کرده' }) : null,
      el('div', { class: 'ctx-title', text: c.title }),
      items.map(function (it) {
        if (!it) return el('hr', { class: 'ctx-sep', role: 'separator' });
        var b = el('button', { type: 'button', role: 'menuitem', class: it[3] ? 'danger' : '', html: icon(it[0]), onclick: function () { close(); it[2](); } });
        b.append(el('span', { text: it[1] }));
        return b;
      }));
    var shade = el('div', { class: 'ctx-shade', onclick: function () { close(); } });
    if (anchor) anchor.classList.add('ctx-lifted');
    document.body.append(shade, menu);
    // Beside the conversation, kept on screen (below it, or above when there is no room).
    var r = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 2, bottom: innerHeight / 2, width: 0 };
    var w = menu.offsetWidth, h = menu.offsetHeight, pad = 8;
    var left = Math.min(Math.max(pad, r.right - w), innerWidth - w - pad);
    var top = r.bottom + 6 + h > innerHeight - pad ? Math.max(pad, r.top - h - 6) : r.bottom + 6;
    menu.style.left = left + 'px'; menu.style.top = top + 'px';
    void menu.offsetWidth; // start the pop-in now (no requestAnimationFrame: it does not run in background tabs)
    menu.classList.add('in');
    var first = $('button', menu); if (first) first.focus({ preventScroll: true });
    function key(e) {
      var btns = $$('button', menu), i = btns.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); close(); if (anchor) anchor.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
    }
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', close);
    function close() {
      if (openMenu !== close) return;
      openMenu = null;
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', close);
      if (anchor) anchor.classList.remove('ctx-lifted');
      shade.remove(); menu.remove();
    }
    openMenu = close;
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
  MP.newClientGroup = function (o) { MP.showView('messages'); newClientGroup(o); };
  $('#new-client-group').onclick = function () { newClientGroup(); };
  function newClientGroup(o) {
    o = o || {};
    var cust = el('select', { name: 'client_id' }, el('option', { value: 'new', text: '＋ مشتری جدید…' }));
    var name = el('input', { name: 'client', maxlength: 120, placeholder: 'نام مشتری (شخص یا شرکت)' });
    var nameWrap = MP.field('نام مشتری جدید', name);
    var proj = MP.projectSelect('project_id', o.project_id || S.projectId);
    var mobile = el('input', { name: 'mobile', inputmode: 'tel', dir: 'ltr', maxlength: 20, placeholder: '۰۹۱۲ ۱۲۳ ۴۵۶۷' });
    mobile.addEventListener('input', function () { mobile.value = J.faDigits(J.latinDigits(mobile.value).replace(/[^\d ]/g, '')); });
    var list = [];
    cust.onchange = function () {
      nameWrap.hidden = cust.value !== 'new'; name.required = cust.value === 'new';
      var c = list.filter(function (q) { return String(q.id) === cust.value; })[0];
      if (c && !+proj.value && c.projects.length === 1) proj.value = c.projects[0];
      // The customer's own mobile, when their file has one.
      var m = c ? J.latinDigits(c.phone || '').replace(/\D/g, '') : '';
      if (c && /^(98|0)?9\d{9}$/.test(m)) mobile.value = J.faDigits(m.replace(/^98/, '0').replace(/^9/, '09'));
      else if (cust.value === 'new' || c) mobile.value = '';
    };
    MP.api('customers').then(function (l) {
      list = l;
      l.forEach(function (c) { cust.insertBefore(el('option', { value: c.id, text: c.name }), cust.lastChild); });
      if (o.client_id) cust.value = String(o.client_id);
      cust.onchange();
    }).catch(function () { cust.onchange(); });
    var f = el('form', { class: 'form' },
      MP.field('مشتری', cust, 'یک مشتری می‌تواند چند پروژه و چند گروه داشته باشد.'),
      nameWrap,
      MP.field('پروژه', proj, 'پرتال همین پروژه را نشان می‌دهد و اعضای آن پیام‌های مشتری را می‌گیرند.'),
      MP.field('نام گروه', el('input', { name: 'title', maxlength: 160, placeholder: 'خالی بماند، نام مشتری گذاشته می‌شود' })),
      MP.field('موبایل مشتری', mobile, 'برای ورود به پرتال؛ لینک گروه همین حالا برایش پیامک می‌شود. افراد بیشتر را بعداً از «مشتریان و ظاهر» اضافه کنید.'),
      MP.actions('ساخت و دریافت لینک'));
    cust.onchange();
    f.onsubmit = function (e) {
      e.preventDefault(); MP.busy(f, true);
      MP.api('channels', { method: 'POST', body: { type: 'client', title: f.elements.title.value, client_id: cust.value === 'new' ? 0 : +cust.value, client_name: name.value, project_id: +proj.value, mobile: J.latinDigits(mobile.value) } })
        .then(function (c) {
          S.channels.push(c); select(c.id);
          if (c.sms_sent) { MP.dialog.close(); MP.toast('گروه ساخته شد و لینک آن برای مشتری پیامک شد', { icon: 'check', duration: 6000 }); }
          else {
            shareLink(c);
            if (c.sms_sent === false) MP.toast('گروه ساخته شد، ولی پیامک ارسال نشد: ' + (c.sms_error || 'خطای سرویس پیامک'), { error: true, duration: 10000 });
          }
        }).catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open('گروه اختصاصی مشتری', f);
  };

  function open(opts) {
    renderList();
    MP.loadChannels().then(function () {
      var target = opts.channel || current || (window.innerWidth > 860 && S.channels[0] && S.channels[0].id);
      if (opts.channel && !chan(opts.channel)) { MP.toast('این گفت‌وگو پیدا نشد یا به آن دسترسی ندارید.'); target = 0; }
      if (target) select(target, opts.msg || 0, { topic: opts.topic || 0, reply: opts.reply });
      else { layout.classList.remove('open'); $('#composer').hidden = true; box.replaceChildren(MP.empty('chat', 'یک گفت‌وگو را انتخاب کنید', null, null, true)); }
    });
  }
  MP.view('messages', { open: open });

  /** Addresses inside the panel: #chat-12 (a chat), #chat-12-reply (from a notification), #msg-345 (a message link), #join-… (an invite). */
  MP.chatRoute = function (h) {
    var m;
    if ((m = /^chat-(\d+)(-reply)?$/.exec(h))) { MP.showView('messages', { channel: +m[1], reply: !!m[2] }); return true; }
    if ((m = /^msg-(\d+)$/.exec(h))) { MP.openMessage(+m[1]); return true; }
    if ((m = /^join-([A-Za-z0-9]{10,})$/.exec(h))) { joinGroup(m[1]); return true; }
    return false;
  };
  MP.openMessage = function (id) {
    MP.api('messages/' + id + '/locate').then(function (d) { MP.showView('messages', { channel: d.channel_id, msg: d.id, topic: d.topic_id }); }).catch(MP.soft);
  };
  function joinGroup(token) {
    MP.api('chat-join', { method: 'POST', body: { token: token } }).then(function (c) {
      if (!chan(c.id)) S.channels.push(c);
      MP.toast('به گروه «' + c.title + '» پیوستید', { icon: 'check' });
      MP.showView('messages', { channel: c.id });
    }).catch(function (e) { MP.soft(e); MP.showView('messages'); });
  }
  var origShow = MP.showView;
  MP.showView = function (name, opts) {
    if (name !== 'messages') { stop(); document.body.classList.remove('chat-full'); layout.classList.remove('open'); if (chatLayer) { var l = chatLayer; chatLayer = null; MP.popLayer(l); } }
    origShow(name, opts);
  };
  MP.on('notification', function (n) { if (n.type === 'message') MP.loadChannels(); });
})();
