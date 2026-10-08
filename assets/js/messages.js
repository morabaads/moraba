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
    current = 0; stop(); renderList(); liveRestart(); if (sideEl) drawSide();
    if (!MP.isMobile()) noChat();
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
    // Like Telegram: the name's first letters on a colour of their own, a small sign for the kind of chat.
    var name = String(c.title || '').replace(/^(گروه|پروژه|کانال)\s+/, '') || c.title;
    return el('span', { class: 'ci-av' + (size ? ' ' + size : '') }, MP.initials({ name: name }, size),
      el('i', { class: 'ci-kind ' + c.type, title: c.type === 'client' ? 'مشتری' : c.type === 'group' ? 'گروه تیم' : 'پروژه', html: icon(c.type === 'client' ? 'user' : c.type === 'group' ? 'users' : 'folder') }));
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
    var x = m.x || {};
    if (x.poll) return 'poll';
    if (x.loc) return 'loc';
    if (x.contact) return 'contact';
    if (x.card) return 'card';
    if (!m.file) return '';
    if (x.sticker) return 'sticker';
    if (x.gif) return 'gif';
    if (x.round) return 'round';
    if (/^audio\//.test(m.file.mime)) return 'voice';
    if (m.as_file) return 'file';
    if (m.file.image) return 'photo';
    if (/^video\//.test(m.file.mime)) return 'video';
    return 'file';
  }
  function snippet(m) {
    if (m.deleted) return 'پیام آرشیو شد';
    var x = m.x || {}, k = kindOf(m);
    if (k === 'poll') return '📊 ' + x.poll.q;
    if (k === 'loc') return '📍 موقعیت مکانی';
    if (k === 'contact') return '👤 ' + x.contact.name;
    if (k === 'card') return (x.card.t === 'task' ? '✅ ' : '📁 ') + (x.card.title || '');
    if (m.body) return plainText(m.body).replace(/\s+/g, ' ').slice(0, 120);
    return { voice: 'پیام صوتی', photo: 'عکس', video: 'ویدیو', round: 'پیام ویدیویی', sticker: 'استیکر', gif: 'GIF', file: m.file ? m.file.name : 'فایل' }[k] || '';
  }
  /** Text without formatting marks (**bold**, __italic__, ~~strike~~, `code`, ||spoiler||, [text](link)). */
  function plainText(t) { return String(t || '').replace(/\[([^\]\n]+)\]\((?:https?:\/\/|task:|project:)[^)\s]+\)/g, '$1').replace(/\*\*|__|~~|\|\||```|`/g, ''); }
  var URL_RE = /https?:\/\/[^\s<>"']+/g;
  /** Message text: links clickable, «@نام» highlighted. Built as nodes, never as HTML. */
  function richText(body) {
    var p = el('p', { class: 'b-text', dir: 'auto' });
    MP.chatKit.format(body, p, {
      onTag: function (tag) { openFind(tag); },
      onTask: function (id) { MP.openTask(id); },
      onProject: function (id) { S.projectId = id; MP.showView('projects'); }
    });
    if (MP.onlyEmoji(body)) p.classList.add('b-jumbo', 'j' + MP.onlyEmoji(body));
    return MP.emojify(p);
  }

  /* ------------------------------------------------------------ Special messages: poll, place, contact, card, sticker, video */

  function pollEl(m) {
    var p = Object.assign({ counts: m.x.poll.o.map(function () { return 0; }), mine: [], voters: 0, who: [] }, m.x.poll), total = p.counts.reduce(function (a, b) { return a + b; }, 0), voted = p.mine && p.mine.length, show = voted || p.closed;
    var picked = {};
    var box = el('div', { class: 'b-poll' + (show ? ' shown' : '') },
      el('b', { class: 'bp-q', text: p.q, dir: 'auto' }),
      el('small', { class: 'bp-kind', text: (p.anon ? 'نظرسنجی ناشناس' : 'نظرسنجی') + (p.multi ? ' · چند گزینه‌ای' : '') + (p.closed ? ' · بسته شده' : '') }));
    p.o.forEach(function (o, i) {
      var n = p.counts[i] || 0, pct = total ? Math.round(n / total * 100) : 0, mine = p.mine.indexOf(i) >= 0;
      var row = el('button', { type: 'button', class: 'bp-opt' + (mine ? ' mine' : ''), disabled: !!p.closed && !show,
        onclick: function (e) {
          e.stopPropagation();
          if (show && !p.closed && !p.anon && p.who && p.who[i] && p.who[i].length) { MP.toast(p.who[i].join('، '), { duration: 5000 }); return; }
          if (p.closed || typeof m.id !== 'number') return;
          if (show) return;
          if (p.multi) { picked[i] = !picked[i]; row.classList.toggle('picked', !!picked[i]); go.hidden = !Object.keys(picked).some(function (k) { return picked[k]; }); return; }
          vote(m, [i]);
        } },
        el('span', { class: 'bp-mark', html: show ? (mine ? icon('check') : '') : '' }),
        el('span', { class: 'bp-text', text: o, dir: 'auto' }),
        show ? el('span', { class: 'bp-pct', text: fa(pct) + '٪' }) : null,
        show ? el('i', { class: 'bp-bar', style: { width: pct + '%' } }) : null);
      box.append(row);
    });
    var go = el('button', { type: 'button', class: 'btn btn-sm btn-primary bp-go', hidden: true, text: 'ثبت رأی', onclick: function (e) { e.stopPropagation(); vote(m, Object.keys(picked).filter(function (k) { return picked[k]; }).map(Number)); } });
    if (p.multi && !show) box.append(go);
    var foot = el('div', { class: 'bp-foot' }, el('small', { text: p.voters ? fa(p.voters) + ' نفر رأی داده‌اند' : 'هنوز رأیی نیامده' }));
    if (voted && !p.closed) foot.append(el('button', { type: 'button', class: 'bp-link', text: 'پس گرفتن رأی', onclick: function (e) { e.stopPropagation(); vote(m, []); } }));
    if (p.can_close && !p.closed) foot.append(el('button', { type: 'button', class: 'bp-link', text: 'بستن نظرسنجی', onclick: function (e) { e.stopPropagation(); MP.confirm('بستن نظرسنجی', 'بعد از بستن، کسی نمی‌تواند رأی بدهد و نتیجه برای همه می‌ماند.', 'ببند').then(function (ok) { if (ok) MP.api('messages/' + m.id + '/poll-close', { method: 'POST' }).then(update).catch(MP.soft); }); } }));
    box.append(foot);
    return box;
  }
  function vote(m, opts) {
    MP.api('messages/' + m.id + '/vote', { method: 'POST', body: { opts: opts } }).then(function (n) { update(n); MP.haptic(8); }).catch(MP.soft);
  }
  function locEl(m) {
    var l = m.x.loc;
    var card = el('button', { type: 'button', class: 'b-loc', onclick: function (e) {
      e.stopPropagation();
      MP.dialog.open('باز کردن موقعیت در…', el('div', { class: 'menu' }, MP.chatKit.mapLinks(l.lat, l.lng).map(function (x) { return el('a', { href: x[1], target: '_blank', rel: 'noopener', onclick: function () { MP.dialog.close(); } }, MP.iconEl('pin'), el('span', { text: x[0] })); }),
        el('button', { type: 'button', onclick: function () { MP.dialog.close(); copyText(l.lat + ',' + l.lng); } }, MP.iconEl('copy'), el('span', { text: 'کپی مختصات' }))));
    } }, MP.chatKit.mapCard(l), el('span', { class: 'bl-cap' }, MP.iconEl('pin'), el('span', { text: l.label || 'موقعیت مکانی' })));
    return card;
  }
  function contactEl(m) {
    var c = m.x.contact, u = c.uid ? MP.user(c.uid) : null;
    return el('div', { class: 'b-contact' },
      el('span', { class: 'bc-top' }, u ? MP.avatar(u, 'sm') : el('span', { class: 'initials sm', text: (c.name || '؟').slice(0, 1) }), el('span', { class: 'bc-copy' }, el('b', { text: c.name }), c.phone ? el('small', { dir: 'ltr', text: J.faDigits(c.phone) }) : null)),
      el('span', { class: 'bc-acts' },
        c.phone ? el('a', { href: 'tel:' + c.phone, class: 'bc-btn', onclick: function (e) { e.stopPropagation(); }, text: 'تماس' }) : null,
        c.uid && c.uid !== S.me.id ? el('button', { type: 'button', class: 'bc-btn', text: 'پیام', onclick: function (e) { e.stopPropagation(); MP.startDirect(c.uid); } }) : null,
        c.phone ? el('button', { type: 'button', class: 'bc-btn', text: 'ذخیره', onclick: function (e) { e.stopPropagation(); MP.chatKit.vcard(c); } }) : null));
  }
  var CARD_ST = { todo: 'انجام نشده', doing: 'در حال انجام', done: 'انجام شد', waiting: 'در انتظار' };
  /** A task or project inside the chat; its state stays fresh (cards on screen are refreshed together). */
  function cardEl(m) {
    var c = m.x.card;
    var node = el('button', { type: 'button', class: 'b-card t-' + c.t + (c.gone ? ' gone' : '') + (c.status === 'done' ? ' done' : ''), dataset: { card: c.t + ':' + c.id }, onclick: function (e) {
      e.stopPropagation();
      if (c.gone) { MP.toast('این مورد حذف شده یا به آن دسترسی ندارید.'); return; }
      if (c.t === 'task') MP.openTask(c.id); else { S.projectId = c.id; MP.showView('projects'); }
    } });
    fillCard(node, c);
    return node;
  }
  function fillCard(node, c) {
    var head = el('span', { class: 'bk-head' }, MP.iconEl(c.t === 'task' ? 'tasks' : 'folder'), el('small', { text: c.t === 'task' ? 'تسک' : 'پروژه' }));
    if (c.gone) { node.replaceChildren(head, el('b', { text: c.title || 'حذف شده' }), el('small', { class: 'bk-meta', text: 'در دسترس نیست' })); return; }
    var meta = c.t === 'task'
      ? [el('span', { class: 'bk-st st-' + c.status, text: CARD_ST[c.status] || c.status || '…' }), c.user ? el('span', { text: c.user }) : null, c.date ? el('span', { text: J.format(c.date, false) + (c.time ? ' ' + MP.timeFa(c.time) : '') }) : null]
      : [el('span', { class: 'bk-st', text: c.tasks === undefined ? '…' : fa(c.done) + ' از ' + fa(c.tasks) + ' تسک' }), c.end ? el('span', { text: 'تا ' + J.format(c.end, false) }) : null];
    var bar = c.t === 'project' && c.tasks ? el('span', { class: 'bk-bar' }, el('i', { style: { width: Math.round(c.done / c.tasks * 100) + '%' } })) : null;
    node.replaceChildren(head, el('b', { text: c.title, dir: 'auto' }), el('span', { class: 'bk-meta' }, meta), bar);
  }
  /** Every few seconds while the chat is open: the cards' newest state (status changes show without reloading). */
  var cardSoon = 0;
  function refreshCardsSoon() { clearTimeout(cardSoon); cardSoon = setTimeout(refreshCards, 300); }
  setInterval(refreshCards, 20000);
  function refreshCards() {
    if (document.hidden || !current) return;
    var nodes = $$('[data-card]', box); if (!nodes.length) return;
    var t = [], p = [];
    nodes.forEach(function (n) { var a = n.dataset.card.split(':'); (a[0] === 'task' ? t : p).push(a[1]); });
    MP.api('chat-cards', { query: { tasks: t.join(','), projects: p.join(',') }, noCache: true }).then(function (d) {
      nodes.forEach(function (n) {
        var a = n.dataset.card.split(':'), c = (a[0] === 'task' ? d.tasks : d.projects)[a[1]];
        if (c) { c.t = a[0]; c.id = +a[1]; n.classList.toggle('done', c.status === 'done'); n.classList.toggle('gone', !!c.gone); fillCard(n, c); }
      });
    }).catch(function () {});
  }
  function stickerEl(m) {
    var img = el('img', { class: 'b-stk', src: m.file.url, alt: m.x && m.x.gif ? 'GIF' : 'استیکر', loading: 'lazy' });
    return el('span', { class: 'b-stk-wrap' + (m.x && m.x.gif ? ' gif' : '') }, img);
  }
  /** Telegram's round video: plays silently in a circle; a tap plays it with sound from the start. */
  function roundEl(m) {
    var v = el('video', { class: 'b-round', src: m.file.url, muted: true, loop: true, playsinline: true, preload: 'metadata', poster: m.x && m.x.thumb_url ? m.x.thumb_url : '' });
    v.muted = true;
    var dur = el('span', { class: 'rd-dur', text: clock(m.x && m.x.dur) });
    var wrap = el('button', { type: 'button', class: 'b-round-wrap', 'aria-label': 'پخش پیام ویدیویی', onclick: function (e) {
      e.stopPropagation();
      if (v.muted) { if (playing && playing !== v) playing.pause(); if (VP.m) VP.audio.pause(); playing = v; v.muted = false; v.loop = false; v.currentTime = 0; v.play().catch(function () {}); wrap.classList.add('on'); }
      else if (v.paused) v.play().catch(function () {}); else v.pause();
    } }, v, dur, el('span', { class: 'rd-snd', html: icon('speaker') }));
    v.addEventListener('timeupdate', function () { if (!v.muted) { dur.textContent = clock(v.currentTime); wrap.style.setProperty('--p', v.duration ? v.currentTime / v.duration : 0); } });
    v.addEventListener('ended', function () { v.muted = true; v.loop = true; wrap.classList.remove('on'); wrap.style.removeProperty('--p'); dur.textContent = clock(m.x && m.x.dur); v.play().catch(function () {}); });
    // Silent preview only while on screen.
    if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { en.forEach(function (x) { if (v.muted) { if (x.isIntersecting) v.play().catch(function () {}); else v.pause(); } }); }).observe(v);
    return wrap;
  }
  /** A video: its first frame, duration and a play button; plays full screen. */
  function videoEl(m, list) {
    var x = m.x || {}, ratio = x.w && x.h ? Math.max(.6, Math.min(1.8, x.w / x.h)) : 16 / 9;
    var cell = el('button', { type: 'button', class: 'b-vid', style: { aspectRatio: String(ratio) }, 'aria-label': 'پخش ویدیو', onclick: function (e) { e.stopPropagation(); if (!selecting) gallery(m.id); } },
      x.thumb_url ? el('img', { src: x.thumb_url, alt: '', loading: 'lazy' }) : el('video', { src: m.file.url + '#t=0.5', muted: true, preload: 'metadata', playsinline: true }),
      el('span', { class: 'bv-play', html: icon('play') }),
      el('span', { class: 'bv-dur', text: x.dur ? clock(x.dur) : MP.fileSize(m.file.size) }));
    return cell;
  }

  /* ------------------------------------------------------------ Chat list */

  var listTab = 'all', listQ = '', showQuiet = false, foundMsgs = null, findTimer = 0, listArch = false;
  try { listTab = localStorage.getItem('mp_chat_tab') || 'all'; } catch (e) { /* private mode */ }
  function folderOf(c) { var p = c.project_id ? MP.project(c.project_id) : null; return p && p.folder_id ? p.folder_id : 0; }
  function isUnread(c) { return !!(c.unread || c.marked); }
  /** Folders as tabs: all, unread, private, team groups, project folders, projects, clients. */
  function tabsFor(chs) {
    var t = [['all', 'همه']];
    if (chs.some(isUnread)) t.push(['unread', 'نخوانده‌ها']);
    if (chs.some(function (c) { return c.type === 'direct'; })) t.push(['direct', 'خصوصی']);
    if (chs.some(function (c) { return c.type === 'group'; })) t.push(['group', 'گروه‌ها']);
    (S.folders || []).forEach(function (f) { if (chs.some(function (c) { return c.type === 'project' && folderOf(c) === f.id; })) t.push(['f' + f.id, f.name]); });
    if (chs.some(function (c) { return c.type === 'project' && !folderOf(c); })) t.push(['project', (S.folders || []).length ? 'سایر پروژه‌ها' : 'پروژه‌ها']);
    if (chs.some(function (c) { return c.type === 'client'; })) t.push(['client', 'مشتری‌ها']);
    return t;
  }
  function inTab(c, tab) {
    if (tab === 'all') return true;
    if (tab === 'unread') return isUnread(c) || c.id === current;
    if (tab.charAt(0) === 'f') return c.type === 'project' && folderOf(c) === +tab.slice(1);
    if (tab === 'project') return c.type === 'project' && !folderOf(c);
    if (tab === 'direct') return c.type === 'direct' || c.type === 'saved';
    return c.type === tab;
  }
  /** Pinned first (for everyone, then mine in my order), then by newest message. */
  function listOrder(a, b) {
    var ra = a.pinned === 'all' ? 2 : a.pinned === 'me' ? 1 : 0, rb = b.pinned === 'all' ? 2 : b.pinned === 'me' ? 1 : 0;
    if (ra !== rb) return rb - ra;
    if (ra === 1) return (b.pin_rank || 0) - (a.pin_rank || 0);
    return (b.last ? b.last.id : 0) - (a.last ? a.last.id : 0);
  }
  function renderList() {
    var list = $('#chat-list'), keepFocus = document.activeElement && document.activeElement.id === 'chat-search';
    var scroll = list.scrollTop;
    list.replaceChildren();
    var search = el('label', { class: 'search chat-search' }, MP.iconEl('search'), el('input', { type: 'search', id: 'chat-search', placeholder: 'جستجوی گفت‌وگو و پیام…', value: listQ, 'aria-label': 'جستجوی گفت‌وگو و پیام', autocomplete: 'off' }));
    $('input', search).oninput = function (e) { listQ = e.target.value; foundMsgs = null; renderList(); findMessages(); };
    var saved = el('button', { type: 'button', class: 'icon-btn chat-saved-btn', title: 'پیام‌های ذخیره‌شده', 'aria-label': 'پیام‌های ذخیره‌شده', html: icon('bookmark'), onclick: openSaved });
    var archived = S.channels.filter(function (c) { return c.arch_me; });
    var main = S.channels.filter(function (c) { return !c.arch_me || c.id === current && !listArch; });
    var pool = listArch ? archived : main;
    var q = MP.norm(listQ);
    if (listArch) {
      list.append(el('div', { class: 'chat-list-top chat-arch-top' },
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'بازگشت', html: icon('right'), onclick: function () { listArch = false; renderList(); } }),
        el('strong', { text: 'گفت‌وگوهای بایگانی‌شده' })),
        el('p', { class: 'chat-arch-hint', text: 'با رسیدن پیام تازه، گفت‌وگو خودش از بایگانی بیرون می‌آید (به‌جز گفت‌وگوهای بی‌صدا).' }));
    } else {
      var tabs = tabsFor(main);
      if (!tabs.some(function (t) { return t[0] === listTab; })) listTab = 'all';
      var unreadIn = function (tab) { return main.filter(function (c) { return inTab(c, tab) && isUnread(c) && !c.muted; }).length; };
      var bar = el('div', { class: 'chat-tabs', role: 'tablist' }, tabs.map(function (t) {
        var n = unreadIn(t[0]);
        return el('button', { type: 'button', role: 'tab', 'aria-selected': String(t[0] === listTab), onclick: function () { listTab = t[0]; try { localStorage.setItem('mp_chat_tab', listTab); } catch (e) { /* private mode */ } renderList(); } },
          t[1], n && t[0] !== 'all' && t[0] !== 'unread' ? el('i', { text: fa(n) }) : null);
      }));
      list.append(el('div', { class: 'chat-list-top' }, search, saved), bar);
      // Telegram's «Archived chats» row at the top of the list.
      if (archived.length && !q && listTab === 'all') {
        var an = archived.filter(function (c) { return isUnread(c); }).length;
        list.append(el('button', { type: 'button', class: 'chat-item chat-arch-row', onclick: function () { listArch = true; renderList(); } },
          el('span', { class: 'ci-ico arch', html: icon('folder') }),
          el('span', { class: 'ci-copy' }, el('span', { class: 'ci-line' }, el('strong', { text: 'بایگانی' })), el('span', { class: 'ci-line' }, el('small', { text: archived.slice(0, 4).map(function (c) { return c.title; }).join('، ') }), an ? el('span', { class: 'badge muted', text: fa(an) }) : null))));
      }
    }
    var all = pool.filter(function (c) { return (listArch || inTab(c, listTab)) && (!q || MP.norm(c.title + ' ' + (c.client_name || '')).indexOf(q) >= 0); });
    var quiet = listArch ? [] : all.filter(function (c) { return (c.type === 'project' || c.type === 'saved') && !c.last && c.id !== current && !c.pinned; });
    var items = (q || showQuiet) ? all : all.filter(function (c) { return quiet.indexOf(c) < 0; });
    items.sort(listOrder);
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
    if (!items.length && !q) {
      if (listArch) list.append(MP.empty('folder', 'بایگانی خالی است', 'گفت‌وگویی را به چپ بکشید یا از منوی آن «بایگانی» را بزنید.', null, true));
      else if (listTab === 'unread') list.append(MP.empty('checks', 'پیام نخوانده‌ای نیست', 'همه پیام‌ها را خوانده‌اید.', null, true));
      else list.append(MP.empty('chat', 'گفت‌وگویی نیست', 'با «پیام جدید» گفت‌وگو را شروع کنید.', { text: 'پیام جدید', onclick: newDirect }, true));
    }
    if (quiet.length && !q) list.append(el('button', { type: 'button', class: 'chat-archive-link', html: icon(showQuiet ? 'eye' : 'folder') + (showQuiet ? 'پنهان کردن گروه‌های بی‌پیام' : fa(quiet.length) + ' گروه بدون پیام'), onclick: function () { showQuiet = !showQuiet; renderList(); } }));
    if (!listArch) list.append(el('button', { type: 'button', class: 'chat-archive-link', html: icon('folder') + 'گروه‌های آرشیو‌شده توسط ناظر', onclick: archivedGroups }));
    if (keepFocus) { var i = $('#chat-search'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    MP.emojify(list);
    list.scrollTop = scroll;
    paintActivity();
    MP.emit('chatlist');
  }
  function findMessages() {
    clearTimeout(findTimer);
    var q = listQ.trim(); if (MP.norm(q).length < 2) return;
    findTimer = setTimeout(function () {
      MP.api('messages/search', { query: { q: q } }).then(function (l) { if (listQ.trim() === q) { foundMsgs = l; renderList(); } }).catch(function () {});
    }, 350);
  }
  /** One conversation: avatar, name (+ muted), last message or draft, time, my ticks, @, unread badge or pin. */
  function chatRow(c) {
    var draft = c.id !== current ? draftOf(c.id) : '';
    var mine = c.last && c.last.mine && !c.last.deleted;
    var item = el('button', { type: 'button', class: 'chat-item' + (c.id === current ? ' active' : '') + (c.pinned ? ' pinned' : '') + (c.muted ? ' muted' : '') + (isUnread(c) ? ' has-unread' : '') + (c.type === 'direct' && isOnline(c.other) ? ' is-online' : ''), dataset: c.type === 'direct' ? { id: c.id, other: c.other } : { id: c.id }, onclick: function () { if (!wrap.classList.contains('sw-open') && !item.dataset.swiped) select(c.id); } },
      channelIcon(c),
      el('span', { class: 'ci-copy' },
        el('span', { class: 'ci-line' },
          el('strong', null, c.title, c.settings && c.settings.mode === 'channel' ? el('i', { class: 'ci-mute', html: icon('speaker') }) : null, c.muted ? el('i', { class: 'ci-mute', html: icon('bell-off') }) : null),
          c.last ? el('span', { class: 'ci-time' }, mine && c.type !== 'saved' ? el('i', { class: 'ci-tick' + (c.last.seen_by ? ' seen' : ''), html: icon(c.last.seen_by || c.last.got ? 'checks' : 'check') }) : null, el('time', { text: listTime(c.last.created_at) })) : null),
        el('span', { class: 'ci-line' },
          el('span', { class: 'ci-pv' }, draft ? el('small', { class: 'ci-draft' }, el('b', { text: 'پیش‌نویس: ' }), draft.replace(/\s+/g, ' ')) : preview(c)),
          c.mention && c.mention[0] ? el('span', { class: 'ci-at', title: 'شما را صدا زده‌اند؛ بزنید تا به آن پیام بروید', text: '@', onclick: function (e) { e.stopPropagation(); select(c.id, c.mention[1]); } }) : null,
          c.unread ? el('span', { class: 'badge' + (c.muted ? ' muted' : ''), text: fa(c.unread) }) : c.marked ? el('span', { class: 'badge ci-mark' + (c.muted ? ' muted' : '') }) : c.pinned ? el('span', { class: 'ci-pin', title: c.pinned === 'all' ? 'سنجاق برای همه' : 'سنجاق برای من', html: icon('pin') }) : null)));
    var wrap = el('div', { class: 'cs-wrap' + (c.id === current ? ' active' : ''), dataset: { id: c.id } }, item);
    longPress(item, function (touch) { if (touch) peek(c, item); else chatMenu(c, item); });
    swipeRow(wrap, item, c);
    return wrap;
  }
  /** Chat list preview: «شما: …» / «سارا: …» in groups, or an icon + label for voice, photo, poll, place… */
  function preview(c) {
    if (!c.last && c.pv) return el('small', { text: 'گفت‌وگوی خصوصی با مشتری · همکاران پروژه‌هایش' });
    if (!c.last) return el('small', { text: c.type === 'client' ? 'مشتری: ' + c.client_name + (c.project_id && MP.project(c.project_id) ? ' · ' + MP.project(c.project_id).name : '') : c.type === 'saved' ? 'پیام‌ها، فایل‌ها و یادداشت‌های خودتان' : 'هنوز پیامی نیست' });
    var l = c.last;
    if (l.archived && !l.body && !l.file) return el('small', { class: 'ci-kind' }, MP.iconEl('ban'), 'پیام آرشیو شد');
    var who = l.mine ? 'شما: ' : isGroup(c) && l.author ? l.author.split(' ')[0] + ': ' : '';
    if (l.deleted) return el('small', { class: 'ci-kind' }, who, MP.iconEl('ban'), 'پیام آرشیو شد');
    var k = kindOf(l), x = l.x || {};
    var lab = { voice: ['mic', 'پیام صوتی'], photo: ['image', 'عکس'], video: ['video', 'ویدیو'], round: ['video', 'پیام ویدیویی'], file: ['clip', l.file ? l.file.name : 'فایل'], sticker: ['smile', 'استیکر'], gif: ['image', 'GIF'],
      poll: ['list', 'نظرسنجی: ' + (x.poll ? x.poll.q : '')], loc: ['pin', 'موقعیت مکانی' + (x.loc && x.loc.label ? ': ' + x.loc.label : '')], contact: ['user', 'مخاطب: ' + (x.contact ? x.contact.name : '')], card: ['tasks', x.card ? (x.card.t === 'task' ? 'تسک: ' : 'پروژه: ') + (x.card.title || '') : ''] }[k];
    var body = l.body ? plainText(l.body) : '';
    if (lab) return el('small', { class: 'ci-kind' }, who ? el('b', { text: who }) : null, MP.iconEl(lab[0]), body && k !== 'poll' && k !== 'loc' && k !== 'contact' ? body : lab[1]);
    return el('small', null, who ? el('b', { text: who }) : null, body);
  }
  /**
   * Swipe a conversation (phones): toward the left reveals «بی‌صدا · سنجاق · بایگانی» (a long swipe archives),
   * toward the right marks it read / unread.
   */
  var swOpen = null;
  function closeSwipe(except) { if (swOpen && swOpen !== except) { swOpen.classList.remove('sw-open'); $('.chat-item', swOpen).style.transform = ''; swOpen = null; } }
  document.addEventListener('pointerdown', function (e) { if (swOpen && !swOpen.contains(e.target)) closeSwipe(); }, true);
  function swipeRow(wrap, item, c) {
    var st = null, W = 216, LIMIT = 60;
    var act = function (ic, label, cls, fn) { return el('button', { type: 'button', class: 'cs-act ' + cls, onclick: function (e) { e.stopPropagation(); closeSwipe(); fn(); } }, MP.iconEl(ic), el('span', { text: label })); };
    var left = el('div', { class: 'cs-acts cs-left' },
      c.type !== 'saved' ? act(c.muted ? 'bell' : 'bell-off', c.muted ? 'صدادار' : 'بی‌صدا', 'cs-mute', function () { setMute(c, !c.muted); }) : null,
      c.pinned !== 'all' ? act('pin', c.pinned === 'me' ? 'برداشتن' : 'سنجاق', 'cs-pin', function () { setPin(c, 'me', c.pinned !== 'me'); }) : null,
      act('folder', c.arch_me ? 'بیرون آوردن' : 'بایگانی', 'cs-arch', function () { archiveChat(c, !c.arch_me); }));
    var right = el('div', { class: 'cs-acts cs-right' }, act(isUnread(c) ? 'checks' : 'chat', isUnread(c) ? 'خوانده شد' : 'نخوانده', 'cs-read', function () { toggleRead(c); }));
    wrap.prepend(left, right);
    item.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') st = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, on: false, base: wrap.classList.contains('sw-open') ? -W : 0 }; delete item.dataset.swiped; });
    item.addEventListener('pointermove', function (e) {
      if (!st || e.pointerId !== st.id) return;
      var dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.on) { if (Math.abs(dy) > 12) { st = null; return; } if (Math.abs(dx) < 14) return; st.on = true; closeSwipe(wrap); item.style.transition = 'none'; try { item.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ } }
      st.dx = Math.max(-wrap.offsetWidth * 0.85, Math.min(110, st.base + dx));
      item.style.transform = 'translateX(' + st.dx + 'px)';
      wrap.dataset.side = st.dx < 0 ? 'left' : 'right';
      var full = st.dx < -wrap.offsetWidth * 0.6;
      if (full !== wrap.classList.contains('sw-full')) { wrap.classList.toggle('sw-full', full); if (full) MP.haptic(12); }
      var armed = st.dx > LIMIT;
      if (armed !== wrap.classList.contains('sw-armed')) { wrap.classList.toggle('sw-armed', armed); if (armed) MP.haptic(10); }
    });
    function end(e) {
      if (!st || e.pointerId !== st.id) return;
      var s = st; st = null; if (!s.on) return;
      item.dataset.swiped = '1'; setTimeout(function () { delete item.dataset.swiped; }, 350);
      item.style.transition = 'transform .25s var(--ease)';
      var full = wrap.classList.contains('sw-full'), armed = wrap.classList.contains('sw-armed');
      wrap.classList.remove('sw-full', 'sw-armed');
      if (full) { item.style.transform = ''; wrap.classList.remove('sw-open'); archiveChat(c, !c.arch_me); return; }
      if (armed) { item.style.transform = ''; toggleRead(c); return; }
      if (s.dx < -LIMIT) { item.style.transform = 'translateX(' + -W + 'px)'; wrap.classList.add('sw-open'); swOpen = wrap; }
      else { item.style.transform = ''; wrap.classList.remove('sw-open'); if (swOpen === wrap) swOpen = null; }
    }
    item.addEventListener('pointerup', end);
    item.addEventListener('pointercancel', function () { if (st && st.on) { item.style.transform = st.base ? 'translateX(' + -W + 'px)' : ''; wrap.classList.remove('sw-full', 'sw-armed'); } st = null; });
  }
  function toggleRead(c) {
    if (isUnread(c)) markRead(c);
    else MP.api('channels/' + c.id + '/mark', { method: 'POST', body: { on: true } }).then(function (n) { replaceChannel(n); MP.toast('علامت نخوانده خورد', { icon: 'chat' }); }).catch(MP.soft);
  }
  function archiveChat(c, on) {
    MP.api('channels/' + c.id + '/archive', { method: 'POST', body: { on: on } }).then(function (n) {
      replaceChannel(n);
      if (on && current === c.id && MP.isMobile()) closeChat();
      MP.toast(on ? 'به بایگانی رفت' : 'از بایگانی بیرون آمد', { icon: 'folder', action: 'برگرداندن', onAction: function () { archiveChat(c, !on); } });
    }).catch(MP.soft);
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

  /** Nothing open (Esc, or no chats yet): Telegram's «یک گفت‌وگو را انتخاب کنید» on the wallpaper. */
  function noChat() {
    $('#composer').hidden = true;
    var pin = $('#chat-pinbar'); if (pin) pin.hidden = true;
    layout.classList.add('no-chat');
    var keys = FINE ? el('div', { class: 'cn-keys' }, el('span', null, el('kbd', { text: 'Ctrl K', dir: 'ltr' }), 'رفتن سریع'), el('span', null, el('kbd', { text: 'Ctrl 0', dir: 'ltr' }), 'ذخیره‌شده‌ها'), el('span', null, el('kbd', { text: 'Ctrl /', dir: 'ltr' }), 'همه میانبرها')) : null;
    box.replaceChildren(el('div', { class: 'chat-none' }, el('div', { class: 'cn-box' }, el('img', { src: (window.MP_CONFIG || {}).assets + 'img/chat-192.png', alt: '' }), el('span', { text: 'برای شروع، یک گفت‌وگو را انتخاب کنید' }), keys)));
  }
  function drawHead() {
    var c = chan(); if (!c) return;
    layout.classList.remove('no-chat');
    $('#chat-avatar').replaceChildren(channelIcon(c, 'sm'));
    $('#chat-title').replaceChildren(document.createTextNode(c.title));
    if (c.muted) $('#chat-title').append(el('i', { class: 'ci-mute', html: icon('bell-off') }));
    var sub = $('#chat-sub');
    var ls = c.type === 'direct' ? lastSeen(Math.max(seenOf(c.other), c.last_seen || 0)) : '';
    sub.classList.toggle('online', ls === 'آنلاین' && navigator.onLine);
    sub.textContent = !navigator.onLine ? 'در انتظار اتصال…' : c.type === 'direct' ? ls : c.settings && c.settings.mode === 'channel' ? 'کانال · ' + fa(c.members) + ' عضو' : c.type === 'saved' ? 'فقط خودتان می‌بینید' : c.pv ? 'خصوصی با مشتری · همکاران پروژه‌های این مشتری می‌بینند' : c.type === 'client' ? 'گروه مشتری · ' + c.client_name + (c.project_id && MP.project(c.project_id) ? ' · ' + MP.project(c.project_id).name : '') : fa(c.members) + ' عضو';
    schedBar();
    var tools = $('#chat-tools'); tools.replaceChildren();
    if (c.type === 'client') {
      // (the desktop shell hides these: the same actions are in the ⋯ menu, like Telegram's clean header)
      tools.append(el('button', { type: 'button', class: 'btn btn-secondary btn-sm tool-pill', text: 'لینک مشتری', onclick: function () { shareLink(c); } }));
      tools.append(el('button', { type: 'button', class: 'btn btn-secondary btn-sm tool-pill', html: icon('user') + (c.pv ? 'مشتری و ورود' : 'مشتریان و ظاهر'), onclick: function () { clientSettings(c); } }));
      if (c.project_id) tools.append(el('button', { type: 'button', class: 'btn btn-secondary btn-sm tool-pill', html: icon('eye') + 'پرتال', onclick: function () { MP.portal(c.project_id); } }));
    }
    if (c.settings && c.settings.topics) {
      tools.prepend(el('button', { type: 'button', class: 'icon-btn sm keep' + (topic ? '' : ' on'), title: 'تاپیک‌ها', 'aria-label': 'تاپیک‌ها', html: icon('list'), onclick: function () { select(c.id, 0, { topics: true }); } }));
      if (topic) sub.textContent = topic > 0 ? '# ' + (topicName(c.id, topic) || 'تاپیک') : 'همه تاپیک‌ها';
    }
    if (c.type !== 'saved') tools.append(el('button', { type: 'button', class: 'icon-btn sm keep', title: 'جلسه آنلاین', 'aria-label': 'جلسه آنلاین', html: icon('video'), onclick: function () { startMeeting(c); } }));
    tools.append(el('button', { type: 'button', class: 'icon-btn sm keep', title: 'جستجو در گفت‌وگو', 'aria-label': 'جستجو در گفت‌وگو', html: icon('search'), onclick: openFind }));
    if (FINE && !MP_CONFIG_POP()) tools.append(el('button', { type: 'button', class: 'icon-btn sm keep side-btn' + (sidePref() ? ' on' : ''), title: 'ستون اطلاعات', 'aria-label': 'نمایش یا پنهان کردن ستون اطلاعات', 'aria-pressed': String(sidePref()), html: icon('sidebar'), onclick: toggleSide }));
    tools.append(el('button', { type: 'button', class: 'icon-btn sm keep', 'aria-label': 'گزینه‌های گفت‌وگو', title: 'گزینه‌ها', html: icon('more'), onclick: function (e) { chatMenu(c, e.currentTarget); } }));
  }
  function startMeeting(c) {
    MP.meetingForm(c.type === 'client' ? { channelId: c.id, projectId: c.project_id, title: 'جلسه با ' + (c.client_name || c.title) } : { title: 'جلسه ' + c.title, people: c.member_ids });
  }
  /* A chat in its own small window: the Windows app opens one natively, a browser opens a popup. */
  function MP_CONFIG_POP() { return !!(window.MP_CONFIG && window.MP_CONFIG.pop); }
  function popOut(c) {
    var C2 = window.MP_CONFIG || {}, base = C2.chat && C2.chat.url;
    if (!base) return;
    if (MP.desktop) { MP.desktop.post({ t: 'popout', channel: c.id, title: c.title }); return; }
    var w = window.open(base + (base.indexOf('?') >= 0 ? '&' : '?') + 'pop=' + c.id + '#chat-' + c.id, 'mpchat' + c.id, 'popup,width=480,height=760');
    if (!w) MP.toast('مرورگر پنجره جدا را بست؛ اجازه پنجره بازشو را بدهید.', { error: true });
  }
  MP.popOut = function (id) { var c = chan(id); if (c) popOut(c); };

  /* Third column (wide screens, like Telegram Desktop): the chat's info, members, media and files beside it. */
  var sideEl = null;
  function sideWide() { return window.innerWidth >= 1200 && FINE; }
  function sidePref() { try { return localStorage.getItem('mp_chat_side') === '1'; } catch (e) { return false; } }
  function sideOn() { return sideWide() && sidePref() && !!current; }
  function drawSide() {
    if (!sideEl) { sideEl = el('aside', { class: 'card chat-side', id: 'chat-side', 'aria-label': 'اطلاعات گفت‌وگو' }); layout.append(sideEl); }
    layout.classList.toggle('side-open', sideOn());
    if (sideOn() && chan()) sideInfo(chan(), sideEl); else sideEl.replaceChildren();
  }
  function toggleSide() {
    try { localStorage.setItem('mp_chat_side', sidePref() ? '0' : '1'); } catch (e) { /* private */ }
    drawSide();
    var sb = $('#chat-tools .side-btn'); if (sb) { sb.classList.toggle('on', sidePref()); sb.setAttribute('aria-pressed', String(sidePref())); }
  }
  window.addEventListener('resize', function () { if (sideEl && layout.classList.contains('side-open') !== sideOn()) drawSide(); });
  $('#chat-who').onclick = function () { if (!current) return; if (sideWide()) toggleSide(); else chatInfo(chan()); };

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
    drawHead(); showPinned(null); downBtn(); drawSide();
    text.value = draftOf(id); composerState(); autoGrow();
    $('#composer').hidden = false;
    postLock(c); applyLook(c);
    var qrb = $('#quick-replies'); if (qrb) qrb.hidden = true;
    // A group with topics opens on its list of topics (unless a topic or a message was asked for).
    if (c.settings && c.settings.topics && !topic && (!jump || opts.topics)) { showTopics(c); liveRestart(); return; }
    if (c.marked) { c.marked = false; MP.api('channels/' + id + '/mark', { method: 'POST', body: { on: false } }).catch(function () {}); }
    c.unread = 0; renderList();
    var token = ++loopToken;
    // At once: the copy kept on this device; the server's answer replaces it a moment later.
    MP.kv.get(snapKey(id)).then(function (snap) {
      if (topic || token !== loopToken || !snap || !snap.messages || !snap.messages.length || !box.querySelector('.sk')) return;
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
  /* ------------------------------------------------------------ Look: wallpaper, colour and text size (per chat) */

  var WALLS = [
    ['', 'پیش‌فرض', ''],
    ['plain', 'ساده', 'none'],
    ['dots', 'نقطه‌ها', 'radial-gradient(rgba(127,127,127,.22) 1.5px, transparent 1.6px) 0 0/18px 18px'],
    ['sunset', 'غروب', 'linear-gradient(160deg,#ffcf9c 0%,#f28a24 55%,#b85e1a 100%)'],
    ['ocean', 'اقیانوس', 'linear-gradient(160deg,#89c2ff 0%,#3a6fd8 60%,#243b8a 100%)'],
    ['mint', 'نعنایی', 'linear-gradient(160deg,#d6f5e3 0%,#8fd3b1 60%,#3e9d77 100%)'],
    ['lilac', 'یاسی', 'linear-gradient(160deg,#efe1ff 0%,#b79af2 60%,#6b4bc2 100%)'],
    ['night', 'شب', 'linear-gradient(160deg,#16222a 0%,#2b3a4a 60%,#0f1418 100%)']
  ];
  var ACCENTS = ['', '#3a8ee6', '#2fa36b', '#8e5be8', '#e0559b', '#e5484d', '#6b7280'];
  var FONTS = [[0, 'پیش‌فرض', ''], [1, 'کوچک', '13.5px'], [2, 'معمولی', '14.5px'], [3, 'بزرگ', '16px'], [4, 'خیلی بزرگ', '18px']];
  function globalFont() { try { return +localStorage.getItem('mp_chat_font') || 0; } catch (e) { return 0; } }
  function globalWall() { try { return localStorage.getItem('mp_chat_wall') || ''; } catch (e) { return ''; } }
  function globalAccent() { try { return localStorage.getItem('mp_chat_bub') || ''; } catch (e) { return ''; } }
  /** For the settings: the wallpapers, text sizes and the defaults every chat without its own look uses. */
  MP.chatLooks = {
    walls: WALLS, fonts: FONTS, accents: ACCENTS,
    wall: globalWall, font: globalFont, accent: globalAccent,
    set: function (k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* private */ } if (current) applyLook(chan()); }
  };
  function applyLook(c) {
    var lk = (c && c.look) || {}, w = WALLS.filter(function (x) { return x[0] === (lk.bg || globalWall()); })[0] || WALLS[0], pane = box.parentNode;
    box.style.background = w[2] ? w[2] : '';
    if (w[0] === 'dots') box.style.backgroundColor = 'var(--chat-bg)';
    pane.style.setProperty('--bub-me', lk.accent || globalAccent());
    if (!lk.accent && !globalAccent()) pane.style.removeProperty('--bub-me');
    var f = FONTS[lk.font || globalFont()] || FONTS[0];
    if (f[2]) pane.style.setProperty('--msg-fs', f[2]); else pane.style.removeProperty('--msg-fs');
    pane.classList.toggle('dark-wall', w[0] === 'night' || w[0] === 'ocean');
  }
  function chatLook(c) {
    var lk = Object.assign({ bg: '', accent: '', font: 0 }, c.look || {});
    var prev = el('div', { class: 'lk-prev' });
    var body = el('div', { class: 'form lk' });
    function save() {
      MP.api('channels/' + c.id + '/look', { method: 'POST', body: lk }).then(function (d) { c.look = d.look[c.id] || null; if (current === c.id) applyLook(c); }).catch(MP.soft);
    }
    function draw() {
      var w = WALLS.filter(function (x) { return x[0] === lk.bg; })[0] || WALLS[0];
      prev.style.background = w[2] || ''; prev.className = 'lk-prev' + (w[2] ? '' : ' def');
      prev.style.setProperty('--bub-me', lk.accent || 'var(--brand)');
      prev.style.setProperty('--msg-fs', (FONTS[lk.font || globalFont()] || FONTS[0])[2] || '14.5px');
      prev.replaceChildren(el('span', { class: 'lk-b other', text: 'سلام! طرح جدید آماده است؟' }), el('span', { class: 'lk-b me', text: 'بله، همین الان می‌فرستم 👍' }));
      MP.emojify(prev);
      body.replaceChildren(prev,
        el('div', { class: 'field' }, el('span', { text: 'پس‌زمینه این گفت‌وگو' }), el('div', { class: 'lk-walls' }, WALLS.map(function (x) {
          return el('button', { type: 'button', class: 'lk-wall' + (lk.bg === x[0] ? ' on' : '') + (x[2] ? '' : ' def'), style: x[2] && x[2] !== 'none' ? { background: x[2] } : null, title: x[1], onclick: function () { lk.bg = x[0]; draw(); save(); } }, el('small', { text: x[1] }));
        }))),
        el('div', { class: 'field' }, el('span', { text: 'رنگ پیام‌های شما' }), el('div', { class: 'tp-colors' }, ACCENTS.map(function (x) {
          return el('button', { type: 'button', class: 'pe-color' + ((lk.accent || '') === x ? ' on' : ''), style: { background: x || 'var(--brand)' }, 'aria-label': x || 'پیش‌فرض', onclick: function () { lk.accent = x; draw(); save(); } });
        }))),
        el('div', { class: 'field' }, el('span', { text: 'اندازه متن پیام‌ها (همه گفت‌وگوها)' }), el('div', { class: 'seg' }, FONTS.slice(1).map(function (x) {
          return el('button', { type: 'button', 'aria-selected': String((globalFont() || 2) === x[0]), text: x[1], onclick: function () { try { localStorage.setItem('mp_chat_font', x[0]); } catch (e) { /* private mode */ } draw(); if (current) applyLook(chan()); } });
        }))));
    }
    draw();
    MP.dialog.open('ظاهر گفت‌وگو', body);
  }

  /* ------------------------------------------------------------ AI summary and quick replies */

  function summarize(c, all) {
    var body = MP.dialog.open('خلاصه هوشمند', el('div', { class: 'ai-sum' }, el('p', { class: 'hint', text: 'دستیار پنل در حال خواندن پیام‌هاست…' }), MP.skeleton(3)));
    MP.api('channels/' + c.id + '/summary', { method: 'POST', body: { all: all ? 1 : 0 } }).then(function (d) {
      var p = el('div', { class: 'ai-text', dir: 'auto' }); MP.chatKit.format(d.summary, p);
      body.replaceChildren(el('small', { class: 'hint', text: (d.unread ? 'خلاصه ' + fa(d.count) + ' پیام نخوانده' : 'خلاصه ' + fa(d.count) + ' پیام آخر') + ' «' + c.title + '»' }), MP.emojify(p),
        el('div', { class: 'dialog-actions' }, el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('copy') + 'کپی', onclick: function () { copyText(d.summary); } }),
          el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('bookmark') + 'ذخیره در پیام‌های ذخیره‌شده', onclick: function () { MP.api('channels/saved', { method: 'POST' }).then(function (sv) { return MP.api('channels/' + sv.id + '/messages', { method: 'POST', body: { body: '**خلاصه «' + c.title + '»**\n' + d.summary } }); }).then(function () { MP.toast('ذخیره شد'); MP.loadChannels(); }).catch(MP.soft); } })));
    }).catch(function (e) { body.replaceChildren(el('p', { class: 'hint', text: e.message })); });
  }
  /** One-tap answers under the last message from someone else («دریافت شد»، «بررسی می‌کنم»…). */
  function quickReplies() {
    var bar = $('#quick-replies');
    if (!bar) { bar = el('div', { id: 'quick-replies', class: 'quick-replies', hidden: true }); $('#composer').prepend(bar); }
    var c = chan();
    var last = Object.keys(msgs).map(function (k) { return msgs[k]; }).filter(function (m) { return typeof m.id === 'number' && m.kind !== 'system'; }).sort(function (a, b) { return b.id - a.id; })[0];
    var fresh = last && (Date.now() - new Date(String(last.created_at).replace(' ', 'T')).getTime()) < 2 * 864e5;
    if (!c || !last || last.mine || last.deleted || !fresh || text.value || editing || c.can_post === false || c.type === 'saved' || $('#composer').classList.contains('recording')) { bar.hidden = true; return; }
    var b = plainText(last.body || ''), k = kindOf(last), list;
    if (/[؟?]\s*$/.test(b) || /^(آیا|میشه|می‌شه|می‌تونی|میتونی)/.test(b)) list = ['بله', 'نه', 'بررسی می‌کنم', 'بعداً خبر می‌دم'];
    else if (/(ممنون|مرسی|متشکرم|سپاس)/.test(b)) list = ['خواهش می‌کنم 🌹', 'قربانت 🙏', 'وظیفه بود'];
    else if (k === 'photo' || k === 'file' || k === 'video') list = ['دریافت شد 👍', 'عالیه 👌', 'بررسی می‌کنم', 'نیاز به اصلاح داره'];
    else if (k === 'voice' || k === 'round') list = ['شنیدم 👍', 'باشه', 'بررسی می‌کنم'];
    else if (k === 'poll' || k === 'sticker') { bar.hidden = true; return; }
    else list = ['دریافت شد', 'باشه 👍', 'بررسی می‌کنم', 'ممنون 🙏'];
    // Folded behind a small arrow above the composer; a tap opens the answers (the choice is remembered).
    var open = false;
    try { open = localStorage.getItem('mp_qr_open') === '1'; } catch (e) { /* private mode */ }
    var chips = el('div', { class: 'qr-chips' }, list.map(function (t) { return el('button', { type: 'button', class: 'qr-chip', text: t, onclick: function () { bar.hidden = true; sendNow({ body: t }); } }); }));
    var tog = el('button', { type: 'button', class: 'qr-toggle', 'aria-expanded': String(open), 'aria-label': 'جواب‌های آماده', title: 'جواب‌های آماده', onclick: function () {
      open = !bar.classList.contains('open');
      bar.classList.toggle('open', open); tog.setAttribute('aria-expanded', String(open)); tog.innerHTML = icon(open ? 'arrow-down' : 'arrow-up');
      try { localStorage.setItem('mp_qr_open', open ? '1' : ''); } catch (e) { /* private mode */ }
    } });
    tog.innerHTML = icon(open ? 'arrow-down' : 'arrow-up');
    bar.classList.toggle('open', open);
    bar.replaceChildren(tog, chips);
    MP.emojify(chips);
    bar.hidden = false;
  }
  text.addEventListener('input', function () { var bar = $('#quick-replies'); if (bar) bar.hidden = !!text.value || bar.hidden; if (!text.value) quickReplies(); });

  /* ------------------------------------------------------------ Topics (a group split into separate conversations) */

  var topicNames = {};
  function topicName(chId, tid) { return (topicNames[chId] || {})[tid] || ''; }
  function showTopics(c) {
    topic = 0; $('#composer').hidden = true; $('#chat-locked') && ($('#chat-locked').hidden = true);
    var id = c.id;
    MP.api('channels/' + id + '/topics', { noCache: true }).then(function (d) {
      if (current !== id || topic) return;
      topicNames[id] = {}; d.topics.forEach(function (t) { topicNames[id][t.id] = t.title; });
      var wrap = el('div', { class: 'tp-list' },
        el('button', { type: 'button', class: 'tp-row tp-all', onclick: function () { select(id, 0, { topic: -1 }); } }, el('span', { class: 'tp-dot', html: icon('chat') }), el('span', { class: 'tp-copy' }, el('b', { text: 'همه پیام‌ها' }), el('small', { text: 'پیام‌های همه تاپیک‌ها با هم' }))),
        d.topics.map(function (t) {
          var row = el('button', { type: 'button', class: 'tp-row' + (t.closed ? ' closed' : ''), onclick: function () { select(id, 0, { topic: t.id }); } },
            el('span', { class: 'tp-dot', style: { background: t.color || 'var(--brand)' }, text: '#' }),
            el('span', { class: 'tp-copy' }, el('b', null, t.title, t.closed ? el('i', { class: 'ci-mute', html: icon('lock') }) : null), el('small', { text: t.last ? (t.last.mine ? 'شما' : t.last.author.split(' ')[0]) + ': ' + t.last.text : 'هنوز پیامی نیست' })),
            t.last ? el('time', { text: listTime(t.last.created_at) }) : null,
            t.unread ? el('span', { class: 'badge', text: fa(t.unread) }) : null);
          if (d.can_manage) longPress(row, function () { topicForm(c, t); });
          return row;
        }),
        d.can_manage ? el('button', { type: 'button', class: 'btn btn-secondary tp-new', html: icon('plus') + 'تاپیک جدید', onclick: function () { topicForm(c, null); } }) : null);
      box.replaceChildren(wrap);
      MP.emojify(wrap);
      $('#chat-sub').textContent = fa(d.topics.length) + ' تاپیک · ' + fa(c.members) + ' عضو';
    }).catch(function (e) { box.replaceChildren(MP.empty('chat', 'تاپیک‌ها باز نشد', e.message, null, true)); });
  }
  function topicForm(c, t) {
    var colors = ['#ff8a00', '#e5484d', '#8e5be8', '#3a8ee6', '#14a3a3', '#3fb96f', '#8e8e93'], color = t ? t.color : colors[0];
    var title = el('input', { class: 'input', maxlength: 80, required: true, value: t ? t.title : '', placeholder: 'مثلاً طراحی، چاپ، مالی' });
    var pal = el('div', { class: 'tp-colors' });
    function drawPal() { pal.replaceChildren.apply(pal, colors.map(function (x) { return el('button', { type: 'button', class: 'pe-color' + (x === color ? ' on' : ''), style: { background: x }, 'aria-label': x, onclick: function () { color = x; drawPal(); } }); })); }
    drawPal();
    var closed = el('input', { type: 'checkbox', checked: !!(t && t.closed) });
    var f = el('form', { class: 'form' }, MP.field('نام تاپیک', title), el('div', { class: 'field' }, el('span', { text: 'رنگ' }), pal),
      t ? el('label', { class: 'check' }, closed, el('span', { text: 'بسته (فقط مدیران می‌نویسند)' })) : null,
      el('div', { class: 'dialog-actions' }, el('button', { type: 'submit', class: 'btn btn-primary', text: t ? 'ذخیره' : 'ساخت تاپیک' }),
        t ? el('button', { type: 'button', class: 'btn btn-danger', text: 'حذف تاپیک', onclick: function () { MP.confirm('حذف تاپیک', 'پیام‌های «' + t.title + '» به تاپیک «عمومی» منتقل می‌شوند.', 'حذف').then(function (ok) { if (ok) MP.api('topics/' + t.id, { method: 'DELETE' }).then(function () { MP.dialog.close(); showTopics(c); }).catch(MP.soft); }); } }) : null));
    f.onsubmit = function (e) {
      e.preventDefault();
      MP.api('channels/' + c.id + '/topics', { method: 'POST', body: { topic_id: t ? t.id : 0, title: title.value, color: color, closed: closed.checked } }).then(function () { MP.dialog.close(); showTopics(c); }).catch(MP.soft);
    };
    MP.dialog.open(t ? 'ویرایش تاپیک' : 'تاپیک جدید', f);
  }
  /** Who may write here: a channel's members and read-only people see a bar instead of the composer. */
  function postLock(c) {
    var bar = $('#chat-locked');
    if (!bar) { bar = el('div', { id: 'chat-locked', class: 'chat-locked' }); $('#composer').after(bar); }
    var locked = c.can_post === false;
    bar.hidden = !locked;
    $('#composer').hidden = locked;
    if (locked) bar.replaceChildren(el('span', { text: c.post_why || 'در این گفت‌وگو نمی‌توانید پیام بفرستید.' }), el('button', { type: 'button', class: 'btn btn-ghost btn-sm', html: icon(c.muted ? 'bell' : 'bell-off') + (c.muted ? 'صدادار' : 'بی‌صدا'), onclick: function () { setMute(c, !c.muted); } }));
    var slow = c.settings && c.settings.slow && c.role !== 'admin';
    text.placeholder = slow ? 'حالت آهسته: هر ' + slowLabel(c.settings.slow) + ' یک پیام' : MP.isMobile() ? 'پیام…' : 'پیام… (Enter ارسال، Shift+Enter خط جدید)';
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
  var hasNewer = false, sumN = 0;
  /** Many unread messages and the AI assistant is on: offer a summary on the «unread» line. */
  function summaryChip() {
    sumN = 0;
    if (!S.boot.channels.ai || !unreadFrom) return;
    var n = Object.keys(msgs).filter(function (k) { var m = msgs[k]; return typeof m.id === 'number' && m.id >= unreadFrom && !m.mine && !m.deleted; }).length;
    if (n >= 12) { sumN = n; decorate(); }
  }
  /** Very long chats stay light: past ~500 rows, the oldest leave the page (scrolling up brings them back). */
  function trimRows() {
    var rows = $$('.msg-row, .sys-msg', box);
    if (rows.length < 500 || !atBottom()) return;
    var cut = rows.slice(0, rows.length - 400), gone = {};
    cut.forEach(function (r) { gone[r.dataset.id] = 1; Object.keys(rowsById).forEach(function (k) { if (rowsById[k] === r) { delete rowsById[k]; delete msgs[k]; delete mineRows[k]; } }); r.remove(); });
    var ids = Object.keys(msgs).map(Number).filter(function (x) { return !isNaN(x); });
    firstId = ids.length ? Math.min.apply(null, ids) : firstId; hasMore = true;
    decorate();
  }

  /** First page: the newest ~80 messages; then the unread line and the right scroll position. */
  function fetchFirst(token, around) {
    var q = { after: 0, topic: topic > 0 ? topic : '' };
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
      quickReplies();
      summaryChip(d);
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
    MP.api('channels/' + id + '/messages', { query: { after: lastId, since: since, topic: topic > 0 ? topic : '' }, noCache: true }).then(function (d) {
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
        quickReplies();
        trimRows();
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
    var key = m.album && !m.deleted && (kindOf(m) === 'photo' || kindOf(m) === 'video') ? m.album + ':' + (m.user_id || m.author) : '';
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
      if (!unreadDone && unreadFrom && typeof m.id === 'number' && m.id >= unreadFrom && !m.mine) {
        box.insertBefore(el('div', { class: 'unread-sep' }, el('span', { text: 'پیام‌های خوانده‌نشده' }),
          sumN ? el('button', { type: 'button', class: 'sum-chip', html: icon('list') + 'خلاصه ' + fa(sumN) + ' پیام نخوانده', onclick: function () { summarize(chan()); } }) : null), r);
        unreadDone = true; prev = null;
      }
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
    if (m.reply) b.append(quote(m.reply, m.x && m.x.quote, m.x && m.x.pt));
    var rv = (list[list.length - 1].x || {}).review || (m.x || {}).review;
    if (rv) b.append(el('span', { class: 'b-review ' + rv.state, html: icon(rv.state === 'ok' ? 'check' : 'edit') + (rv.state === 'ok' ? 'تأیید شد' : 'نیاز به اصلاح') + (rv.name ? ' · ' + esc(rv.name.split(' ')[0]) : '') }));
    var kind = kindOf(m), caps = list.map(function (x) { return x.body; }).filter(Boolean), caption = caps[0] || '';
    if (kind === 'sticker' || kind === 'gif') { b.append(stickerEl(m)); b.classList.add('b-sticker', 'media-only'); }
    else if (kind === 'round') { b.append(roundEl(m)); b.classList.add('b-sticker', 'media-only'); }
    else if (kind === 'poll') b.append(pollEl(m));
    else if (kind === 'loc') b.append(locEl(m));
    else if (kind === 'contact') b.append(contactEl(m));
    else if (kind === 'card') b.append(cardEl(m));
    else if (list.length > 1 || kind === 'photo' || kind === 'video' && list.length > 1) {
      b.append(album(list));
      if (!caption) b.classList.add('media-only');
    } else if (kind === 'voice') b.append(voiceBubble(m));
    else if (kind === 'video') { b.append(videoEl(m)); if (!caption) b.classList.add('media-only'); b.classList.add('has-album'); }
    else if (kind === 'file') b.append(fileCard(m));
    // An album whose photos have their own captions shows them all (each opens its photo in the viewer).
    if (caps.length > 1 && list.length > 1) {
      var capBox = el('div', { class: 'b-caps' });
      list.forEach(function (x, i) { if (x.body) capBox.append(el('button', { type: 'button', class: 'b-cap', onclick: function (e) { e.stopPropagation(); gallery(x.id); } }, el('i', { text: fa(i + 1) }), richText(x.body))); });
      b.append(capBox);
    } else if (caption && kind !== 'poll') b.append(richText(caption));
    // «#task» in the text: its live card under the message.
    var ref = caption && kind !== 'card' ? /\]\((task|project):(\d+)\)/.exec(caption) : null;
    if (ref) { var rt = /\[#?([^\]]+)\]\((?:task|project):/.exec(caption); b.append(cardEl({ x: { card: { t: ref[1], id: +ref[2], title: rt ? rt[1] : '', status: '' } } })); refreshCardsSoon(); }
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
    var meta = el('span', { class: 'b-meta' }, m.silent ? el('i', { class: 'b-silent', title: 'بی‌صدا فرستاده شد', html: icon('bell-off') }) : null, m.edited ? el('em', { class: 'b-edited', title: 'دیدن تاریخچه ویرایش', text: 'ویرایش‌شده', onclick: function (e) { e.stopPropagation(); editHistory(m); } }) : null, el('time', { text: hm(m.created_at) }));
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
  /** The quoted message (or only the part that was selected), and «a note on the design» with its point. */
  function quote(q, part, pt) {
    return el('button', { type: 'button', class: 'b-quote' + (part ? ' part' : '') + (pt ? ' pt' : ''), onclick: function (e) { e.stopPropagation(); jumpTo(q.id, pt); } },
      pt ? el('span', { class: 'bq-ico bq-pt', html: icon('pin') }) : q.kind === 'photo' ? el('span', { class: 'bq-ico', html: icon('image') }) : q.kind === 'voice' ? el('span', { class: 'bq-ico', html: icon('mic') }) : null,
      el('span', { class: 'bq-copy' }, el('b', { text: (q.mine ? 'شما' : q.author) + (pt ? ' · نظر روی طرح' : '') }), el('small', { text: part ? '«' + part + '»' : q.text || '…' })));
  }
  /** Photos: one fills the bubble; several sit in a Telegram-like mosaic. */
  function album(list) {
    var n = list.length, grid = el('div', { class: 'b-album n' + Math.min(n, 6) });
    list.forEach(function (x, i) {
      var vid = kindOf(x) === 'video', f = x.file, xx = x.x || {};
      // Progressive: the tiny blurred copy at once, then the screen-sized one (the original opens in the viewer).
      var src = vid ? (xx.thumb_url || '') : (n > 1 && f.mid ? f.mid : f.mid || f.url);
      var cell = el('button', { type: 'button', class: 'b-ph' + (vid ? ' is-vid' : ''), 'aria-label': vid ? 'پخش ویدیو' : 'دیدن عکس', style: f.thumb ? { backgroundImage: 'url(' + f.thumb + ')' } : null, onclick: function (e) { e.stopPropagation(); if (!selecting) gallery(x.id, cell); } },
        src ? el('img', { src: src, alt: f.name || '', loading: 'lazy', decoding: 'async', onload: function () { cell.classList.add('ld'); } }) : el('video', { src: f.url + '#t=0.5', muted: true, preload: 'metadata', playsinline: true }),
        vid ? el('span', { class: 'bv-play', html: icon('play') }) : null,
        vid && xx.dur ? el('span', { class: 'bv-dur', text: clock(xx.dur) }) : null);
      if (f.w && f.h && n === 1) cell.style.aspectRatio = Math.max(.6, Math.min(1.9, f.w / f.h));
      if (x.pending && x !== list[0]) cell.classList.add('ph-wait');
      if (n > 1 && x.body && i > 0) cell.title = x.body;
      // Six or more: three a row; a short last row stretches to the full width (no empty gap).
      if (n >= 6 && i >= n - n % 3) { cell.style.gridColumn = 'span ' + 6 / (n % 3); cell.style.aspectRatio = n % 3 === 1 ? '2 / 1' : '3 / 2'; }
      grid.append(cell);
      var img = cell.firstChild;
      if (n === 1 && !f.w && img.tagName === 'IMG') img.addEventListener('load', function () { var w = img.naturalWidth, h = img.naturalHeight; if (w && h) cell.style.aspectRatio = Math.max(.6, Math.min(1.9, w / h)); });
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
      return el('button', { type: 'button', class: 'b-react' + (x.mine ? ' mine' : ''), dataset: { e: x.emoji }, title: x.names.join('، '), onclick: function (e) { e.stopPropagation(); react(m, x.emoji); } },
        el('span', { class: 'br-e', text: x.emoji }), x.count > 1 || isGroup(chan()) ? el('span', { text: fa(x.count) }) : null);
    }));
  }

  /* Select part of a message's text: a «نقل‌قول» button appears; it replies quoting only that part. */
  (function () {
    var qb = el('button', { type: 'button', class: 'quote-fab', hidden: true, html: icon('reply') + 'نقل‌قول' });
    document.body.append(qb);
    var target = null;
    function check() {
      var s2 = window.getSelection(), t = s2 && String(s2).trim();
      if (!t || !s2.rangeCount || !current) { qb.hidden = true; return; }
      var node = s2.anchorNode && (s2.anchorNode.nodeType === 1 ? s2.anchorNode : s2.anchorNode.parentNode), row = node && node.closest && node.closest('.msg-row');
      if (!row || !box.contains(row) || !node.closest('.b-text') || selecting) { qb.hidden = true; return; }
      var m = msgs[row.dataset.id]; if (!m || typeof m.id !== 'number') { qb.hidden = true; return; }
      target = { m: m, part: t.slice(0, 600) };
      var rc = s2.getRangeAt(0).getBoundingClientRect();
      qb.hidden = false;
      qb.style.top = Math.max(8, rc.top - 42) + 'px';
      qb.style.left = Math.max(8, Math.min(innerWidth - qb.offsetWidth - 8, rc.left + rc.width / 2 - qb.offsetWidth / 2)) + 'px';
    }
    document.addEventListener('selectionchange', function () { clearTimeout(qb._t); qb._t = setTimeout(check, 180); });
    box.addEventListener('scroll', function () { qb.hidden = true; }, { passive: true });
    qb.addEventListener('pointerdown', function (e) { e.preventDefault(); });
    qb.onclick = function () { if (!target) return; qb.hidden = true; var t2 = target; window.getSelection().removeAllRanges(); startReply(t2.m, t2.part); };
  })();

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
  function jumpTo(id, pt) {
    var tries = 0;
    (function go() {
      var r = rowsById[id];
      if (r && pt && msgs[id] && msgs[id].file) { gallery(id, $('.b-ph', r), true, pt); return; }
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
  var playing = null; // the video playing with sound (round videos)

  /*
   * One voice player for the whole panel: the bar above the chat keeps playing while you move to another chat,
   * 1× / 1.5× / 2× speed, and the next voice of the same chat plays by itself (Telegram).
   */
  var VP = { audio: new Audio(), m: null, channel: 0, title: '', views: {}, rate: 1, probing: false, queue: [] };
  try { VP.rate = +localStorage.getItem('mp_voice_rate') || 1; } catch (e) { /* private mode */ }
  VP.audio.preload = 'metadata';
  MP.voicePlayer = VP;
  function vpDur() { var d = VP.audio.duration; return isFinite(d) && d > 0 ? d : (VP.m && VP.m.x && VP.m.x.dur) || 0; }
  function vpPaint() {
    var m = VP.m; if (!m) return;
    var v = VP.views[m.id], d = vpDur(), p = d ? VP.audio.currentTime / d : 0;
    if (v && v.bars.isConnected) {
      var n = Math.round(p * v.bars.children.length);
      Array.prototype.forEach.call(v.bars.children, function (b, k) { b.classList.toggle('on', k < n); });
      v.dur.textContent = clock(VP.probing ? 0 : VP.audio.currentTime || 0) + (d ? ' / ' + clock(d) : '');
    }
    var bar = $('#chat-player');
    if (bar) $('i.cp-prog', bar).style.width = p * 100 + '%';
  }
  function vpState() {
    Object.keys(VP.views).forEach(function (id) {
      var v = VP.views[id], on = VP.m && +id === VP.m.id && !VP.audio.paused;
      if (!v.btn.isConnected) { delete VP.views[id]; return; }
      v.btn.innerHTML = icon(on ? 'pause' : 'play'); v.btn.classList.toggle('on', on);
      v.speed.hidden = !(VP.m && +id === VP.m.id);
      v.speed.textContent = VP.rate === 1 ? '۱×' : VP.rate === 1.5 ? '۱٫۵×' : '۲×';
      if (!(VP.m && +id === VP.m.id)) { Array.prototype.forEach.call(v.bars.children, function (b) { b.classList.remove('on'); }); v.dur.textContent = clock(v.m.x && v.m.x.dur); }
    });
    playerBar();
  }
  function vpPlay(m, channel) {
    if (playing) { playing.pause(); playing = null; }
    if (VP.m && VP.m.id === m.id) { if (VP.audio.paused) VP.audio.play().catch(vpFail); else VP.audio.pause(); return; }
    VP.m = m; VP.channel = channel || current; VP.title = (chan(VP.channel) || {}).title || '';
    VP.audio.src = m.file.url; VP.audio.playbackRate = VP.rate;
    VP.audio.play().catch(vpFail);
    vpState();
  }
  function vpFail() { MP.toast('پخش این صدا در این مرورگر ممکن نشد.', { error: true }); }
  function vpStop() { VP.audio.pause(); VP.m = null; vpState(); }
  function vpNext() {
    // The next voice in the same chat (messages on screen), as Telegram plays a run of voices.
    if (!VP.m || VP.channel !== current) return null;
    return Object.keys(msgs).map(function (k) { return msgs[k]; }).filter(function (x) { return typeof x.id === 'number' && x.id > VP.m.id && kindOf(x) === 'voice' && !x.deleted; }).sort(function (a, b) { return a.id - b.id; })[0] || null;
  }
  VP.audio.addEventListener('loadedmetadata', function () {
    // WebM from MediaRecorder has no duration in its header: seeking far forces the browser to find it.
    if (VP.audio.duration === Infinity) { VP.probing = true; VP.audio.currentTime = 1e7; }
    VP.audio.playbackRate = VP.rate; vpPaint();
  });
  VP.audio.addEventListener('durationchange', function () { if (VP.probing && isFinite(VP.audio.duration)) { VP.probing = false; VP.audio.currentTime = 0; } vpPaint(); });
  VP.audio.addEventListener('timeupdate', vpPaint);
  VP.audio.addEventListener('play', vpState);
  VP.audio.addEventListener('pause', vpState);
  VP.audio.addEventListener('ended', function () {
    var next = vpNext();
    if (next) { vpPlay(next, VP.channel); var r = rowsById[next.id]; if (r && atBottom() === false) r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    else { VP.audio.currentTime = 0; vpStop(); }
  });
  function vpRate() {
    VP.rate = VP.rate === 1 ? 1.5 : VP.rate === 1.5 ? 2 : 1;
    VP.audio.playbackRate = VP.rate;
    try { localStorage.setItem('mp_voice_rate', VP.rate); } catch (e) { /* private mode */ }
    vpState();
  }
  /** The bar above the chat while a voice plays (stays when another chat is opened). */
  function playerBar() {
    var bar = $('#chat-player');
    if (!bar) {
      bar = el('div', { id: 'chat-player', class: 'chat-player', hidden: true },
        el('button', { type: 'button', class: 'icon-btn sm cp-play', 'aria-label': 'پخش / توقف', onclick: function () { if (VP.m) vpPlay(VP.m, VP.channel); } }),
        el('button', { type: 'button', class: 'cp-copy', onclick: function () { if (!VP.m) return; if (VP.channel !== current) select(VP.channel, VP.m.id); else jumpTo(VP.m.id); } }, el('b'), el('small')),
        el('button', { type: 'button', class: 'cp-rate', 'aria-label': 'سرعت پخش', onclick: vpRate }),
        el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'بستن پخش', html: icon('close'), onclick: vpStop }),
        el('i', { class: 'cp-prog' }));
      $('#chat-pinbar').before(bar);
    }
    bar.hidden = !VP.m;
    if (!VP.m) return;
    $('.cp-play', bar).innerHTML = icon(VP.audio.paused ? 'play' : 'pause');
    $('.cp-copy b', bar).textContent = VP.m.mine ? 'شما' : VP.m.author;
    $('.cp-copy small', bar).textContent = 'پیام صوتی' + (VP.title && VP.channel !== current ? ' · ' + VP.title : '');
    $('.cp-rate', bar).textContent = VP.rate === 1 ? '۱×' : VP.rate === 1.5 ? '۱٫۵×' : '۲×';
  }
  function voiceBubble(m) {
    var btn = el('button', { type: 'button', class: 'v-play', 'aria-label': 'پخش پیام صوتی', html: icon('play') });
    var bars = el('div', { class: 'v-wave' }), dur = el('span', { class: 'v-dur', text: clock(m.x && m.x.dur) });
    var wave = m.x && m.x.wave && m.x.wave.length ? m.x.wave : null;
    // The real waveform when it was recorded here; else a stable pseudo-waveform from the message id.
    for (var i = 0, n = 32, seed = (typeof m.id === 'number' ? m.id : 7) * 9301 + 49297; i < n; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      var h = wave ? 14 + wave[Math.floor(i * wave.length / n)] / 31 * 86 : 25 + seed / 233280 * 75;
      bars.append(el('i', { style: { height: h + '%' } }));
    }
    var speed = el('button', { type: 'button', class: 'v-speed', hidden: true, onclick: function (e) { e.stopPropagation(); vpRate(); } });
    btn.onclick = function (e) { e.stopPropagation(); if (typeof m.id === 'number' || m.file) vpPlay(m, current); };
    bars.onclick = function (e) {
      e.stopPropagation();
      if (!VP.m || VP.m.id !== m.id) { vpPlay(m, current); return; }
      var r = bars.getBoundingClientRect(), d = vpDur();
      if (d) { VP.audio.currentTime = (r.right - e.clientX) / r.width * d; vpPaint(); }
    };
    VP.views[m.id] = { btn: btn, bars: bars, dur: dur, speed: speed, m: m };
    var textBox = el('div', { class: 'v-text', hidden: true });
    var toText = el('button', { type: 'button', class: 'v-totext', text: 'متن' });
    toText.onclick = function (e) {
      e.stopPropagation();
      if (!textBox.hidden) { textBox.hidden = true; toText.classList.remove('on'); return; }
      function show(t) { textBox.textContent = t; textBox.hidden = false; toText.classList.add('on'); }
      if (m.transcript) { show(m.transcript); return; }
      toText.disabled = true; toText.textContent = '…';
      MP.api('messages/' + m.id + '/transcribe', { method: 'POST' })
        .then(function (d) { m.transcript = d.transcript; show(d.transcript); })
        .catch(MP.soft).then(function () { toText.disabled = false; toText.textContent = 'متن'; });
    };
    setTimeout(vpState, 0);
    return el('div', { class: 'v-msg' }, el('div', { class: 'v-row' }, btn, bars, el('div', { class: 'v-side' }, dur, el('span', { class: 'v-btns' }, speed, toText))), textBox);
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

  /*
   * Recorder, like Telegram: hold the microphone to record and let go to send; slide up to lock (then stop to
   * listen before sending), slide sideways to cancel. A quick tap switches between voice and round video.
   * MediaRecorder (webm/opus, or mp4/aac on iPhone); desktop Chrome also captures the text live.
   */
  var rec = null, recMode = 'voice', recPreview = null;
  try { recMode = localStorage.getItem('mp_rec_mode') === 'video' ? 'video' : 'voice'; } catch (e) { /* private mode */ }
  function pickMime() {
    if (!window.MediaRecorder) return null;
    var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac'];
    for (var i = 0; i < list.length; i++) if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(list[i])) return list[i];
    return '';
  }
  function micIcon() { var b = $('#composer-mic'), v = recMode === 'video'; b.innerHTML = icon(v ? 'video' : 'mic'); b.classList.toggle('is-video', v); b.setAttribute('aria-label', v ? 'پیام ویدیویی (نگه دارید)' : 'پیام صوتی (نگه دارید)'); b.title = (v ? 'پیام ویدیویی' : 'پیام صوتی') + ' — برای ضبط نگه دارید؛ برای ' + (v ? 'ویس' : 'پیام ویدیویی') + ' یک بار بزنید'; }
  function startRecording(hold) {
    if (!current || rec) return;
    var mime = pickMime();
    if (mime === null || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { MP.toast('ضبط صدا در این مرورگر پشتیبانی نمی‌شود.', { error: true }); return; }
    rec = { pending: true, hold: !!hold, locked: !hold, chunks: [], transcript: '', stopListen: null, cancelled: false };
    var me = rec;
    $('#composer').classList.add('recording'); $('#composer').classList.toggle('rec-hold', !!hold); $('#composer').classList.remove('rec-locked', 'rec-preview');
    $('#rec-bar').hidden = false; $('#rec-live').textContent = ''; $('#rec-time').textContent = clock(0);
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      if (rec !== me || me.cancelled) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      var mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), started = Date.now();
      me.mr = mr; me.stream = stream; me.started = started; me.pending = false;
      mr.ondataavailable = function (e) { if (e.data && e.data.size) me.chunks.push(e.data); };
      mr.start(250);
      MP.haptic && MP.haptic(15);
      // Level meter from the live stream.
      try {
        var ac = new (window.AudioContext || window.webkitAudioContext)(), an = ac.createAnalyser(), data = new Uint8Array(32);
        ac.createMediaStreamSource(stream).connect(an); an.fftSize = 64; me.ac = ac;
        var wave = $('#rec-wave'); wave.replaceChildren(); for (var i = 0; i < 18; i++) wave.append(el('i'));
        (function tick() {
          if (rec !== me || !me.mr || me.mr.state !== 'recording') return;
          an.getByteFrequencyData(data);
          Array.prototype.forEach.call(wave.children, function (b, k) { b.style.height = (15 + (data[k + 2] || 0) / 255 * 85) + '%'; });
          requestAnimationFrame(tick);
        })();
      } catch (e) { /* meter is optional */ }
      sendActivity('recording');
      me.timer = setInterval(function () {
        var s = (Date.now() - started) / 1000; $('#rec-time').textContent = clock(s); sendActivity('recording');
        if (s >= 300) finishRecording(true); // 5-minute cap
      }, 250);
      // Live text only where recognition and recording can share the mic (desktop).
      var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (MP.speechSupported && !mobile) {
        me.stopListen = MP.listen({ continuous: true, onText: function (t) { me.transcript = t; $('#rec-live').textContent = t; }, onError: function () {}, onEnd: function (t) { if (t) me.transcript = t; } });
      }
    }).catch(function () { if (rec === me) { rec = null; resetRecUi(); } MP.toast('اجازه دسترسی به میکروفون داده نشد.', { error: true }); });
  }
  function resetRecUi() { $('#composer').classList.remove('recording', 'rec-hold', 'rec-locked', 'rec-preview', 'rec-cancel-arm'); $('#rec-bar').hidden = true; var p = $('#rec-preview'); if (p) p.remove(); }
  /** mode: true = send now, false = cancel, 'preview' = stop and listen first. */
  function finishRecording(mode) {
    if (!rec) return;
    var r = rec;
    if (r.pending) { r.cancelled = true; rec = null; resetRecUi(); return; }
    rec = null;
    clearInterval(r.timer); sendActivity('idle');
    if (r.stopListen) r.stopListen();
    var dur = (Date.now() - r.started) / 1000;
    if (mode !== 'preview') resetRecUi();
    r.mr.onstop = function () {
      r.stream.getTracks().forEach(function (t) { t.stop(); });
      if (r.ac) r.ac.close();
      if (!mode) return;
      var type = (r.mr.mimeType || 'audio/webm').split(';')[0], ext = /mp4|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
      var blob = new Blob(r.chunks, { type: type });
      if (blob.size < 1500 || dur < 0.5) { resetRecUi(); MP.toast('پیام صوتی خیلی کوتاه بود؛ برای ضبط، دکمه را نگه دارید.'); return; }
      var file = new File([blob], 'voice-' + Date.now() + '.' + ext, { type: type });
      if (mode === 'preview') { previewVoice(file, r, dur); return; }
      sendVoice(file, r, dur);
    };
    r.mr.stop();
    MP.haptic && MP.haptic(10);
  }
  function sendVoice(file, r, dur) {
    // Shown at once; uploading happens behind the bubble. The real waveform goes with it.
    var rp = replyTo; clearCtx(false);
    MP.chatKit.waveform(file).then(function (w) {
      sendNow({ file: file, transcript: function () { return r.transcript || ''; }, reply: rp, x: w ? { wave: w.wave, dur: Math.round((w.dur || dur) * 10) / 10 } : { dur: Math.round(dur * 10) / 10 } });
    });
  }
  /** Locked recording stopped: play it back, then send or delete. */
  function previewVoice(file, r, dur) {
    var comp = $('#composer');
    comp.classList.remove('rec-hold', 'rec-locked'); comp.classList.add('recording', 'rec-preview');
    var audio = new Audio(URL.createObjectURL(file)), playBtn = el('button', { type: 'button', class: 'icon-btn v-play', 'aria-label': 'پخش', html: icon('play') });
    var bars = el('div', { class: 'v-wave' }), t = el('span', { class: 'rec-time', text: clock(dur) });
    MP.chatKit.waveform(file).then(function (w) {
      var wave = w ? w.wave : null;
      for (var i = 0; i < 40; i++) bars.append(el('i', { style: { height: (wave ? 18 + wave[Math.floor(i * wave.length / 40)] / 31 * 82 : 40) + '%' } }));
    });
    audio.ontimeupdate = function () { var n = Math.round((audio.currentTime / (audio.duration || dur)) * bars.children.length); Array.prototype.forEach.call(bars.children, function (b, k) { b.classList.toggle('on', k < n); }); t.textContent = clock(audio.currentTime); };
    audio.onended = function () { playBtn.innerHTML = icon('play'); };
    playBtn.onclick = function () { if (audio.paused) { audio.play(); playBtn.innerHTML = icon('pause'); } else { audio.pause(); playBtn.innerHTML = icon('play'); } };
    var box2 = el('div', { class: 'rec-preview', id: 'rec-preview' },
      el('button', { type: 'button', class: 'icon-btn danger', 'aria-label': 'حذف', html: icon('trash'), onclick: function () { audio.pause(); resetRecUi(); MP.toast('ویس حذف شد'); } }),
      playBtn, bars, t,
      el('button', { type: 'button', class: 'icon-btn accent lg', 'aria-label': 'ارسال ویس', html: icon('send'), onclick: function () { audio.pause(); resetRecUi(); sendVoice(file, r, dur); } }));
    $('#rec-bar').hidden = true;
    comp.append(box2);
  }
  (function () {
    // Tap: voice ↔ round video. Hold: record in that mode; slide up to lock, sideways to cancel, let go to send.
    var mic = $('#composer-mic'), st = null, round = null;
    micIcon();
    mic.addEventListener('pointerdown', function (e) {
      if (e.button || !current || rec || round) return;
      e.preventDefault();
      st = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId, started: false };
      try { mic.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ }
      st.timer = setTimeout(function () {
        if (!st) return;
        st.started = true;
        if (recMode === 'voice') startRecording(true); else holdRound();
      }, 220);
    });
    /** A round video started by holding the button; ends when the finger lifts unless slid up to lock. */
    function holdRound() {
      var ch = current, r = replyTo, ctl = {};
      round = { ctl: ctl, locked: false };
      MP.haptic && MP.haptic(15);
      MP.chatKit.recordRound(function () { sendActivity('video'); }, { hold: true, ctl: ctl }).then(function (v) {
        round = null; sendActivity('idle');
        if (v) { clearCtx(false); sendNow({ file: v.file, thumb: v.thumb, x: { round: 1, dur: Math.round(v.dur * 10) / 10 }, reply: r, channel: ch }); }
      });
    }
    function holding() { return rec && !rec.locked ? rec : round && !round.locked ? round : null; }
    mic.addEventListener('pointermove', function (e) {
      if (!st || !st.started) return;
      var h = holding(); if (!h) return;
      var dx = e.clientX - st.x, dy = e.clientY - st.y, arm = Math.abs(dx) > 90;
      if (h === rec) $('#composer').style.setProperty('--rec-dy', Math.min(0, dy) + 'px');
      if (dy < -70) {
        h.locked = true; MP.haptic(15);
        if (h === rec) { $('#composer').classList.remove('rec-hold', 'rec-cancel-arm'); $('#composer').classList.add('rec-locked'); }
        else h.ctl.lock && h.ctl.lock();
        return;
      }
      if (h === rec) $('#composer').classList.toggle('rec-cancel-arm', arm); else h.ctl.arm && h.ctl.arm(arm);
      h.armed = arm;
      if (Math.abs(dx) > 140) {
        st = null;
        if (h === rec) finishRecording(false); else h.ctl.finish && h.ctl.finish(false);
        MP.toast('ضبط لغو شد');
      }
    });
    function up() {
      if (!st) return;
      var s = st; st = null; clearTimeout(s.timer);
      $('#composer').style.removeProperty('--rec-dy');
      if (!s.started) {
        // A quick tap only switches the mode (as in Telegram).
        recMode = recMode === 'voice' ? 'video' : 'voice';
        try { localStorage.setItem('mp_rec_mode', recMode); } catch (er) { /* private mode */ }
        micIcon(); MP.haptic(8);
        mic.classList.remove('mic-flip'); void mic.offsetWidth; mic.classList.add('mic-flip');
        MP.toast(recMode === 'video' ? 'پیام ویدیویی؛ برای ضبط نگه دارید' : 'پیام صوتی؛ برای ضبط نگه دارید', { icon: recMode === 'video' ? 'video' : 'mic' });
        return;
      }
      var h = holding(); if (!h) return;
      if (h === rec) {
        if ($('#composer').classList.contains('rec-cancel-arm')) { finishRecording(false); MP.toast('ضبط لغو شد'); }
        else finishRecording(true);
      } else if (h.ctl.finish) {
        h.ctl.finish(!h.armed);
        if (h.armed) MP.toast('ضبط لغو شد');
      }
    }
    mic.addEventListener('pointerup', up);
    mic.addEventListener('pointercancel', up);
    mic.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  })();
  $('#rec-send').onclick = function () { finishRecording(true); };
  $('#rec-stop').onclick = function () { finishRecording('preview'); };
  $('#rec-cancel').onclick = function () { finishRecording(false); MP.toast('ضبط لغو شد'); };


  /* ------------------------------------------------------------ Composer: text, emoji, mentions, draft, reply/edit bar */

  var replyTo = null, editing = null, replyPart = '';
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
    replyTo = null; editing = null; replyPart = ''; $('#compose-ctx').hidden = true;
    if (wasEdit && keepText !== false) { text.value = draftOf(current); autoGrow(); }
    composerState();
  }
  $('#cc-x').onclick = function () { clearCtx(); };
  function startReply(m, part) { if (editing) clearCtx(); replyTo = m; setCtx('reply', m); replyPart = part || ''; if (replyPart) { $('#cc-text').textContent = '«' + replyPart + '»'; MP.emojify($('#cc-text')); } }
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
  var pop = $('#emoji-pop'), emoTab = 1, panelKind = 'emoji';
  function closeEmoji() { pop.hidden = true; }
  function recentEmoji() { try { return JSON.parse(localStorage.getItem('mp_emoji_recent') || '[]'); } catch (e) { return []; } }
  function drawEmoji() {
    if (panelKind !== 'emoji') { pop.replaceChildren(kindsBar(), stickerPane(panelKind)); return; }
    var list = emoTab === 0 ? recentEmoji() : EMOJI[emoTab][2].split(' ');
    var grid = el('div', { class: 'ep-grid' }, list.length ? list.map(function (e) { return el('button', { type: 'button', 'aria-label': e, onclick: function () { pickEmoji(e); } }, MP.emojiImg(e)); }) : el('p', { class: 'ep-none', text: 'هنوز ایموجی‌ای نفرستاده‌اید' }));
    var tabs = el('div', { class: 'ep-tabs' }, EMOJI.map(function (c, i) { return el('button', { type: 'button', class: i === emoTab ? 'on' : '', title: c[1], 'aria-label': c[1], onclick: function () { emoTab = i; drawEmoji(); } }, MP.emojiImg(c[0])); }));
    pop.replaceChildren(kindsBar(), el('div', { class: 'ep-title', text: EMOJI[emoTab][1] }), grid, tabs);
  }
  /** Emoji · stickers · GIFs, like Telegram's panel. */
  function kindsBar() {
    return el('div', { class: 'ep-kinds seg', role: 'tablist' }, [['emoji', 'ایموجی'], ['sticker', 'استیکر'], ['gif', 'GIF']].map(function (k) {
      return el('button', { type: 'button', 'aria-selected': String(panelKind === k[0]), text: k[1], onclick: function () { panelKind = k[0]; drawEmoji(); } });
    }));
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
  var mKind = '@';
  function mentionCheck() {
    var c = chan(), pos = text.selectionStart, before = text.value.slice(0, pos), m = before.match(/(^|\s)@([^\s@]*)$/);
    // «#»: a task or project of the panel, inserted as a link that opens it (and shows its card).
    var h = before.match(/(^|\s)#([^\s#]*)$/);
    if (c && h) {
      var hq = MP.norm(h[2]);
      var tl = S.tasks.filter(function (t) { return !hq || MP.norm(t.title).indexOf(hq) >= 0; }).sort(function (a, b) { return (b.project_id === c.project_id) - (a.project_id === c.project_id) || b.id - a.id; }).slice(0, 6).map(function (t) { return { t: 'task', id: t.id, name: t.title, sub: (MP.STATUS[t.status] || '') + (t.project_id && MP.project(t.project_id) ? ' · ' + MP.project(t.project_id).name : '') }; });
      var pl = S.projects.filter(function (p) { return !hq || MP.norm(p.name).indexOf(hq) >= 0; }).slice(0, 3).map(function (p) { return { t: 'project', id: p.id, name: p.name, sub: 'پروژه' }; });
      mList = pl.concat(tl);
      if (mList.length) { mKind = '#'; mStart = pos - h[2].length - 1; mIdx = 0; drawMentions(); return; }
    }
    mKind = '@';
    if (!c || !isGroup(c) || !m) { mPop.hidden = true; return; }
    mStart = pos - m[2].length - 1;
    var q = MP.norm(m[2]);
    mList = (c.member_ids || []).filter(function (id) { return id !== S.me.id; }).map(MP.user).filter(function (u) { return !q || MP.norm(u.name).indexOf(q) >= 0; }).slice(0, 6);
    if (!mList.length) { mPop.hidden = true; return; }
    mIdx = 0; drawMentions();
  }
  function drawMentions() {
    mPop.replaceChildren.apply(mPop, mList.map(function (u, i) {
      if (mKind === '#') return el('button', { type: 'button', class: i === mIdx ? 'on' : '', onpointerdown: function (e) { e.preventDefault(); pickMention(u); } }, el('span', { class: 'mp-ref', html: icon(u.t === 'task' ? 'tasks' : 'folder') }), el('span', null, el('b', { text: u.name }), el('small', { text: u.sub })));
      return el('button', { type: 'button', class: i === mIdx ? 'on' : '', onpointerdown: function (e) { e.preventDefault(); pickMention(u); } }, MP.avatar(u, 'sm'), el('span', null, el('b', { text: u.name }), u.title ? el('small', { text: u.title }) : null));
    }));
    mPop.hidden = false;
  }
  function pickMention(u) {
    var pos = text.selectionStart;
    if (mKind === '#') {
      var ins = '[#' + u.name.replace(/[\[\]]/g, '') + '](' + u.t + ':' + u.id + ') ';
      text.value = text.value.slice(0, mStart) + ins + text.value.slice(pos);
      text.setSelectionRange(mStart + ins.length, mStart + ins.length);
      mPop.hidden = true; text.focus(); composerState(); return;
    }
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

  var SYS_ICON = { task: 'tasks', design: 'eye', file: 'download', invoice: 'file', join: 'user', contract: 'edit' };
  var seq = 0, queue = Promise.resolve();
  function nowStamp() { var d = new Date(); return S.today + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }
  /** o: {body, file, transcript, reply, album, asFile, channel, x, silent, sendAt, stickerId, thumb, quote} */
  function sendNow(o) {
    var channel = o.channel || current, f = o.file;
    if (o.topic === undefined) o.topic = channel === current && topic > 0 ? topic : 0;
    if (o.quote) o.x = Object.assign({}, o.x || {}, { quote: o.quote });
    var m = { id: 'tmp' + (++seq), mine: true, pending: true, body: o.body || '', author: S.me.name, user_id: S.me.id, created_at: nowStamp(), seen_by: 0,
      reply: o.reply ? { id: o.reply.id, author: o.reply.author, text: snippet(o.reply), kind: kindOf(o.reply), mine: o.reply.mine } : null,
      album: o.album || '', as_file: !!o.asFile, reactions: [], x: o.x ? Object.assign({}, o.x) : null, silent: !!o.silent,
      file: f ? { url: URL.createObjectURL(f), name: f.name, mime: f.type || 'application/octet-stream', size: f.size, image: /^image\//.test(f.type) } : null };
    if (o.sticker) { m.file = { url: o.sticker.url, name: 'sticker', mime: o.sticker.mime, size: 0, image: true }; }
    m.o = o; m.channel = channel;
    if (o.sendAt) { post(m); return m; } // «send later»: no bubble; it appears when it is sent
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
    var up = f && !o.fileId ? slot(function () { return uploadResumable(m, f, channel, function (p) { var r = rowsById[m.id]; if (r && r._bar) $('i', r._bar).style.width = p * 100 + '%'; }); }) : Promise.resolve(o.fileId ? { id: o.fileId } : null);
    // A video's first frame goes up too, so the bubble shows it before anything plays.
    if (o.thumb && !o.thumbId) up = up.then(function (file) { return MP.upload('files', o.thumb, { context: 'message', context_id: channel }).then(function (t) { o.thumbId = t.id; return file; }, function () { return file; }); });
    // Posts go one after another so messages keep their order: each waits for the one sent before it.
    var before = queue;
    var done = up.then(function (file) {
      if (file) o.fileId = file.id;
      return before.then(function () {
        var x = Object.assign({}, o.x || {});
        if (o.thumbId) x.thumb = o.thumbId;
        return MP.api('channels/' + channel + '/messages', { method: 'POST', body: { body: m.body, file_id: file ? file.id : 0, transcript: typeof o.transcript === 'function' ? o.transcript() : '', reply_to: o.reply ? o.reply.id : 0, album: o.album || '', as_file: o.asFile ? 1 : 0, x: x, silent: o.silent ? 1 : 0, send_at: o.sendAt || '', topic_id: o.topic || 0, sticker_id: o.sticker ? o.sticker.id : 0 } });
      });
    });
    queue = done.catch(function () {});
    done.then(function (real) {
      dropOutbox(m); dropUpload(m);
      if (real && real.scheduled) {
        MP.toast('در ' + J.format(real.scheduled.send_at.slice(0, 10), false) + ' ساعت ' + MP.timeFa(real.scheduled.send_at.slice(11, 16)) + ' فرستاده می‌شود', { icon: 'clock', action: 'پیام‌های زمان‌دار', onAction: scheduledList });
        var ch = chan(channel); if (ch) { ch.sched = (ch.sched || 0) + 1; if (channel === current) schedBar(); }
        return;
      }
      if (m.file && !o.sticker) setTimeout(function () { URL.revokeObjectURL(m.file.url); }, 60000);
      if (channel !== current) return MP.loadChannels();
      swapReal(m, real);
      MP.loadChannels();
    }).catch(function (err) {
      var offline = !navigator.onLine || /اینترنت/.test(err.message || '');
      m.pending = false; m.failed = true; m.offline = offline;
      if (err && err.code === 'mp_slow') { removeRow(m.id); MP.toast(err.message, { icon: 'clock' }); if (!f && channel === current && !text.value) { text.value = m.body; autoGrow(); composerState(); } return; }
      if (o.sendAt) { MP.soft(err); return; }
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

  /*
   * Files bigger than 1 MB stay on the device (IndexedDB) until they are sent: if the page is closed half way,
   * the upload continues from where it stopped the next time the panel opens.
   */
  function uploads() { return MP.kv.get('uploads').then(function (l) { return l || {}; }); }
  function uploadResumable(m, f, channel, onProg) {
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 12) + 'up', o = m.o;
    o.upId = id;
    if (f.size > 1048576) uploads().then(function (l) {
      l[id] = { id: id, channel: channel, file: f, body: m.body, album: o.album || '', asFile: !!o.asFile, reply: o.reply ? o.reply.id : 0, x: o.x || null, silent: !!o.silent, topic: o.topic || 0, at: Date.now() };
      return MP.kv.set('uploads', l);
    });
    if (channel === current) sendActivity('uploading');
    return MP.uploadChunked('chat-upload', f, { context_id: channel }, onProg, { id: id });
  }
  function dropUpload(m) { var id = m.o && m.o.upId; if (id) uploads().then(function (l) { if (l[id]) { delete l[id]; MP.kv.set('uploads', l); } }); }
  function resumeUploads() {
    uploads().then(function (l) {
      var list = Object.keys(l).map(function (k) { return l[k]; }).filter(function (u) { return u && u.file && Date.now() - u.at < 7 * 864e5; });
      if (!list.length) return;
      MP.toast('ادامه ارسال ' + fa(list.length) + ' فایل نیمه‌کاره…', { icon: 'clip' });
      list.reduce(function (p, u) {
        return p.then(function () {
          return MP.api('chat-upload/status', { query: { upload: u.id }, noCache: true }).then(function (st) {
            return MP.uploadChunked('chat-upload', u.file, { context_id: u.channel }, null, { id: u.id, start: st.next || 0 });
          }).then(function (file) {
            return MP.api('channels/' + u.channel + '/messages', { method: 'POST', body: { body: u.body, file_id: file.id, reply_to: u.reply, album: u.album, as_file: u.asFile ? 1 : 0, x: u.x || {}, silent: u.silent ? 1 : 0, topic_id: u.topic } });
          }).then(function () {
            return uploads().then(function (l2) { delete l2[u.id]; return MP.kv.set('uploads', l2); });
          }).catch(function (err) { if (err && err.status && err.status < 500) return uploads().then(function (l2) { delete l2[u.id]; return MP.kv.set('uploads', l2); }); });
        });
      }, Promise.resolve()).then(function () { MP.loadChannels(); if (current) pull(); });
    });
  }
  setTimeout(resumeUploads, 3000);

  /* ------------------------------------------------------------ Scheduled messages */

  function schedBar() {
    var c = chan(), bar = $('#chat-sched');
    if (!bar) { bar = el('button', { type: 'button', id: 'chat-sched', class: 'chat-sched', onclick: scheduledList }); $('#composer').before(bar); }
    var n = c ? c.sched || 0 : 0;
    bar.hidden = !n;
    bar.replaceChildren(MP.iconEl('clock'), el('span', { text: fa(n) + ' پیام زمان‌دار در صف ارسال' }));
  }
  function scheduledList() {
    var id = current, body = MP.dialog.open('پیام‌های زمان‌دار', MP.skeleton(2));
    function load() {
      MP.api('channels/' + id + '/scheduled', { noCache: true }).then(function (l) {
        var c = chan(id); if (c) { c.sched = l.length; if (id === current) schedBar(); }
        if (!l.length) { body.replaceChildren(el('p', { class: 'muted', text: 'پیام زمان‌داری در صف نیست.' })); return; }
        body.replaceChildren(el('div', { class: 'tio-history' }, l.map(function (x) {
          return el('article', { class: 'tpl-card' }, el('span', { class: 'cs-ico', html: icon('clock') }),
            el('div', { class: 'tpl-copy' }, el('strong', { text: x.text || (x.file ? x.file.name : '…'), dir: 'auto' }), el('small', { text: J.format(x.send_at.slice(0, 10), false) + ' ساعت ' + MP.timeFa(x.send_at.slice(11, 16)) + (x.silent ? ' · بی‌صدا' : '') })),
            el('div', { class: 'tpl-actions' },
              el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('send') + 'همین حالا', onclick: function () { MP.api('scheduled/' + x.id + '/now', { method: 'POST' }).then(function () { MP.toast('فرستاده شد'); load(); if (id === current) pull(); }).catch(MP.soft); } }),
              el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'حذف', html: icon('trash'), onclick: function () { MP.api('scheduled/' + x.id, { method: 'DELETE' }).then(load).catch(MP.soft); } })));
        })));
      }).catch(MP.soft);
    }
    load();
  }

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
    sendText(body, {});
  };
  /** Sends the composer's text (opts: silent, sendAt). */
  function sendText(body, opts) {
    text.value = ''; autoGrow(); sendActivity('idle'); saveDraft(current, ''); mPop.hidden = true; pop.hidden = true;
    var r = replyTo, part = replyPart; clearCtx(false); composerState();
    sendNow({ body: body, reply: r, quote: part, silent: opts.silent, sendAt: opts.sendAt });
    if (MP.isMobile()) text.focus();
  }
  /* Hold (or right-click) the send button: «send without sound» and «send later», like Telegram. */
  (function () {
    var btn = $('#composer .composer-send'), timer = 0, fired = false;
    function menu() {
      var body = text.value.trim();
      if (!body || editing) return;
      fired = true; MP.haptic(15);
      if (openMenu) openMenu();
      var m = el('div', { class: 'ctx-menu send-menu in', role: 'menu' },
        el('button', { type: 'button', role: 'menuitem', onclick: function () { close(); sendText(text.value.trim(), { silent: true }); } }, MP.iconEl('bell-off'), el('span', { text: 'ارسال بی‌صدا' })),
        el('button', { type: 'button', role: 'menuitem', onclick: function () { close(); MP.chatKit.pickTime('ارسال پیام در زمان مشخص').then(function (at) { if (at && text.value.trim()) sendText(text.value.trim(), { sendAt: at }); }); } }, MP.iconEl('clock'), el('span', { text: 'ارسال در زمان مشخص' })));
      var shade = el('div', { class: 'ctx-shade', onclick: close });
      document.body.append(shade, m);
      var r = btn.getBoundingClientRect();
      m.style.top = Math.max(8, r.top - m.offsetHeight - 8) + 'px';
      m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.left)) + 'px';
      function close() { if (openMenu !== close) return; openMenu = null; shade.remove(); m.remove(); }
      openMenu = close;
    }
    btn.addEventListener('pointerdown', function (e) { if (e.button) return; fired = false; timer = setTimeout(menu, 450); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { btn.addEventListener(ev, function () { clearTimeout(timer); }); });
    btn.addEventListener('click', function (e) { if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; } }, true);
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); clearTimeout(timer); menu(); });
  })();
  MP.chatKit.formatBar(text, $('#composer'));
  $('#composer .composer-send').addEventListener('pointerdown', function (e) { if (MP.isMobile()) e.preventDefault(); }); // keep the keyboard open

  /* ------------------------------------------------------------ Attach: photos (album) or files, like Telegram */

  // Each picker sends its own way: gallery → photos, «without compression» and «file» → as files.
  var pickMode = '';
  ['composer-file', 'composer-media', 'composer-camera', 'composer-doc'].forEach(function (id) {
    $('#' + id).onchange = function (e) { var files = Array.prototype.slice.call(e.target.files || []); e.target.value = ''; closeAttach(); sendSheet(files, pickMode); pickMode = ''; };
  });

  /** Round video: recorded in a circle and sent as soon as «ارسال» is pressed. */
  function recordRound() {
    if (!current) return;
    var ch = current, r = replyTo; clearCtx(false);
    MP.chatKit.recordRound(function () { sendActivity('video'); }).then(function (v) {
      sendActivity('idle');
      if (v) sendNow({ file: v.file, thumb: v.thumb, x: { round: 1, dur: Math.round(v.dur * 10) / 10 }, reply: r, channel: ch });
    });
  }

  /* Stickers and GIFs: the studio's packs (supervisors add them) and the shared GIFs (anyone can save one). */
  var stickerData = null;
  function loadStickers() { return MP.api('stickers').then(function (d) { stickerData = d; return d; }); }
  function sendSticker(s2) { closeEmoji(); sendNow({ body: '', sticker: s2, x: s2.kind === 'gif' ? { gif: 1 } : { sticker: 1 } }); }
  function openStickers() { if (pop.hidden) { $('#composer-emoji').click(); } panelKind = 'sticker'; drawEmoji(); }
  function stickerPane(kind) {
    var wrap = el('div', { class: 'ep-grid ep-stk' }, el('p', { class: 'ep-none', text: 'در حال بارگذاری…' }));
    (stickerData ? Promise.resolve(stickerData) : loadStickers()).then(function (d) {
      var items = kind === 'gif' ? d.gifs : [];
      if (kind !== 'gif') d.packs.forEach(function (p) { items = items.concat(p.items); });
      wrap.replaceChildren.apply(wrap, items.map(function (x) {
        return el('button', { type: 'button', class: 'ep-st', title: x.pack || 'GIF', onclick: function () { sendSticker(x); } }, el('img', { src: x.url, alt: x.emoji || '', loading: 'lazy' }));
      }));
      if (!items.length) wrap.append(el('p', { class: 'ep-none', text: kind === 'gif' ? 'هنوز GIF ذخیره نشده؛ روی هر GIF در گفت‌وگو نگه دارید و «ذخیره در GIFها» را بزنید، یا از دکمه زیر یکی بارگذاری کنید.' : d.can_manage ? 'هنوز استیکری نیست؛ از دکمه زیر بسته استیکر استودیو را بسازید.' : 'هنوز استیکری نیست؛ ناظر می‌تواند بسته استیکر استودیو را بسازد.' }));
      if (kind === 'gif' || d.can_manage) wrap.append(el('button', { type: 'button', class: 'ep-add', html: icon('plus') + (kind === 'gif' ? 'بارگذاری GIF' : 'مدیریت استیکرها'), onclick: function () { kind === 'gif' ? uploadGif() : stickerManager(); } }));
    }).catch(function () { wrap.replaceChildren(el('p', { class: 'ep-none', text: 'استیکرها باز نشد.' })); });
    return wrap;
  }
  function uploadGif() {
    var inp = el('input', { type: 'file', accept: 'image/gif' });
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return;
      MP.upload('stickers', f, { kind: 'gif' }).then(function (d) { stickerData = d; MP.toast('GIF ذخیره شد'); drawEmoji(); }).catch(MP.soft);
    };
    inp.click();
  }
  function stickerManager() {
    var body = MP.dialog.open('استیکرهای استودیو', MP.skeleton(2), { wide: true });
    function draw(d) {
      stickerData = d;
      var pack = el('input', { class: 'input', maxlength: 60, placeholder: 'نام بسته، مثلاً «مربع»', value: d.packs[0] ? d.packs[0].name : 'مربع' });
      var emoji = el('input', { class: 'input', maxlength: 4, placeholder: 'ایموجی هم‌معنی (اختیاری)' });
      var inp = el('input', { type: 'file', accept: 'image/png,image/webp,image/gif', multiple: true, hidden: true });
      inp.onchange = function () {
        var files = Array.prototype.slice.call(inp.files);
        files.reduce(function (p, f) { return p.then(function () { return MP.upload('stickers', f, { kind: 'sticker', pack: pack.value || 'مربع', emoji: emoji.value }); }); }, Promise.resolve())
          .then(function () { MP.toast(fa(files.length) + ' استیکر اضافه شد'); return loadStickers(); }).then(draw).catch(MP.soft);
      };
      body.replaceChildren(
        el('p', { class: 'hint', text: 'تصویر PNG یا WebP با پس‌زمینه شفاف (حدود ۵۱۲×۵۱۲) بهترین نتیجه را دارد. استیکرها برای همه همکاران و مشتریان نمایش داده می‌شوند.' }),
        el('div', { class: 'form-row' }, MP.field('بسته', pack), MP.field('ایموجی', emoji)), inp,
        el('button', { type: 'button', class: 'btn btn-primary', html: icon('plus') + 'افزودن استیکر', onclick: function () { inp.click(); } }),
        el('div', { class: 'stk-admin' }, d.packs.map(function (p) {
          return el('section', null, el('h4', { text: p.name + ' (' + fa(p.items.length) + ')' }), el('div', { class: 'stk-grid' }, p.items.map(function (x) {
            return el('span', { class: 'stk-item' }, el('img', { src: x.url, alt: '' }), el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'حذف', html: icon('close'), onclick: function () { MP.api('stickers/' + x.id, { method: 'DELETE' }).then(draw).catch(MP.soft); } }));
          })));
        })));
    }
    loadStickers().then(draw).catch(MP.soft);
  }
  /** «#»-card: a task or project from the panel, shown live inside the chat. */
  function pickCard() {
    var q = el('input', { type: 'search', class: 'input', placeholder: 'جستجوی تسک یا پروژه…' }), list = el('div', { class: 'menu ct-list' });
    function draw() {
      var nq = MP.norm(q.value), c = chan();
      var tasks = S.tasks.filter(function (t) { return !nq || MP.norm(t.title).indexOf(nq) >= 0; }).sort(function (a, b) { return (c && b.project_id === c.project_id) - (c && a.project_id === c.project_id) || (b.id - a.id); }).slice(0, 12);
      var projects = S.projects.filter(function (p) { return !nq || MP.norm(p.name).indexOf(nq) >= 0; }).slice(0, 6);
      list.replaceChildren.apply(list, projects.map(function (p) {
        return el('button', { type: 'button', onclick: function () { MP.dialog.close(); sendNow({ body: '', x: { card: { t: 'project', id: p.id, title: p.name } } }); } }, MP.iconEl('folder'), el('span', null, el('strong', { text: p.name }), el('small', { class: 'muted', text: 'پروژه' })));
      }).concat(tasks.map(function (t) {
        return el('button', { type: 'button', onclick: function () { MP.dialog.close(); sendNow({ body: '', x: { card: { t: 'task', id: t.id, title: t.title } } }); } }, MP.iconEl('tasks'), el('span', null, el('strong', { text: t.title }), el('small', { class: 'muted', text: (MP.STATUS[t.status] || '') + (t.project_id && MP.project(t.project_id) ? ' · ' + MP.project(t.project_id).name : '') })));
      })));
      if (!list.children.length) list.append(el('p', { class: 'hint', text: 'چیزی پیدا نشد.' }));
    }
    q.oninput = draw; draw();
    MP.dialog.open('کارت تسک یا پروژه', el('div', { class: 'form' }, el('p', { class: 'hint', text: 'کارت در گفت‌وگو می‌ماند و وضعیتش همیشه به‌روز است. در متن پیام هم می‌توانید # بزنید و تسک را انتخاب کنید.' }), q, list));
  }

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
    var grid = function (ic, color, title, fn) { return el('button', { type: 'button', class: 'as-g', onclick: fn }, el('span', { class: 'as-ico ' + color, html: icon(ic) }), el('small', { text: title })); };
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
          el('div', { class: 'as-grid' },
            grid('list', 'violet', 'نظرسنجی', function () { closeAttach(); MP.chatKit.pollForm().then(function (p) { if (p) sendNow({ body: '', x: { poll: p } }); }); }),
            grid('pin', 'green', 'موقعیت', function () { closeAttach(); MP.chatKit.pickPlace().then(function (l) { if (l) sendNow({ body: '', x: { loc: l } }); }); }),
            grid('user', 'blue', 'مخاطب', function () { closeAttach(); MP.chatKit.pickContact().then(function (c2) { if (c2) sendNow({ body: '', x: { contact: c2 } }); }); }),
            grid('video', 'red', 'پیام ویدیویی', function () { closeAttach(); recordRound(); }),
            grid('smile', 'orange', 'استیکر و GIF', function () { closeAttach(); openStickers(); }),
            grid('tasks', 'teal', 'تسک یا پروژه', function () { closeAttach(); pickCard(); })),
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
  function isVid(f) { return /^video\/(mp4|webm|quicktime|3gpp|x-m4v)$/i.test(f.type) || /\.(mp4|mov|webm|m4v|3gp)$/i.test(f.name); }
  function isMedia(f) { return isPic(f) || isVid(f); }
  /**
   * Before sending: thumbnails (each photo can be edited and get its own caption), «عکس» (compressed, grouped
   * in an album; videos play in the chat) or «فایل» (original), and a caption.
   */
  function sendSheet(files, want) {
    if (!current || !files.length) return;
    var list = files.slice(), pics = list.filter(isMedia).length, mode = pics && want !== 'file' ? 'photo' : 'file', group = true;
    var grid = el('div', { class: 'ss-grid' }), cap = el('textarea', { class: 'ss-cap', rows: 1, placeholder: 'توضیح (اختیاری)…', maxlength: 4000, dir: 'auto' });
    if (text.value.trim() && !editing) { cap.value = text.value.trim(); }
    var seg = el('div', { class: 'seg ss-seg', role: 'tablist' });
    var groupBox = el('label', { class: 'check ss-group' }, el('input', { type: 'checkbox', checked: true, onchange: function (e) { group = e.target.checked; } }), el('span', { text: 'گروه‌بندی در یک آلبوم' }));
    var title = el('span');
    function draw() {
      grid.replaceChildren.apply(grid, list.map(function (f, i) {
        var media = isMedia(f) && mode === 'photo', vid = isVid(f);
        var preview = !media ? el('span', { class: 'ss-doc' }, el('b', { text: (f.name.split('.').pop() || '').slice(0, 4).toUpperCase() }), el('small', { text: f.name, dir: 'auto' }), el('small', { text: MP.fileSize(f.size) }))
          : vid ? el('video', { src: f._url || (f._url = URL.createObjectURL(f)), muted: true, playsinline: true, preload: 'metadata' }) : el('img', { src: f._url || (f._url = URL.createObjectURL(f)), alt: '' });
        var cell = el('div', { class: 'ss-item' + (media ? ' pic' : ' doc') }, preview,
          vid && media ? el('span', { class: 'bv-play', html: icon('play') }) : null,
          el('button', { type: 'button', class: 'ss-x', 'aria-label': 'حذف', text: '×', onclick: function () { list.splice(i, 1); if (!list.length) MP.dialog.close(); else { pics = list.filter(isMedia).length; if (!pics) mode = 'file'; draw(); } } }),
          media && !vid && !/gif/i.test(f.type) ? el('button', { type: 'button', class: 'ss-edit', 'aria-label': 'ویرایش عکس', title: 'برش، چرخش، کشیدن و نوشتن', html: icon('edit'), onclick: function () {
            MP.chatKit.editPhoto(f).then(function (nf) { if (!nf) return; if (f._url) URL.revokeObjectURL(f._url); nf._cap = f._cap; list[i] = nf; draw(); });
          } }) : null);
        // A caption for each photo of an album (shown under the album and with that photo in the viewer).
        if (media && list.filter(isMedia).length > 1) cell.append(el('input', { class: 'ss-pcap', placeholder: 'توضیح این مورد', maxlength: 1000, dir: 'auto', value: f._cap || '', oninput: function (e) { f._cap = e.target.value; } }));
        return cell;
      }));
      seg.hidden = !pics;
      seg.replaceChildren(
        el('button', { type: 'button', 'aria-selected': String(mode === 'photo'), text: 'ارسال به‌صورت عکس و ویدیو', onclick: function () { mode = 'photo'; draw(); } }),
        el('button', { type: 'button', 'aria-selected': String(mode === 'file'), text: 'ارسال به‌صورت فایل', onclick: function () { mode = 'file'; draw(); } }));
      groupBox.hidden = !(mode === 'photo' && pics > 1);
      var nv = list.filter(isVid).length;
      title.textContent = mode === 'photo' && pics === list.length ? (nv === list.length ? (nv > 1 ? fa(nv) + ' ویدیو' : 'یک ویدیو') : list.length > 1 ? fa(list.length) + ' عکس و ویدیو' : 'یک عکس') : (list.length > 1 ? fa(list.length) + ' فایل' : 'یک فایل');
    }
    draw();
    var hint = el('p', { class: 'ss-hint' });
    var go = el('button', { type: 'submit', class: 'btn btn-primary', html: icon('send') + 'ارسال' });
    var later = el('button', { type: 'button', class: 'icon-btn', title: 'ارسال در زمان مشخص', 'aria-label': 'ارسال در زمان مشخص', html: icon('clock') });
    var f = el('form', { class: 'ss' }, el('div', { class: 'ss-top' }, title, seg), grid, groupBox, hint, el('div', { class: 'ss-foot' }, cap, later, go));
    hint.textContent = 'عکس: کم‌حجم و زود می‌رسد، داخل گفت‌وگو نمایش داده می‌شود (روی مداد بزنید تا برش بزنید، بچرخانید یا رویش بنویسید). فایل: همان فایل اصلی با کیفیت کامل.';
    // «Send later» for the whole set: the time is picked, then everything goes into the queue.
    later.onclick = function () { MP.chatKit.pickTime('ارسال در زمان مشخص').then(function (at) { if (at) doSend(at); }); };
    f.onsubmit = function (e) { e.preventDefault(); doSend(''); };
    function doSend(at) {
      var channel = current, caption = cap.value.trim(), r = replyTo;
      if (caption && caption === text.value.trim()) { text.value = ''; autoGrow(); saveDraft(channel, ''); composerState(); }
      clearCtx(false);
      MP.dialog.close();
      var media = mode === 'photo' ? list.filter(isMedia) : [], others = list.filter(function (x) { return media.indexOf(x) < 0; });
      // Albums hold up to ten items, as in Telegram; more make more albums.
      var albums = [], stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      media.forEach(function (x, i) { albums.push(media.length > 1 && group ? 'a' + stamp + Math.floor(i / 10) : ''); });
      // Caption: under the (first) album or on the last file, as in Telegram.
      var capOnPhotos = media.length && (group || media.length === 1) && !others.length;
      // Photos are shrunk one by one (dozens of big photos at once would run a phone out of memory), each sent as soon as it is ready.
      var chain = Promise.resolve();
      media.forEach(function (x, i) {
        var own = (x._cap || '').trim(), body = own || (capOnPhotos && i === 0 ? caption : '');
        chain = chain.then(function () {
          if (isVid(x)) return MP.chatKit.videoPoster(x).then(function (pv) {
            sendNow({ file: x, album: albums[i], body: body, reply: i === 0 ? r : null, channel: channel, thumb: pv && pv.thumb, x: pv ? { dur: Math.round(pv.dur * 10) / 10, w: pv.w, h: pv.h } : null, sendAt: at });
          });
          return shrink(x).then(function (small) {
            sendNow({ file: small, album: albums[i], body: body, reply: i === 0 ? r : null, channel: channel, x: /gif/i.test(x.type) && media.length === 1 ? { gif: 1 } : null, sendAt: at });
          });
        });
      });
      chain.then(function () {
        others.forEach(function (x, i) { sendNow({ file: x, asFile: true, body: !capOnPhotos && i === others.length - 1 ? caption : '', reply: !media.length && i === 0 ? r : null, channel: channel, sendAt: at }); });
      });
    }
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
      var jb = e.target.closest('.b-jumbo');
      if (jb) { jb.classList.remove('wiggle'); void jb.offsetWidth; jb.classList.add('wiggle'); }
      if (e.target.closest('a, button, video, audio, .v-msg')) return;
      var now = Date.now();
      if (now - lastTap < 320) { lastTap = 0; if (FINE && e.pointerType !== 'touch') { var sel = window.getSelection(); if (sel) sel.removeAllRanges(); startReply(first); } else { react(m, '❤️'); heartPop(b); } } else lastTap = now;
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
    // Mouse and trackpad (desktop, like Telegram Desktop): a small toolbar beside the bubble on hover.
    if (FINE) {
      var c = chan(), tb = el('div', { class: 'msg-hover', role: 'toolbar', 'aria-label': 'کارهای پیام' },
        el('button', { type: 'button', class: 'mh-react', title: 'واکنش', 'aria-label': 'واکنش', onclick: function (e) { e.stopPropagation(); reactStrip(m, tb); } }, MP.emojiImg('❤️')),
        c && c.can_post !== false ? el('button', { type: 'button', title: 'پاسخ (دوبار کلیک)', 'aria-label': 'پاسخ', html: icon('reply'), onclick: function (e) { e.stopPropagation(); startReply(first); } }) : null,
        el('button', { type: 'button', title: 'گزینه‌ها', 'aria-label': 'گزینه‌ها', html: icon('more'), onclick: function (e) { e.stopPropagation(); msgMenu(first, list, r); } }));
      r.append(tb);
    }
  }
  var FINE = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  /** The hover toolbar's ❤️: the reaction strip right there (a click on one reacts and closes it). */
  function reactStrip(m, anchor) {
    var old = $('.mh-strip'); if (old) { old.remove(); if (old._for === m.id) return; }
    var strip = el('div', { class: 'ctx-reacts mh-strip' }, REACTIONS.map(function (e) {
      var on = (m.reactions || []).some(function (x) { return x.mine && x.emoji === e; });
      return el('button', { type: 'button', class: on ? 'on' : '', 'aria-label': e, onclick: function (ev) { ev.stopPropagation(); strip.remove(); react(m, e); } }, MP.emojiImg(e));
    }));
    strip._for = m.id;
    document.body.append(strip);
    var rc = anchor.getBoundingClientRect(), w = strip.offsetWidth;
    strip.style.top = Math.max(8, rc.top - strip.offsetHeight - 6) + 'px';
    strip.style.left = Math.max(8, Math.min(innerWidth - w - 8, rc.left + rc.width / 2 - w / 2)) + 'px';
    setTimeout(function () {
      function out(e) { if (!strip.contains(e.target)) { strip.remove(); document.removeEventListener('pointerdown', out, true); } }
      document.addEventListener('pointerdown', out, true);
      box.addEventListener('scroll', function () { strip.remove(); }, { once: true });
    }, 0);
  }
  /** A small burst of the emoji around the reaction (Telegram's reaction effect). */
  function burst(id, emoji) {
    if (document.documentElement.classList.contains('reduced-motion')) return;
    var r = rowsById[id]; if (!r) return;
    var btn = $$('.b-react', r).filter(function (b) { return b.dataset.e === emoji; })[0]; if (!btn) return;
    btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
    var rect = btn.getBoundingClientRect(), cx = rect.left + 14, cy = rect.top + rect.height / 2;
    for (var i = 0; i < 9; i++) {
      var a = Math.PI * 2 * i / 9 + Math.random() * .5, d = 34 + Math.random() * 30;
      var p = el('span', { class: 'rx-p', style: { left: cx + 'px', top: cy + 'px' } }, MP.emojiImg(emoji));
      document.body.append(p);
      p.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 }, { transform: 'translate(calc(-50% + ' + Math.cos(a) * d + 'px), calc(-50% + ' + Math.sin(a) * d + 'px)) scale(1)', opacity: 0 }], { duration: 650 + Math.random() * 250, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = (function (n) { return function () { n.remove(); }; })(p);
    }
  }
  function heartPop(b) { var h = el('span', { class: 'heart-pop', text: '❤️' }); b.append(h); setTimeout(function () { h.remove(); }, 800); }

  function react(m, emoji) {
    if (typeof m.id !== 'number') return;
    // Shown at once; the answer brings the real counts.
    var rs = (m.reactions || []).map(function (x) { return Object.assign({}, x); }), had = rs.filter(function (x) { return x.mine; })[0];
    rs.forEach(function (x) { if (x.mine) { x.mine = false; x.count--; } });
    if (!had || had.emoji !== emoji) { var t = rs.filter(function (x) { return x.emoji === emoji; })[0]; if (t) { t.count++; t.mine = true; } else rs.push({ emoji: emoji, count: 1, mine: true, names: [S.me.name] }); }
    update(Object.assign({}, m, { reactions: rs.filter(function (x) { return x.count > 0; }) }));
    if (!had || had.emoji !== emoji) burst(m.id, emoji);
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
    // Text selected inside this message: «reply» quotes only that part (Telegram's quote).
    var sel = window.getSelection ? String(window.getSelection()) : '', part = '';
    if (sel.trim() && window.getSelection().anchorNode && r.contains(window.getSelection().anchorNode)) part = sel.trim().slice(0, 600);
    var items = [];
    if (c && c.can_post !== false) items.push(['reply', part ? 'پاسخ به بخش انتخاب‌شده' : 'پاسخ', function () { startReply(m, part); }]);
    if (body) items.push(['copy', part ? 'کپی بخش انتخاب‌شده' : 'کپی متن', function () { copyText(part || plainText(body)); }]);
    if (m.mine && !m.kind && k !== 'voice' && k !== 'poll' && k !== 'sticker' && k !== 'round') items.push(['edit', 'ویرایش', function () { startEdit(list.filter(function (x) { return x.body; })[0] || m); }]);
    items.push(pinned && pinned.id === m.id ? ['pin', 'برداشتن سنجاق', function () { pin(m, false); }] : ['pin', 'سنجاق کردن', function () { pin(m, true); }]);
    items.push(['forward', 'فوروارد', function () { forwardPick(list); }]);
    items.push(['clip', 'کپی لینک پیام', function () { copyText(location.href.split('#')[0] + '#msg-' + m.id); }]);
    if (c && c.type !== 'saved') items.push(['bookmark', 'ذخیره در پیام‌های ذخیره‌شده', function () { forwardTo(list, null); }]);
    items.push(['alarm', 'یادآوری این پیام…', function () { remindMsg(m); }]);
    if (body || m.file) items.push(['tasks', 'تبدیل به تسک', function () { toTask(m, body); }]);
    if ((k === 'photo' || k === 'file' && m.file && m.file.image) && !m.deleted) items.push(['eye', 'نظر روی طرح و تأیید', function () { gallery(m.id, null, true); }]);
    if (body && !/^[\s\p{Emoji}]*$/u.test(body)) items.push(['repeat', 'ترجمه', function () { translateMsg(m, r); }]);
    if (k === 'gif' || m.file && /gif$/i.test(m.file.mime || '') && k !== 'sticker') items.push(['image', 'ذخیره در GIFها', function () { MP.api('stickers', { method: 'POST', body: { kind: 'gif', file_id: m.file.id, message_id: m.id } }).then(function (d) { stickerData = d; MP.toast('در GIFها ذخیره شد'); }).catch(MP.soft); }]);
    if (m.file && k !== 'voice' && k !== 'sticker') items.push(['download', 'دانلود', function () { list.forEach(function (x) { if (x.file) window.open(x.file.url + (x.file.url.indexOf('?') >= 0 ? '&' : '?') + 'download=1', '_blank'); }); }]);
    if (body) items.push(['speaker', 'خواندن با صدا', function () { speak(m, el('span')); }]);
    if (m.mine && isGroup(c)) items.push(['checks', 'دیده‌شده توسط…', function () { seenList(m); }]);
    if (m.edited) items.push(['edit', 'تاریخچه ویرایش', function () { editHistory(m); }]);
    items.push(['checks', 'انتخاب', function () { startSelect(r, list); }]);
    items.push(['trash', 'حذف', function () { askDelete2(list); }, true]);
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
  /** Delete: for everyone (my messages; a supervisor: anyone's), only for me, or (supervisor) erase for good. */
  function askDelete2(list) {
    list = list.filter(function (x) { return typeof x.id === 'number'; });
    if (!list.length) return;
    var mineAll = list.every(function (x) { return x.mine && !x.archived; }), n = list.length;
    var what = n > 1 ? fa(n) + ' پیام' : 'این پیام';
    var f = el('div', { class: 'form del-opts' },
      el('p', { class: 'hint', text: list[0].body ? '«' + plainText(list[0].body).slice(0, 90) + '»' : what }),
      mineAll || S.manager ? el('button', { type: 'button', class: 'btn btn-secondary', html: icon('trash') + 'حذف برای همه', onclick: function () { MP.dialog.close(); list.forEach(function (x, i) { archiveMsg(x, i > 0); }); endSelect(); } }) : null,
      el('button', { type: 'button', class: 'btn btn-secondary', html: icon('eye') + 'حذف فقط برای من', onclick: function () { MP.dialog.close(); list.forEach(hideMsg); endSelect(); MP.toast(n > 1 ? 'پیام‌ها برای شما حذف شد' : 'پیام برای شما حذف شد'); } }),
      S.manager && n === 1 ? el('button', { type: 'button', class: 'btn btn-danger', html: icon('trash') + 'پاک کردن برای همیشه (ناظر)', onclick: function () { MP.dialog.close(); eraseMsg(list[0]); } }) : null,
      el('small', { class: 'hint', text: '«برای همه»: از گفت‌وگوی همه برداشته می‌شود و فقط ناظر آن را در آرشیو می‌بیند. «فقط برای من»: دیگران همچنان آن را می‌بینند.' }));
    MP.dialog.open('حذف ' + what, f);
  }
  function hideMsg(m) { MP.api('messages/' + m.id + '/hide', { method: 'POST' }).then(function () { removeRow(m.id); MP.loadChannels(); }).catch(MP.soft); }
  function editHistory(m) {
    var body = MP.dialog.open('تاریخچه ویرایش', MP.skeleton(2));
    MP.api('messages/' + m.id + '/edits').then(function (l) {
      body.replaceChildren(el('div', { class: 'ed-list' }, l.map(function (e) {
        var p = el('p', { class: 'b-text', dir: 'auto' }); MP.chatKit.format(e.body, p);
        return el('article', { class: 'ed-item' + (e.now ? ' now' : '') }, el('small', { text: (e.now ? 'نسخه فعلی · ' : '') + J.format(e.at.slice(0, 10), false) + ' ' + MP.timeFa(e.at.slice(11, 16)) }), MP.emojify(p));
      })));
    }).catch(MP.soft);
  }
  /** Translation through the panel's AI service when it is set up; otherwise Google Translate. */
  function translateMsg(m, r) {
    var src = plainText(m.body || m.transcript || ''), latin = (src.match(/[a-z]/gi) || []).length > (src.match(/[\u0600-\u06ff]/g) || []).length;
    var to = latin ? 'fa' : 'en';
    if (!S.boot.channels.ai) { window.open('https://translate.google.com/?sl=auto&tl=' + to + '&text=' + encodeURIComponent(src), '_blank', 'noopener'); return; }
    var b = $('.bubble', r), box2 = el('div', { class: 'b-tr' }, el('small', { text: 'در حال ترجمه…' }));
    var old = $('.b-tr', b); if (old) old.remove();
    var meta = $('.b-meta', b); b.insertBefore(box2, meta && meta.parentNode === b ? meta : null);
    MP.api('messages/' + m.id + '/translate', { method: 'POST', body: { to: to } }).then(function (d) {
      box2.replaceChildren(el('small', { class: 'b-tr-h' }, MP.iconEl('repeat'), to === 'fa' ? 'ترجمه فارسی' : 'English', el('button', { type: 'button', class: 'b-tr-x', text: '×', onclick: function (e) { e.stopPropagation(); box2.remove(); } })), el('p', { dir: 'auto', text: d.text }));
      b.classList.remove('meta-in');
    }).catch(function (e) { box2.remove(); MP.soft(e); });
  }
  /** «Remind me about this message»: a reminder that opens the message itself. */
  function remindMsg(m) {
    MP.chatKit.pickTime('یادآوری این پیام').then(function (at) {
      if (!at) return;
      MP.api('messages/' + m.id + '/remind', { method: 'POST', body: { date: at.slice(0, 10), time: at.slice(11, 16) } }).then(function () {
        MP.toast('یادآوری ' + J.format(at.slice(0, 10), false) + ' ساعت ' + MP.timeFa(at.slice(11, 16)) + ' ثبت شد', { icon: 'alarm' });
        if (MP.loadReminders) MP.loadReminders();
      }).catch(MP.soft);
    });
  }
  function seenList(m) {
    var body = MP.dialog.open('دیده‌شده توسط', MP.skeleton(2));
    MP.api('messages/' + m.id + '/seen').then(function (l) {
      body.replaceChildren(l.length ? el('div', { class: 'menu' }, l.map(function (u) { return el('div', { class: 'seen-row' }, MP.avatar(u, 'sm'), el('span', { text: u.name })); })) : el('p', { class: 'muted', text: 'هنوز کسی ندیده است.' }));
    }).catch(MP.soft);
  }
  /** Message → task; the new task's live card is posted in the chat as a reply to the message. */
  function toTask(m, body) {
    var c = chan(), ch = current, t = plainText(body || (m.file ? m.file.name : '')).replace(/\s+/g, ' ').trim();
    MP.taskForm({ taskTitle: t.slice(0, 190), projectId: c && c.project_id ? c.project_id : 0, onSaved: function (saved, b) {
      if (saved && saved.id && (!c || c.can_post !== false)) sendNow({ body: '', reply: m, channel: ch, x: { card: { t: 'task', id: saved.id, title: b.title } } });
    } });
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
    $('#sel-delete').hidden = false;
  }
  function endSelect() {
    selecting = false; selected = {}; layout.classList.remove('selecting'); $('#chat-select').hidden = true;
    $$('.msg-row.sel', box).forEach(function (r) { r.classList.remove('sel'); });
  }
  function selList() { return Object.keys(selected).map(function (k) { return selected[k]; }).sort(function (a, b) { return a.id - b.id; }); }
  $('#sel-close').onclick = endSelect;
  $('#sel-copy').onclick = function () { var l = selList(); copyText(l.map(function (m) { return (isGroup(chan()) ? m.author + ': ' : '') + (m.body || snippet(m)); }).join('\n')); endSelect(); };
  $('#sel-forward').onclick = function () { forwardPick(selList()); };
  $('#sel-delete').onclick = function () { askDelete2(selList()); };

  /* ------------------------------------------------------------ Find in this chat */

  var hits = [], hitAt = 0, findTimer2 = 0, ff = { from: 0, kind: '', d1: '', d2: '' };
  /** Filters under the search box: sender, kind (photo, video, file, link, voice), dates, and «go to a date». */
  var ffBar = el('div', { class: 'find-filters', hidden: true });
  $('#chat-find-list').before(ffBar);
  function drawFilters() {
    var c = chan(), people = c ? (c.member_ids || []).map(MP.user) : [];
    var who = el('select', { class: 'ff-sel', 'aria-label': 'فرستنده', onchange: function () { ff.from = +this.value; runFind(); } }, el('option', { value: 0, text: 'همه افراد' }), people.map(function (u) { return el('option', { value: u.id, text: u.id === S.me.id ? 'خودم' : u.name, selected: ff.from === u.id }); }));
    var kinds = [['', 'همه'], ['photo', 'عکس'], ['video', 'ویدیو'], ['file', 'فایل'], ['link', 'لینک'], ['voice', 'ویس']];
    var dateLabel = ff.d1 ? (ff.d1 === ff.d2 ? J.format(ff.d1, false) : J.format(ff.d1, false) + ' تا ' + J.format(ff.d2, false)) : 'تاریخ';
    ffBar.replaceChildren(
      isGroup(c) ? who : null,
      el('div', { class: 'ff-kinds' }, kinds.map(function (k) { return el('button', { type: 'button', class: 'ff-k' + (ff.kind === k[0] ? ' on' : ''), text: k[1], onclick: function () { ff.kind = k[0]; drawFilters(); runFind(); } }); })),
      el('button', { type: 'button', class: 'ff-k' + (ff.d1 ? ' on' : ''), html: icon('calendar') + dateLabel, onclick: dateFilter }),
      el('button', { type: 'button', class: 'ff-k ff-jump', html: icon('calendar') + 'رفتن به تاریخ', onclick: jumpDate }));
  }
  function dateFilter() {
    var f = el('form', { class: 'form' }, el('div', { class: 'form-row' }, MP.dateField('d1', ff.d1 || S.today, 'از'), MP.dateField('d2', ff.d2 || S.today, 'تا')),
      el('div', { class: 'dialog-actions' }, el('button', { type: 'submit', class: 'btn btn-primary', text: 'اعمال' }), el('button', { type: 'button', class: 'btn btn-secondary', text: 'بدون تاریخ', onclick: function () { ff.d1 = ff.d2 = ''; MP.dialog.close(); drawFilters(); runFind(); } })));
    f.onsubmit = function (e) { e.preventDefault(); ff.d1 = f.elements.d1.value; ff.d2 = f.elements.d2.value || ff.d1; if (ff.d2 < ff.d1) { var t = ff.d1; ff.d1 = ff.d2; ff.d2 = t; } MP.dialog.close(); drawFilters(); runFind(); };
    MP.dialog.open('جستجو در بازه تاریخ', f);
  }
  /** Jump to a day (Jalali calendar): the first message of that day. */
  function jumpDate() {
    var id = current, f = el('form', { class: 'form' }, MP.dateField('d', S.today, 'روز'), MP.actions('برو'));
    f.onsubmit = function (e) {
      e.preventDefault();
      MP.api('channels/' + id + '/date', { query: { date: f.elements.d.value }, noCache: true }).then(function (d) {
        MP.dialog.close();
        if (!d.id) { MP.toast('پیامی در این گفت‌وگو نیست'); return; }
        if (rowsById[d.id]) jumpTo(d.id); else { var t = ++loopToken; fetchFirst(t, d.id).then(function () { var r = rowsById[d.id]; if (r) { r.scrollIntoView({ block: 'start' }); r.classList.add('flash'); } }); }
      }).catch(MP.soft);
    };
    MP.dialog.open('رفتن به تاریخ', f);
  }
  function openFind(preset) {
    $('#chat-find').hidden = false; layout.classList.add('finding'); ffBar.hidden = false;
    ff = { from: 0, kind: '', d1: '', d2: '' }; drawFilters();
    var q = $('#chat-find-q'); q.value = typeof preset === 'string' ? preset : ''; q.focus(); $('#chat-find-n').textContent = '';
    if (q.value) runFind();
  }
  function closeFind() { $('#chat-find').hidden = true; layout.classList.remove('finding'); $('#chat-find-list').hidden = true; ffBar.hidden = true; hits = []; }
  $('#chat-find-close').onclick = closeFind;
  function runFind() {
    clearTimeout(findTimer2);
    var q = $('#chat-find-q').value.trim(), list = $('#chat-find-list'), any = ff.from || ff.kind || ff.d1;
    if (q.length < 2 && !any) { hits = []; list.hidden = true; $('#chat-find-n').textContent = ''; return; }
    findTimer2 = setTimeout(function () {
      MP.api('channels/' + current + '/search', { query: { q: q.length >= 2 ? q : '', from: ff.from || '', kind: ff.kind, d1: ff.d1, d2: ff.d2 }, noCache: true }).then(function (l) {
        hits = l; hitAt = 0;
        $('#chat-find-n').textContent = l.length ? fa(1) + ' از ' + fa(l.length) : 'نتیجه‌ای نیست';
        list.replaceChildren.apply(list, l.map(function (h, i) {
          return el('button', { type: 'button', onclick: function () { hitAt = i; showHit(); list.hidden = true; } }, el('b', { text: h.author }), el('span', { text: h.text, dir: 'auto' }), el('time', { text: listTime(h.created_at) }));
        }));
        list.hidden = !l.length;
      }).catch(function () {});
    }, 300);
  }
  $('#chat-find-q').oninput = runFind;
  $('#chat-find-q').onkeydown = function (e) { if (e.key === 'Enter' && hits.length) { e.preventDefault(); $('#chat-find-list').hidden = true; showHit(); hitAt = (hitAt + 1) % hits.length; } if (e.key === 'Escape') closeFind(); };
  function showHit() { if (!hits.length) return; $('#chat-find-n').textContent = fa(hitAt + 1) + ' از ' + fa(hits.length); jumpTo(hits[hitAt].id); }
  $('#chat-find-up').onclick = function () { if (!hits.length) return; hitAt = (hitAt + 1) % hits.length; $('#chat-find-list').hidden = true; showHit(); };
  $('#chat-find-down').onclick = function () { if (!hits.length) return; hitAt = (hitAt - 1 + hits.length) % hits.length; $('#chat-find-list').hidden = true; showHit(); };

  /* ------------------------------------------------------------ Gallery (all photos of the chat, swipe between them) */

  /**
   * The viewer: photos and videos of the chat. On a design (photo) it also takes notes on a point of the image
   * (each note is a reply that remembers the point) and «تأیید» / «نیاز به اصلاح».
   */
  function gallery(startId, fromEl, review, focusPt) {
    var photos = Object.keys(msgs).map(function (k) { return msgs[k]; }).filter(function (m) { return ((kindOf(m) === 'photo' || kindOf(m) === 'video') || m.id === startId && m.file && m.file.image) && !m.deleted && m.file; }).sort(function (a, b) { return (typeof a.id === 'number' ? a.id : 1e15) - (typeof b.id === 'number' ? b.id : 1e15); });
    var i = Math.max(0, photos.map(function (m) { return m.id; }).indexOf(startId));
    if (!photos.length) return;
    var img = el('img', { alt: '' }), cap = el('div', { class: 'gv-cap' }), count = el('span', { class: 'gv-n' }), vid = null;
    var dl = el('a', { class: 'icon-btn gv-btn', 'aria-label': 'دانلود', html: icon('download'), target: '_blank', rel: 'noopener' });
    var v = el('div', { class: 'gv', role: 'dialog', 'aria-label': 'عکس‌ها' },
      el('div', { class: 'gv-top' }, el('button', { type: 'button', class: 'icon-btn gv-btn', 'aria-label': 'بستن', html: icon('close'), onclick: close }), count, el('span', { class: 'gv-sp' }),
        el('button', { type: 'button', class: 'gv-tool gv-note', html: icon('pin') + '<span>نظر روی طرح</span>', onclick: function () { noteMode = !noteMode; v.classList.toggle('noting', noteMode); if (noteMode) MP.toast('روی نقطه‌ای از طرح بزنید تا نظرتان را بنویسید'); } }),
        el('button', { type: 'button', class: 'gv-tool gv-ok', html: icon('check') + '<span>تأیید</span>', onclick: function () { reviewIt('ok'); } }),
        el('button', { type: 'button', class: 'gv-tool gv-fix', html: icon('edit') + '<span>نیاز به اصلاح</span>', onclick: function () { reviewIt('fix'); } }),
        el('button', { type: 'button', class: 'icon-btn gv-btn', 'aria-label': 'رفتن به پیام', html: icon('chat'), onclick: function () { var id = photos[i].id; close(); jumpTo(id); } }), dl),
      el('button', { type: 'button', class: 'gv-nav gv-next', 'aria-label': 'بعدی', html: icon('left'), onclick: function () { go(1); } }),
      el('button', { type: 'button', class: 'gv-nav gv-prev', 'aria-label': 'قبلی', html: icon('right'), onclick: function () { go(-1); } }),
      el('div', { class: 'gv-stage' }, img, el('div', { class: 'gv-pins' })), cap);
    // The chat's other photos as thumbnails underneath: scroll sideways, tap one to bring it up.
    var strip = window.MPViewer ? MPViewer.strip(photos.map(function (m) { var vd = kindOf(m) === 'video'; return { url: m.file.url, thumb: vd ? (m.x && m.x.thumb_url) : (m.file.thumb || m.file.mid || m.file.url), video: vd }; }), function (k) { i = k; show(); }) : null;
    if (strip && photos.length > 1) v.append(strip.el);
    $('.gv-top', v).insertBefore(el('button', { type: 'button', class: 'icon-btn gv-btn', 'aria-label': 'اشتراک‌گذاری', html: icon('share'), onclick: function () { var m = photos[i]; MPViewer.share({ url: m.file.url, name: m.file.name }); } }), count);
    if (!window.MPViewer) $('.gv-top [aria-label="اشتراک‌گذاری"]', v).remove();
    var z = MP.zoomable(img, $('.gv-stage', v)), noteMode = !!review && !focusPt, pinsBox = $('.gv-pins', v), raf = 0;
    if (noteMode) v.classList.add('noting');
    /** Notes on the photo on screen: replies to it that carry a point. */
    function notes(m) {
      return Object.keys(msgs).map(function (k) { return msgs[k]; }).filter(function (x) { return x.reply && x.reply.id === m.id && x.x && x.x.pt && !x.deleted; }).sort(function (a, b) { return (typeof a.id === 'number' ? a.id : 1e15) - (typeof b.id === 'number' ? b.id : 1e15); });
    }
    function drawPins() {
      var m = photos[i];
      pinsBox.replaceChildren();
      if (!m || kindOf(m) === 'video') return;
      notes(m).forEach(function (x, n) {
        var pin = el('button', { type: 'button', class: 'gv-pin' + (focusPt && Math.abs(focusPt.x - x.x.pt.x) < 1e-3 && Math.abs(focusPt.y - x.x.pt.y) < 1e-3 ? ' focus' : ''), dataset: { x: x.x.pt.x, y: x.x.pt.y }, text: fa(n + 1),
          onclick: function (e) { e.stopPropagation(); $$('.gv-pin', pinsBox).forEach(function (p2) { p2.classList.remove('focus'); }); pin.classList.add('focus'); } },
          el('span', { class: 'gv-pin-tip' }, el('b', { text: x.mine ? 'شما' : x.author }), el('span', { text: plainText(x.body), dir: 'auto' })));
        pinsBox.append(pin);
      });
      placePins();
    }
    function placePins() {
      var r = img.getBoundingClientRect(), sr = $('.gv-stage', v).getBoundingClientRect();
      $$('.gv-pin', pinsBox).forEach(function (p2) { p2.style.left = (r.left - sr.left + +p2.dataset.x * r.width) + 'px'; p2.style.top = (r.top - sr.top + +p2.dataset.y * r.height) + 'px'; });
    }
    (function loop() { if (!v.isConnected && raf) return; placePins(); raf = requestAnimationFrame(loop); })();
    img.addEventListener('click', function (e) {
      if (!noteMode || z.zoomed() && z.touched && z.touched()) return;
      var m = photos[i]; if (typeof m.id !== 'number') return;
      var c = chan(); if (c && c.can_post === false) { MP.toast(c.post_why); return; }
      var r = img.getBoundingClientRect(), pt = { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
      var old = $('.gv-note-form', v); if (old) old.remove();
      var inp = el('input', { class: 'input', maxlength: 1000, placeholder: 'نظر شما درباره این نقطه…', dir: 'auto' });
      var f = el('form', { class: 'gv-note-form', style: { left: Math.min(innerWidth - 290, Math.max(10, e.clientX - 140)) + 'px', top: Math.min(innerHeight - 70, e.clientY + 14) + 'px' } }, inp, el('button', { type: 'submit', class: 'btn btn-primary btn-sm', html: icon('send') }));
      f.onsubmit = function (ev) {
        ev.preventDefault(); var t = inp.value.trim(); if (!t) return;
        f.remove();
        sendNow({ body: t, reply: m, x: { pt: pt } });
        setTimeout(drawPins, 50);
      };
      v.append(f); inp.focus();
    });
    function reviewIt(state) {
      var m = photos[i]; if (typeof m.id !== 'number') return;
      var cur = m.x && m.x.review && m.x.review.state;
      MP.api('messages/' + m.id + '/review', { method: 'POST', body: { state: cur === state ? '' : state } }).then(function (n) {
        update(n); photos[i] = msgs[n.id] || n; show(); pull();
        MP.toast(cur === state ? 'برداشته شد' : state === 'ok' ? 'طرح تأیید شد' : 'برای اصلاح علامت خورد', { icon: state === 'ok' ? 'check' : 'edit' });
      }).catch(MP.soft);
    }
    function show() {
      var m = photos[i]; z.reset();
      if (vid) { vid.pause(); vid.remove(); vid = null; }
      if (kindOf(m) === 'video') {
        img.hidden = true;
        vid = el('video', { class: 'gv-video', src: m.file.url, controls: true, autoplay: true, playsinline: true, poster: m.x && m.x.thumb_url ? m.x.thumb_url : '' });
        $('.gv-stage', v).append(vid);
      } else {
        img.hidden = false;
        // The screen-sized copy is already cached: show it, then swap in the original.
        if (m.file.mid) { img.src = m.file.mid; var full = new Image(); full.onload = function () { if (photos[i] === m) img.src = m.file.url; }; full.src = m.file.url; } else img.src = m.file.url;
      }
      count.textContent = fa(i + 1) + ' از ' + fa(photos.length);
      var isPhoto = kindOf(m) !== 'video', rvs = m.x && m.x.review ? m.x.review.state : '';
      $$('.gv-tool', v).forEach(function (b2) { b2.hidden = !isPhoto || typeof m.id !== 'number'; });
      $('.gv-ok', v).classList.toggle('on', rvs === 'ok'); $('.gv-fix', v).classList.toggle('on', rvs === 'fix');
      drawPins();
      cap.replaceChildren(el('b', { text: m.mine ? 'شما' : m.author }), el('small', { text: MP.relTime(m.created_at) }));
      if (m.body) cap.append(el('p', { text: m.body, dir: 'auto' }));
      dl.href = m.file.url + (m.file.url.indexOf('?') >= 0 ? '&' : '?') + 'download=1';
      $('.gv-prev', v).hidden = i === 0; $('.gv-next', v).hidden = i === photos.length - 1;
      if (strip) strip.set(i);
    }
    function go(d) { var n = i + d; if (n < 0 || n >= photos.length) return; i = n; show(); }
    function key(e) { if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') go(1); else if (e.key === 'ArrowRight') go(-1); }
    var sx = null;
    // Swipe for the next photo / down to close — only when not zoomed (zoomed, a drag moves the photo).
    v.addEventListener('pointerdown', function (e) { sx = z.zoomed() || e.target.closest('button, a') ? null : { x: e.clientX, y: e.clientY }; });
    v.addEventListener('pointerup', function (e) { if (!sx) return; var dx = e.clientX - sx.x, dy = e.clientY - sx.y; sx = null; if (z.touched()) return; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1); else if (dy > 120) close(); });
    var layer = MP.pushLayer(function () { layer = null; close(); });
    function close() { cancelAnimationFrame(raf); raf = 1; if (vid) vid.pause(); document.removeEventListener('keydown', key); v.classList.add('out'); setTimeout(function () { v.remove(); }, 160); if (layer) { var l = layer; layer = null; MP.popLayer(l); } }
    document.addEventListener('keydown', key);
    document.body.append(v); show();
    // Opens from the photo's own place (Telegram's zoom-in).
    if (fromEl && fromEl.getBoundingClientRect && v.animate && !document.documentElement.classList.contains('reduced-motion')) {
      var r = fromEl.getBoundingClientRect(), sx = r.width / innerWidth, sy = r.height / innerHeight;
      img.animate([{ transform: 'translate(' + (r.left + r.width / 2 - innerWidth / 2) + 'px,' + (r.top + r.height / 2 - innerHeight / 2) + 'px) scale(' + Math.max(sx, sy) + ')', opacity: .6 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }

  /* ------------------------------------------------------------ Chat info: members, media, files, links, voice */

  function chatInfo(c, side) {
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
    var st = c.settings || {};
    if (st.desc) head.append(el('p', { class: 'ci-desc', text: st.desc, dir: 'auto' }));
    var admin = null;
    if (isGroup(c)) {
      admin = el('div', { class: 'ci-admin' },
        st.mode === 'channel' ? el('span', { class: 'chip', html: icon('speaker') + ' کانال اطلاع‌رسانی' }) : null,
        st.slow ? el('span', { class: 'chip', html: icon('clock') + ' حالت آهسته: ' + slowLabel(st.slow) }) : null,
        st.topics ? el('button', { type: 'button', class: 'chip', html: icon('list') + ' تاپیک‌ها', onclick: function () { MP.dialog.close(); select(c.id, 0, { topics: true }); } }) : null,
        c.role === 'admin' ? el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('settings') + 'مدیریت گروه', onclick: function () { groupAdmin(c); } }) : el('span', { class: 'chip', text: c.role === 'readonly' ? 'نقش شما: فقط‌خواندنی' : 'نقش شما: عضو' }));
    }
    var info = el('div', { class: 'ci-info' }, head, admin, acts, members, seg, pane);
    if (side) {
      side.replaceChildren(el('div', { class: 'cs-top' }, el('strong', { text: 'اطلاعات گفت‌وگو' }),
        el('button', { type: 'button', class: 'icon-btn sm', title: 'بستن ستون', 'aria-label': 'بستن ستون اطلاعات', html: icon('close'), onclick: toggleSide })), info);
    } else MP.dialog.open('اطلاعات گفت‌وگو', info, { wide: true, focus: false });
    load();
  }

  /**
   * The info column like Telegram Desktop's «Group Info»: who/what, notifications switch, counts of photos, videos,
   * files, links and voice messages (each opens its list in the column), the members with search, and actions.
   */
  var MEDIA_ROWS = [['photos', 'image', 'عکس', 'عکس‌ها'], ['videos', 'video', 'ویدیو', 'ویدیوها'], ['files', 'file', 'فایل', 'فایل‌ها'], ['links', 'link', 'لینک', 'لینک‌های فرستاده‌شده'], ['voice', 'mic', 'پیام صوتی', 'پیام‌های صوتی']];
  function sideInfo(c, side) {
    var kind = c.type === 'direct' ? 'اطلاعات کاربر' : c.type === 'saved' ? 'پیام‌های ذخیره‌شده' : (c.settings || {}).mode === 'channel' ? 'اطلاعات کانال' : 'اطلاعات گروه';
    function top(title, back) {
      return el('div', { class: 'cs-top' },
        back ? el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'بازگشت', html: icon('right'), onclick: back }) : null,
        el('strong', { text: title }),
        el('button', { type: 'button', class: 'icon-btn sm', title: 'بستن ستون', 'aria-label': 'بستن ستون اطلاعات', html: icon('close'), onclick: toggleSide }));
    }
    function row(ico, main, sub, opts) {
      opts = opts || {};
      var r = el(opts.onclick ? 'button' : 'div', { type: opts.onclick ? 'button' : null, class: 'tg-row' + (opts.danger ? ' danger' : ''), onclick: opts.onclick || null },
        el('span', { class: 'tg-row-ico', html: icon(ico) }),
        el('span', { class: 'tg-row-copy' }, el('b', { text: main, dir: opts.dir || 'auto' }), sub ? el('small', { text: sub }) : null),
        opts.end || null);
      return r;
    }
    function sw(on, fn) {
      var cb = el('input', { type: 'checkbox', role: 'switch', checked: !!on, 'aria-label': 'اعلان‌ها' });
      cb.onchange = function () { fn(cb.checked); };
      return el('label', { class: 'switch tg-switch', onclick: function (e) { e.stopPropagation(); } }, cb, el('i'));
    }
    function home() {
      var st = c.settings || {}, sub, online = false;
      if (c.type === 'direct') { online = isOnline(c.other); sub = online ? 'آنلاین' : lastSeen(Math.max(seenOf(c.other), c.last_seen || 0)); }
      else sub = c.type === 'saved' ? 'فقط خودتان می‌بینید' : fa(c.members) + ((st.mode === 'channel') ? ' مشترک' : ' عضو');
      var hero = el('div', { class: 'tg-hero' }, channelIcon(c, 'xl'), el('div', null, el('h3', { text: c.title }), el('small', { class: online ? 'online' : '', text: sub })));
      var about = el('section', { class: 'tg-sec' });
      if (st.desc) about.append(row('help', st.desc, 'توضیحات'));
      if (c.type === 'direct') {
        var u = MP.user(c.other);
        if (u.title) about.append(row('user', u.title, 'سمت'));
        if (u.phone) about.append(row('send', MP.fa(u.phone), 'موبایل', { dir: 'ltr' }));
        about.append(row('user', 'نمایش پروفایل', '', { onclick: function () { MP.openProfile(c.other); } }));
      }
      if (c.client_name) about.append(row('user', c.client_name, 'مشتری'));
      if (c.project_id && MP.project(c.project_id)) about.append(row('folder', MP.project(c.project_id).title || MP.project(c.project_id).name, 'پروژه', { onclick: function () { MP.showView('projects'); } }));
      if (st.invite) about.append(row('link', st.invite.replace(/^https?:\/\//, ''), 'لینک دعوت · برای کپی کلیک کنید', { dir: 'ltr', onclick: function () { copyText(st.invite); } }));
      if (c.type !== 'saved') about.append(row(c.muted ? 'bell-off' : 'bell', 'اعلان‌ها', c.muted ? 'بی‌صدا' : 'روشن', { end: sw(!c.muted, function (on) { setMute(c, !on); }) }));
      var media = el('section', { class: 'tg-sec tg-media' }, el('div', { class: 'tg-row tg-sk' }, el('span', { class: 'sk sk-text', style: { width: '60%' } })));
      MP.api('channels/' + c.id + '/media-counts', { noCache: true }).then(function (n) {
        var rows = MEDIA_ROWS.filter(function (m) { return n[m[0]]; }).map(function (m) {
          return row(m[1], fa(n[m[0]]) + ' ' + m[2], '', { onclick: function () { list(m); } });
        });
        media.replaceChildren.apply(media, rows.length ? rows : [el('p', { class: 'tg-none', text: 'هنوز عکس، فایل یا لینکی فرستاده نشده' })]);
      }).catch(function () { media.remove(); });
      var members = null;
      if (isGroup(c) && c.member_ids && c.member_ids.length) {
        var q = el('input', { type: 'search', class: 'tg-msearch', placeholder: 'جستجوی اعضا', hidden: true, 'aria-label': 'جستجوی اعضا' });
        var people = el('div', { class: 'tg-people' });
        var drawPeople = function () {
          var v = MP.norm(q.value);
          people.replaceChildren.apply(people, c.member_ids.map(function (id) { return MP.user(id); }).filter(function (u) { return !v || MP.norm(u.name + ' ' + (u.title || '')).indexOf(v) >= 0; })
            .sort(function (a, b) { return (isOnline(b.id) ? 1 : 0) - (isOnline(a.id) ? 1 : 0); }).map(function (u) {
              var on = isOnline(u.id);
              return el('button', { type: 'button', class: 'tg-person', onclick: function () { if (u.id !== S.me.id) MP.startDirect(u.id); } }, MP.avatar(u, 'sm'),
                el('span', null, el('b', { text: u.name + (u.id === S.me.id ? ' (شما)' : '') }), el('small', { class: on ? 'online' : '', text: on ? 'آنلاین' : lastSeen(seenOf(u.id)) })));
            }));
        };
        q.oninput = drawPeople;
        members = el('section', { class: 'tg-sec' },
          el('div', { class: 'tg-memhead' }, el('span', { class: 'tg-row-ico', html: icon('users') }), el('b', { text: fa(c.members) + ' عضو' }),
            el('button', { type: 'button', class: 'icon-btn sm', title: 'جستجوی اعضا', 'aria-label': 'جستجوی اعضا', html: icon('search'), onclick: function () { q.hidden = !q.hidden; if (!q.hidden) q.focus(); else { q.value = ''; drawPeople(); } } }),
            S.manager && c.type === 'group' ? el('button', { type: 'button', class: 'icon-btn sm', title: 'افزودن عضو', 'aria-label': 'افزودن عضو', html: icon('plus'), onclick: function () { groupForm(c); } }) : null),
          q, people);
        drawPeople();
      }
      var acts = el('section', { class: 'tg-sec' },
        row('search', 'جستجو در گفت‌وگو', '', { onclick: function () { openFind(); } }),
        c.type !== 'saved' ? row('video', 'جلسه تصویری', '', { onclick: function () { startMeeting(c); } }) : null,
        FINE && !MP_CONFIG_POP() ? row('grid', 'باز کردن در پنجره جدا', '', { onclick: function () { popOut(c); } }) : null,
        row('image', 'ظاهر گفت‌وگو', 'پس‌زمینه، رنگ و اندازه متن', { onclick: function () { chatLook(c); } }),
        isGroup(c) && c.role === 'admin' ? row('settings', 'مدیریت گروه', 'توضیح، نقش‌ها، لینک دعوت، حالت آهسته', { onclick: function () { groupAdmin(c); } }) : null,
        isGroup(c) && st.topics ? row('list', 'تاپیک‌ها', '', { onclick: function () { select(c.id, 0, { topics: true }); } }) : null);
      side.replaceChildren(top(kind), el('div', { class: 'tg-scroll' }, hero, about.childNodes.length ? about : null, media, members, acts));
      MP.emojify(side);
    }
    function list(m) {
      var pane = el('div', { class: 'tg-scroll tg-list' }, MP.skeleton(2));
      side.replaceChildren(top(m[3], home), pane);
      var k = m[0] === 'photos' || m[0] === 'videos' ? 'media' : m[0];
      MP.api('channels/' + c.id + '/media', { query: { kind: k } }).then(function (l) {
        if (k === 'media') {
          l = l.filter(function (x) { return (m[0] === 'videos') === /^video\//.test(x.file.mime || ''); });
          pane.replaceChildren(el('div', { class: 'ci-grid tg-grid' }, l.map(function (x) {
            var v = /^video\//.test(x.file.mime || '');
            return el('button', { type: 'button', onclick: function () { if (!msgs[x.id]) jumpTo(x.id); else gallery(x.id); } },
              v ? (x.x && x.x.thumb_url ? el('img', { src: x.x.thumb_url, alt: '', loading: 'lazy' }) : el('video', { src: x.file.url + '#t=0.5', muted: true, preload: 'metadata' })) : el('img', { src: x.file.url, alt: '', loading: 'lazy' }),
              v ? el('span', { class: 'bv-play', html: icon('play') }) : null);
          })));
        } else if (k === 'links') {
          pane.replaceChildren.apply(pane, l.map(function (x) {
            return el('div', { class: 'tg-row' }, el('span', { class: 'tg-row-ico', html: icon('link') }), el('span', { class: 'tg-row-copy' }, el('a', { href: x.url, target: '_blank', rel: 'noopener', dir: 'ltr', text: x.url }), el('small', { text: x.author + ' · ' + listTime(x.created_at) })),
              el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'رفتن به پیام', html: icon('chat'), onclick: function () { jumpTo(x.id); } }));
          }));
        } else {
          pane.replaceChildren.apply(pane, l.map(function (x) {
            var f = x.file;
            return el('div', { class: 'tg-row' }, el('span', { class: 'tg-row-ico file', html: icon(k === 'voice' ? 'mic' : 'file') }),
              el('span', { class: 'tg-row-copy' }, el('a', { href: f.url + (f.url.indexOf('?') >= 0 ? '&' : '?') + 'download=1', target: '_blank', rel: 'noopener', text: k === 'voice' ? 'پیام صوتی ' + x.author : f.name, dir: 'auto' }), el('small', { text: MP.fileSize(f.size) + ' · ' + x.author + ' · ' + listTime(x.created_at) })),
              el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'رفتن به پیام', html: icon('chat'), onclick: function () { jumpTo(x.id); } }));
          }));
        }
        if (!pane.childNodes.length || (k === 'media' && !pane.querySelector('button'))) pane.replaceChildren(el('p', { class: 'tg-none', text: 'چیزی نیست' }));
      }).catch(function (e) { pane.replaceChildren(el('p', { class: 'tg-none', text: e.message })); });
    }
    home();
  }

  var SLOW = [[0, 'خاموش'], [10, '۱۰ ثانیه'], [30, '۳۰ ثانیه'], [60, '۱ دقیقه'], [300, '۵ دقیقه'], [900, '۱۵ دقیقه'], [3600, '۱ ساعت']];
  function slowLabel(v) { var x = SLOW.filter(function (s2) { return s2[0] === v; })[0]; return x ? x[1] : fa(v) + ' ثانیه'; }
  /** Group settings for its admins: description, channel mode, slow mode, topics, invite link and roles. */
  function groupAdmin(c) {
    var body = MP.dialog.open('مدیریت «' + c.title + '»', MP.skeleton(3), { wide: true, focus: false });
    var st = c.settings || {};
    var desc = el('textarea', { class: 'input', rows: 2, maxlength: 500, placeholder: 'درباره این گروه (اختیاری)', value: st.desc || '' });
    var mode = el('input', { type: 'checkbox', checked: st.mode === 'channel' });
    var topicsBox = el('input', { type: 'checkbox', checked: !!st.topics });
    var slow = el('select', null, SLOW.map(function (s2) { return el('option', { value: s2[0], text: s2[1], selected: (st.slow || 0) === s2[0] }); }));
    var invite = el('div', { class: 'ga-invite' });
    function drawInvite(url) {
      invite.replaceChildren(url ? el('input', { class: 'input', readonly: true, dir: 'ltr', value: url, onfocus: function (e) { e.target.select(); } }) : el('small', { class: 'hint', text: 'همکاران با این لینک بدون نیاز به ناظر به گروه اضافه می‌شوند.' }),
        el('div', { class: 'ga-row' },
          el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('clip') + (url ? 'کپی لینک' : 'ساخت لینک دعوت'), onclick: function () { if (url) copyText(url); else MP.api('channels/' + c.id + '/invite', { method: 'POST' }).then(function (d) { drawInvite(d.url); copyText(d.url); }).catch(MP.soft); } }),
          url ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'لینک تازه (قبلی باطل شود)', onclick: function () { MP.api('channels/' + c.id + '/invite', { method: 'POST', body: { reset: 1 } }).then(function (d) { drawInvite(d.url); MP.toast('لینک قبلی دیگر کار نمی‌کند'); }).catch(MP.soft); } }) : null));
    }
    drawInvite(st.invite);
    var roles = el('div', { class: 'ga-roles' }, MP.skeleton(2));
    MP.api('channels/' + c.id + '/roles', { noCache: true }).then(function (d) {
      roles.replaceChildren.apply(roles, d.members.map(function (u) {
        var sel = el('select', { disabled: u.fixed || !d.can_edit, onchange: function () { MP.api('channels/' + c.id + '/roles', { method: 'POST', body: { user_id: u.id, role: sel.value } }).then(function () { MP.toast('نقش ' + u.name + ' ذخیره شد'); MP.loadChannels(); }).catch(MP.soft); } },
          [['admin', 'مدیر'], ['member', 'عضو'], ['readonly', 'فقط‌خواندنی']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: u.role === o[0] }); }));
        return el('div', { class: 'ga-role' }, MP.avatar(MP.user(u.id), 'sm'), el('b', { text: u.name + (u.fixed ? ' (همیشه مدیر)' : '') }), sel);
      }));
    }).catch(function (e) { roles.replaceChildren(el('p', { class: 'muted', text: e.message })); });
    var f = el('form', { class: 'form ga' },
      MP.field('توضیح گروه', desc),
      c.type === 'group' ? el('label', { class: 'check' }, mode, el('span', null, el('b', { text: 'کانال اطلاع‌رسانی' }), el('small', { class: 'hint', text: ' — فقط مدیران پیام می‌فرستند؛ بقیه می‌خوانند و ری‌اکشن می‌زنند.' }))) : null,
      el('label', { class: 'check' }, topicsBox, el('span', null, el('b', { text: 'تاپیک‌ها' }), el('small', { class: 'hint', text: ' — گفت‌وگوها جدا از هم، مثلاً «طراحی»، «چاپ» و «مالی».' }))),
      MP.field('حالت آهسته (فاصله بین دو پیام هر عضو)', slow),
      c.type === 'group' ? el('div', { class: 'field' }, el('span', { text: 'لینک دعوت همکاران' }), invite) : null,
      el('div', { class: 'field' }, el('span', { text: 'نقش اعضا' }), el('small', { class: 'hint', text: 'مدیر: سنجاق، تنظیمات و (در کانال) ارسال پیام. فقط‌خواندنی: نمی‌تواند پیام بفرستد.' }), roles),
      MP.actions('ذخیره تنظیمات'));
    f.onsubmit = function (e) {
      e.preventDefault(); MP.busy(f, true);
      MP.api('channels/' + c.id + '/settings', { method: 'POST', body: { desc: desc.value, mode: mode.checked ? 'channel' : 'chat', slow: +slow.value, topics: topicsBox.checked } }).then(function (n) {
        replaceChannel(n); MP.dialog.close(); MP.toast('تنظیمات گروه ذخیره شد');
        if (current === c.id) select(c.id);
      }).catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    body.replaceChildren(f);
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
  /** For the desktop extras (chat-desktop.js): open a chat, search in it, close it, the composer. */
  MP.chatDesk = {
    select: function (id) { MP.showView('messages'); select(id); },
    find: function () { if (current) openFind(); },
    close: function () { if (current) closeChat(); },
    saved: openSaved,
    text: function () { return text; },
    list: function () { return $$('#chat-list .chat-item').map(function (b) { return +b.dataset.id; }).filter(Boolean); },
    current: function () { return current; },
    info: function () { if (current) { if (sideWide()) toggleSide(); else chatInfo(chan()); } },
    /** Folders for the Telegram-style rail: [{id, title, unread}] (unread = chats with unread messages, not muted). */
    folders: function () {
      var main = S.channels.filter(function (c) { return !c.arch_me; });
      return tabsFor(main).map(function (t) { return { id: t[0], title: t[1], unread: main.filter(function (c) { return inTab(c, t[0]) && isUnread(c) && !c.muted; }).length }; });
    },
    folder: function (id) { if (id === undefined) return listTab; listTab = id; listArch = false; try { localStorage.setItem('mp_chat_tab', listTab); } catch (e) { /* private mode */ } renderList(); },
    archive: function () { listArch = true; renderList(); },
    newDirect: function () { newDirect(); }
  };
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
    var body = MP.dialog.open(c.pv ? 'گفت‌وگوی خصوصی مشتری' : 'مشتری و پرتال', MP.skeleton(3), { wide: true, focus: false });
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
            d.manager ? el('button', { type: 'button', class: 'icon-btn sm', title: 'باز کردن پرتال از طرف ' + x.name, 'aria-label': 'باز کردن پرتال از طرف ' + x.name, html: icon('eye'), onclick: function () { viewAs(x.id); } }) : null,
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
              el('span', { class: 'chip', html: icon('chat') + ' ' + (d.pv ? 'گفت‌وگوی خصوصی' : esc(d.title)) }),
              d.pv ? el('span', { class: 'chip brand', text: 'همکاران پروژه‌های مشتری (بدون پروژه: همه)' }) : p ? el('span', { class: 'chip brand', html: icon('folder') + ' ' + esc(p.name) }) : el('span', { class: 'chip danger', text: 'بدون پروژه' }),
              el('span', { class: 'chip ' + (locked ? 'ok' : 'danger'), html: icon('lock') + (locked ? ' ورود با کد پیامکی' : ' بدون ورود') }),
              el('span', { class: 'chip', html: icon('user') + ' ' + fa(d.contacts.length) + ' نفر' })),
            d.logo ? el('button', { type: 'button', class: 'cs-mini-link', text: 'حذف لوگو', onclick: function () { MP.api('channels/' + c.id + '/client', { method: 'POST', body: { logo_file_id: 0 } }).then(draw).catch(MP.soft); } }) : el('small', { class: 'cs-hint', text: 'روی مربع بزنید تا لوگوی مشتری بارگذاری شود؛ کنار لوگوی مربع در پرتال و صفحه ورود نمایش داده می‌شود.' })),
          el('div', { class: 'cs-linkbox' },
            el('small', { text: 'لینک پرتال' }),
            el('input', { value: d.url, readonly: true, dir: 'ltr', onfocus: function (e) { e.target.select(); } }),
            el('div', { class: 'cs-link-actions' },
              el('button', { type: 'button', class: 'btn btn-primary btn-sm', html: icon('clip') + 'کپی لینک', onclick: copyLink }),
              d.manager ? el('button', { type: 'button', class: 'btn btn-secondary btn-sm', title: 'فقط ناظر: پرتال را به جای مشتری باز می‌کند و هر کاری مشتری می‌تواند، به نام او انجام می‌دهید (در گزارش فعالیت ثبت می‌شود)', html: icon('eye') + 'از طرف مشتری', onclick: function () { viewAs(d.contacts.length ? d.contacts[0].id : 0); } }) : null))),
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
            d.pv ? null : el('section', { class: 'cs-card' },
              el('header', null, el('span', { class: 'cs-ico', html: icon('folder') }), el('div', null, el('h3', { text: 'پروژه و نام‌ها' }), el('small', { text: 'پرتال، پیشرفت و طرح‌ها و فاکتورهای همین پروژه را نشان می‌دهد.' }))),
              MP.field('پروژه', proj), MP.field('نام مشتری', client), MP.field('نام گروه', title),
              el('button', { type: 'button', class: 'btn btn-secondary btn-sm cs-save', text: 'ذخیره نام‌ها', onclick: function () { save({ title: title.value, client_name: client.value }, 'ذخیره شد'); } })),
            d.pv ? null : staffCard(d),
            d.pv ? null : el('section', { class: 'cs-card' },
              el('header', null, el('span', { class: 'cs-ico', html: icon('tasks') }), el('div', null, el('h3', { text: 'اجازه‌های مشتری' }), el('small', { text: 'برای همین پرتال؛ هر وقت خواستید عوضش کنید.' }))),
              (function () {
                var tk = el('input', { type: 'checkbox', checked: !!d.client_tasks, disabled: d.project_id ? null : '' });
                tk.onchange = function () {
                  MP.api('channels/' + c.id + '/client', { method: 'POST', body: { client_tasks: tk.checked } })
                    .then(function (n) { MP.toast(n.client_tasks ? 'مشتری از این به بعد می‌تواند کار اضافه کند' : 'اجازه افزودن کار برداشته شد'); draw(n); })
                    .catch(function (err) { tk.checked = !tk.checked; MP.soft(err); });
                };
                return el('div', null, el('label', { class: 'check' }, tk, el('span', { text: 'مشتری بتواند در پرتال کار (تسک) اضافه کند' })),
                  el('p', { class: 'hint', text: d.project_id ? 'کارهای مشتری در همین پروژه، به نام سازنده گروه و با برچسب «از طرف مشتری» ساخته می‌شوند و اعضای گروه اعلان می‌گیرند.' : 'اول گروه را به یک پروژه وصل کنید.' }));
              })()),
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
      var touch = e.pointerType !== 'mouse';
      timer = setTimeout(function () { timer = 0; fired = true; node.classList.remove('pressing'); MP.haptic(15); fire(touch); }, 480);
    });
    node.addEventListener('pointermove', function (e) { if (timer && (Math.abs(e.clientX - x) > 10 || Math.abs(e.clientY - y) > 10)) cancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { node.addEventListener(ev, cancel); });
    node.addEventListener('click', function (e) { if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; } }, true);
    node.addEventListener('contextmenu', function (e) { e.preventDefault(); if (fired) return; cancel(); fire(false); });
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
  /** The conversation's actions (menu beside it, or under its preview when held on a phone). */
  function chatMenuItems(c) {
    var forAll = S.manager && c.type !== 'direct', items = [], sep = null;
    if (current !== c.id) items.push(['chat', 'باز کردن گفت‌وگو', function () { select(c.id); }]);
    if (FINE && !MP_CONFIG_POP()) items.push(['grid', 'باز کردن در پنجره جدا', function () { popOut(c); }]);
    // Pin
    if (c.pinned === 'all') {
      if (forAll) items.push(['pin', 'برداشتن سنجاق برای همه', function () { setPin(c, 'all', false); }]);
    } else {
      items.push(c.pinned === 'me' ? ['pin', 'برداشتن سنجاق', function () { setPin(c, 'me', false); }] : ['pin', 'سنجاق برای خودم', function () { setPin(c, 'me', true); }]);
      if (forAll) items.push(['pin', 'سنجاق برای همه اعضا', function () { setPin(c, 'all', true); }]);
    }
    if (c.type !== 'saved') items.push(c.muted ? ['bell', 'روشن کردن اعلان', function () { setMute(c, false); }] : ['bell-off', 'بی‌صدا کردن', function () { setMute(c, true); }]);
    items.push(isUnread(c) ? ['checks', 'علامت خوانده‌شده', function () { markRead(c); }] : ['chat', 'علامت نخوانده', function () { toggleRead(c); }]);
    items.push(['folder', c.arch_me ? 'بیرون آوردن از بایگانی' : 'بایگانی', function () { archiveChat(c, !c.arch_me); }]);
    if (c.pinned === 'me' && S.channels.filter(function (x) { return x.pinned === 'me'; }).length > 1) items.push(['list', 'ترتیب سنجاق‌ها', pinOrder]);
    items.push(['eye', 'اطلاعات گفت‌وگو', function () { if (sideWide() && c.id === current) { if (!sidePref()) toggleSide(); } else chatInfo(c); }]);
    if (S.boot.channels.ai && c.last) items.push(['list', 'خلاصه هوشمند پیام‌ها', function () { summarize(c); }]);
    items.push(['image', 'ظاهر گفت‌وگو', function () { chatLook(c); }]);
    if (isGroup(c) && c.role === 'admin') items.push(['settings', 'مدیریت گروه', function () { groupAdmin(c); }]);
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
    if (c.can_delete) { items.push(sep); items.push(['folder', c.pv ? 'آرشیو گفت‌وگو' : 'آرشیو گروه', function () { deleteClient(c); }, true]); }
    // No separators at the ends or twice in a row.
    items = items.filter(function (it, i, a) { return it || (i > 0 && i < a.length - 1 && a[i - 1]); });
    while (items.length && !items[items.length - 1]) items.pop();
    return items;
  }
  function chatMenu(c, anchor) {
    if (openMenu) openMenu();
    var forAll = S.manager && c.type !== 'direct', items = chatMenuItems(c);
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

  /**
   * Hold a conversation on a phone: its latest messages in a card (nothing is marked read), with its actions
   * below; tap the card to open the chat — like Telegram's preview.
   */
  function peek(c, anchor) {
    if (openMenu) openMenu();
    var msgsBox = el('div', { class: 'pk-msgs' }, MP.skeleton(3));
    var card = el('button', { type: 'button', class: 'pk-card', onclick: function () { close(); select(c.id); } },
      el('span', { class: 'pk-head' }, channelIcon(c, 'sm'), el('span', { class: 'pk-title' }, el('b', { text: c.title }), el('small', { text: c.type === 'direct' ? lastSeen(Math.max(seenOf(c.other), c.last_seen || 0)) : fa(c.members || 0) + ' عضو' }))),
      msgsBox);
    var menu = el('div', { class: 'ctx-menu pk-menu in', role: 'menu' }, chatMenuItems(c).map(function (it) {
      if (!it) return el('hr', { class: 'ctx-sep', role: 'separator' });
      var b = el('button', { type: 'button', role: 'menuitem', class: it[3] ? 'danger' : '', html: icon(it[0]), onclick: function () { close(); it[2](); } });
      b.append(el('span', { text: it[1] }));
      return b;
    }));
    var layer = el('div', { class: 'pk-layer' }, el('div', { class: 'pk-shade', onclick: function () { close(); } }), el('div', { class: 'pk-box' }, card, menu));
    document.body.append(layer);
    requestAnimationFrame(function () { layer.classList.add('in'); });
    var lay = MP.pushLayer(function () { lay = null; close(); });
    MP.api('channels/' + c.id + '/messages', { query: { after: 0, peek: 1 }, noCache: true }).then(function (d) {
      var list = d.messages.filter(function (m) { return !m.deleted && m.kind !== 'system'; }).slice(-14);
      msgsBox.replaceChildren.apply(msgsBox, list.length ? list.map(function (m) {
        var k = kindOf(m);
        return el('div', { class: 'pk-row ' + (m.mine ? 'me' : 'other') },
          el('span', { class: 'pk-bub' }, !m.mine && isGroup(c) ? el('b', { text: m.author.split(' ')[0] }) : null,
            k === 'photo' && m.file ? el('img', { src: m.file.thumb || m.file.mid || m.file.url, alt: '' }) : null,
            el('span', { text: snippet(m) || '' }), el('time', { text: hm(m.created_at) })));
      }) : [el('p', { class: 'muted', text: 'هنوز پیامی نیست' })]);
      MP.emojify(msgsBox);
      msgsBox.scrollTop = msgsBox.scrollHeight;
    }).catch(function () { msgsBox.replaceChildren(el('p', { class: 'muted', text: 'پیش‌نمایش باز نشد' })); });
    function close() {
      if (openMenu !== close) return;
      openMenu = null;
      layer.classList.remove('in'); setTimeout(function () { layer.remove(); }, 180);
      if (lay) { var l = lay; lay = null; MP.popLayer(l); }
    }
    openMenu = close;
  }

  /** My pinned chats in the order I want (arrows; the first is shown on top). */
  function pinOrder() {
    var mine = S.channels.filter(function (x) { return x.pinned === 'me'; }).sort(listOrder);
    var box2 = el('div', { class: 'po-list' });
    function draw() {
      box2.replaceChildren.apply(box2, mine.map(function (c, i) {
        return el('div', { class: 'po-row' }, channelIcon(c, 'sm'), el('b', { text: c.title }),
          el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'بالاتر', html: icon('arrow-up'), disabled: i === 0, onclick: function () { mine.splice(i - 1, 0, mine.splice(i, 1)[0]); draw(); } }),
          el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'پایین‌تر', html: icon('arrow-down'), disabled: i === mine.length - 1, onclick: function () { mine.splice(i + 1, 0, mine.splice(i, 1)[0]); draw(); } }));
      }));
    }
    draw();
    var f = el('form', { class: 'form' }, el('p', { class: 'hint', text: 'گفت‌وگوهایی که برای خودتان سنجاق کرده‌اید، به همین ترتیب بالای فهرست می‌مانند.' }), box2, MP.actions('ذخیره ترتیب'));
    f.onsubmit = function (e) {
      e.preventDefault();
      MP.api('channels/pins-order', { method: 'POST', body: { ids: mine.map(function (c) { return c.id; }) } }).then(function (l) { S.channels = l; MP.dialog.close(); renderList(); MP.toast('ترتیب سنجاق‌ها ذخیره شد', { icon: 'pin' }); }).catch(MP.soft);
    };
    MP.dialog.open('ترتیب سنجاق‌ها', f);
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
      else { layout.classList.remove('open'); noChat(); }
    });
  }
  MP.view('messages', { open: open });

  /** Addresses inside the panel: #chat-12 (a chat), #chat-12-reply (from a notification), #msg-345 (a message link), #join-… (an invite). */
  MP.chatRoute = function (h) {
    var m;
    if ((m = /^chat-(\d+)(-reply)?$/.exec(h))) { MP.showView('messages', { channel: +m[1], reply: !!m[2] }); return true; }
    if ((m = /^msg-(\d+)$/.exec(h))) { MP.openMessage(+m[1]); return true; }
    if ((m = /^join-([A-Za-z0-9]{10,})$/.exec(h))) { joinGroup(m[1]); return true; }
    if (h === 'saved') { MP.showView('messages'); openSaved(); return true; }
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
