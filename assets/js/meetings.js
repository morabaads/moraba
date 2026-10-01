/* Meetings: video meetings with their own link (/m/{token}), waiting room, password and time limit;
   list / search / filter, create / edit / delete, attendance history, calendar file. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, fa = MP.fa, icon = MP.icon;
  var list = [], tab = 'upcoming', q = '', qTimer = null;
  var STATUS = { scheduled: 'برنامه‌ریزی‌شده', live: 'در حال برگزاری', ended: 'پایان‌یافته' };
  var WAITING = [['guests', 'فقط مهمان‌های بیرون از سازمان', 'همکاران مستقیم وارد می‌شوند؛ مهمان‌ها منتظر تأیید می‌مانند.'], ['all', 'همه شرکت‌کنندگان', 'هر کسی جز میزبان باید تأیید شود.'], ['off', 'بدون اتاق انتظار', 'هر کس لینک (و رمز) را دارد مستقیم وارد می‌شود.']];
  var DURATIONS = [[15, '۱۵ دقیقه'], [30, '۳۰ دقیقه'], [45, '۴۵ دقیقه'], [60, '۱ ساعت'], [90, '۱.۵ ساعت'], [120, '۲ ساعت'], [0, 'بدون محدودیت']];

  /* ------------------------------------------------------------ helpers */

  function dayLabel(d) {
    if (d === S.today) return 'امروز';
    if (d === J.addDays(S.today, 1)) return 'فردا';
    if (d === J.addDays(S.today, -1)) return 'دیروز';
    return J.weekdays[J.weekday(d)] + ' ' + J.format(d);
  }
  function minutes(sec) { var m = Math.round(sec / 60); return m < 60 ? fa(m) + ' دقیقه' : fa(Math.floor(m / 60)) + ' ساعت' + (m % 60 ? ' و ' + fa(m % 60) + ' دقیقه' : ''); }
  function copy(text, done) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { MP.toast(done || 'کپی شد'); }, function () {
      var i = el('textarea', { style: { position: 'fixed', opacity: '0' } }, text); document.body.append(i); i.select(); document.execCommand('copy'); i.remove(); MP.toast(done || 'کپی شد');
    });
  }
  function inviteText(m) {
    return 'دعوت به جلسه آنلاین «' + m.title + '»\n' + J.formatLong(m.date) + ' · ساعت ' + MP.timeFa(m.time) + '\n' + m.link + (m.password ? '\nرمز جلسه: ' + m.password : '');
  }
  MP.joinMeeting = function (m) { window.open(m.url || m.link, '_blank', 'noopener'); };

  /** An .ics file so the meeting lands in Google / Apple / Outlook calendars too. */
  function ics(m) {
    var d = m.date.replace(/-/g, ''), t = m.time.replace(':', '') + '00';
    var start = new Date(m.date + 'T' + m.time + ':00'), end = new Date(start.getTime() + (m.duration || 60) * 60000);
    function fmt(x) { function p(n) { return (n < 10 ? '0' : '') + n; } return x.getFullYear() + p(x.getMonth() + 1) + p(x.getDate()) + 'T' + p(x.getHours()) + p(x.getMinutes()) + '00'; }
    var body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Moraba//Panel//FA', 'BEGIN:VEVENT', 'UID:mp-meeting-' + m.id + '@' + location.hostname,
      'DTSTAMP:' + d + 'T' + t, 'DTSTART:' + d + 'T' + t, 'DTEND:' + fmt(end), 'SUMMARY:' + m.title.replace(/[,;]/g, ' '),
      'DESCRIPTION:' + (m.description || '').replace(/\n/g, '\\n').replace(/[,;]/g, ' ') + '\\n' + m.link, 'URL:' + m.link, 'LOCATION:' + m.link,
      'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', 'DESCRIPTION:' + m.title, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    var a = el('a', { href: URL.createObjectURL(new Blob([body], { type: 'text/calendar' })), download: 'meeting-' + m.id + '.ics' });
    document.body.append(a); a.click(); a.remove();
  }

  /* ------------------------------------------------------------ list */

  function load() {
    var body = $('#mt-body');
    if (!list.length) body.replaceChildren(MP.skeleton(3));
    return MP.api('meetings', { query: { scope: tab === 'all' ? '' : tab, q: q } }).then(function (l) { list = l; draw(); }).catch(MP.soft);
  }
  function draw() {
    var tabs = $('#mt-tabs'), body = $('#mt-body');
    tabs.replaceChildren.apply(tabs, [['upcoming', 'پیش رو'], ['today', 'امروز'], ['past', 'گذشته'], ['all', 'همه']].map(function (t) {
      return el('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(tab === t[0]), onclick: function () { tab = t[0]; list = []; load(); } }, t[1]);
    }));
    var live = list.filter(function (m) { return m.status === 'live'; });
    var groups = [], last = null;
    list.forEach(function (m) { if (!last || last.date !== m.date) { last = { date: m.date, items: [] }; groups.push(last); } last.items.push(m); });
    body.replaceChildren.apply(body, [
      live.length ? el('div', { class: 'mt-live-banner' }, el('span', { class: 'mt-pulse' }), el('div', null, el('b', { text: live.length > 1 ? fa(live.length) + ' جلسه در حال برگزاری است' : '«' + live[0].title + '» در حال برگزاری است' }), el('small', { text: live.length === 1 ? fa(live[0].online) + ' نفر داخل جلسه هستند' : 'برای ورود روی جلسه بزنید' })),
        live.length === 1 ? el('button', { type: 'button', class: 'btn btn-primary btn-sm', html: icon('video') + 'ورود', onclick: function () { MP.joinMeeting(live[0]); } }) : null) : null,
      list.length ? el('div', { class: 'mt-list' }, groups.map(function (g) {
        return el('section', { class: 'mt-day' }, el('h3', { class: 'mt-day-head' }, el('span', { text: dayLabel(g.date) }), el('small', { text: fa(g.items.length) + ' جلسه' })), g.items.map(card));
      })) : MP.empty('video', q ? 'جلسه‌ای پیدا نشد' : tab === 'past' ? 'جلسه گذشته‌ای نیست' : 'جلسه‌ای در پیش نیست', q ? null : 'جلسه آنلاین بسازید، همکاران را دعوت کنید و لینک را برای مهمان بفرستید.', q ? null : { text: 'جلسه جدید', onclick: function () { MP.meetingForm(); } })].filter(Boolean));
  }
  function card(m) {
    var people = m.people.slice(); if (people.indexOf(m.created_by) < 0) people.unshift(m.created_by);
    var stack = el('span', { class: 'stack' });
    people.slice(0, 4).forEach(function (id) { stack.append(MP.avatar(MP.user(id), 'sm')); });
    if (people.length > 4) stack.append(el('span', { class: 'avatar sm more', text: '+' + fa(people.length - 4) }));
    var proj = m.project_id && MP.project(m.project_id);
    return el('article', { class: 'card mt-card ' + m.status },
      el('button', { type: 'button', class: 'mt-main', onclick: function () { MP.meetingDetails(m); } },
        el('div', { class: 'mt-time' }, el('b', { class: 'num', text: MP.timeFa(m.time) }), el('small', { text: m.duration ? minutes(m.duration * 60) : 'آزاد' })),
        el('div', { class: 'mt-copy' },
          el('strong', { text: m.title }),
          el('div', { class: 'mt-chips' },
            el('span', { class: 'chip ' + (m.status === 'live' ? 'danger mt-live' : m.status === 'ended' ? '' : 'brand'), text: STATUS[m.status] + (m.status === 'live' && m.online ? ' · ' + fa(m.online) + ' نفر' : '') }),
            proj ? el('span', { class: 'chip', html: icon('folder') + ' ' }, proj.name) : null,
            m.has_password ? el('span', { class: 'chip', html: icon('lock') + ' رمزدار' }) : null,
            m.waiting !== 'off' ? el('span', { class: 'chip', text: 'اتاق انتظار' }) : null)),
        stack),
      el('footer', { class: 'mt-actions' },
        m.status !== 'ended' || m.is_host ? el('button', { type: 'button', class: 'btn btn-sm ' + (m.status === 'live' ? 'btn-primary' : 'btn-secondary'), html: icon('video') + (m.status === 'live' ? 'پیوستن' : m.is_host && m.status !== 'live' ? 'شروع جلسه' : 'ورود'), onclick: function () { MP.joinMeeting(m); } }) : null,
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', html: icon('clip') + 'کپی دعوت', onclick: function () { copy(inviteText(m), 'متن دعوت کپی شد'); } }),
        el('span', { class: 'spacer' }),
        m.is_host && m.status !== 'ended' ? el('button', { type: 'button', class: 'icon-btn sm', title: 'ویرایش', 'aria-label': 'ویرایش', html: icon('edit'), onclick: function () { MP.meetingForm({ meeting: m }); } }) : null,
        m.can_delete ? el('button', { type: 'button', class: 'icon-btn sm', title: 'حذف', 'aria-label': 'حذف', html: icon('trash'), onclick: function () { remove(m); } }) : null));
  }
  function remove(m) {
    MP.confirm('حذف جلسه', 'جلسه «' + m.title + '» حذف شود؟' + (m.status !== 'ended' ? ' به شرکت‌کنندگان اطلاع داده می‌شود.' : ''), 'حذف', true).then(function (ok) {
      if (!ok) return;
      MP.api('meetings/' + m.id, { method: 'DELETE' }).then(function () { MP.dialog.close(); MP.toast('جلسه حذف شد'); changed(); }).catch(MP.soft);
    });
  }
  function changed() { MP.emit('meetings'); if (MP.visible('meetings')) load(); }

  /* ------------------------------------------------------------ details */

  MP.meetingDetails = function (m0) {
    MP.dialog.open(m0.title, MP.skeleton(2), { wide: true });
    MP.api('meetings/' + m0.id).then(function (m) {
      var people = m.people.map(function (id) { return MP.user(id).name; });
      var att = m.attendance || [];
      var linkBox = el('div', { class: 'mt-link' }, el('input', { value: m.link, readonly: true, dir: 'ltr', onfocus: function (e) { e.target.select(); } }),
        el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('clip') + 'کپی لینک', onclick: function () { copy(m.link, 'لینک کپی شد'); } }));
      var table = att.length ? el('div', { class: 'mt-att' }, att.map(function (a) {
        return el('div', { class: 'mt-att-row' + (a.absent ? ' absent' : '') },
          a.user_id ? MP.avatar(MP.user(a.user_id), 'sm') : el('span', { class: 'avatar sm guest', text: (a.name || '؟').slice(0, 1) }),
          el('div', { class: 'mt-att-name' }, el('b', { text: a.name }), el('small', { text: a.role === 'host' ? 'میزبان' : a.role === 'guest' ? 'مهمان' : 'همکار' })),
          a.absent ? el('span', { class: 'chip danger', text: 'غایب' }) : el('div', { class: 'mt-att-time' },
            el('span', { text: 'ورود ' + MP.timeFa(a.first.slice(11, 16)) + (a.times > 1 ? ' · ' + fa(a.times) + ' بار' : '') }),
            el('b', { text: a.online ? 'الان داخل جلسه' : minutes(a.seconds) })));
      })) : el('p', { class: 'muted', text: m.status === 'scheduled' ? 'جلسه هنوز شروع نشده است.' : 'کسی وارد جلسه نشد.' });
      MP.dialog.open(m.title, el('div', { class: 'mt-detail' },
        el('div', { class: 'mt-detail-head' },
          el('span', { class: 'chip ' + (m.status === 'live' ? 'danger mt-live' : m.status === 'ended' ? '' : 'brand'), text: STATUS[m.status] }),
          el('span', { class: 'muted', text: J.formatLong(m.date) + ' · ساعت ' + MP.timeFa(m.time) + (m.duration ? ' · ' + minutes(m.duration * 60) : '') })),
        m.description ? el('p', { class: 'mt-desc', text: m.description }) : null,
        MP.detailRow('برگزارکننده', MP.user(m.created_by).name),
        people.length ? MP.detailRow('دعوت‌شدگان', people.join('، ')) : null,
        m.project_id && MP.project(m.project_id) ? MP.detailRow('پروژه', MP.project(m.project_id).name) : null,
        MP.detailRow('اتاق انتظار', WAITING.filter(function (w) { return w[0] === m.waiting; })[0][1]),
        m.is_host && m.password ? MP.detailRow('رمز جلسه', m.password) : null,
        m.started_at ? MP.detailRow('برگزاری', 'شروع ' + MP.timeFa(m.started_at.slice(11, 16)) + (m.ended_at ? ' · پایان ' + MP.timeFa(m.ended_at.slice(11, 16)) : '')) : null,
        el('h4', { class: 'mt-sub', text: 'لینک اختصاصی جلسه' }), linkBox,
        el('h4', { class: 'mt-sub', text: 'حضور شرکت‌کنندگان' }), table,
        el('div', { class: 'dialog-actions', style: { marginTop: '16px' } },
          m.status !== 'ended' || m.is_host ? el('button', { type: 'button', class: 'btn btn-primary', html: icon('video') + (m.status === 'live' ? 'پیوستن' : m.is_host ? 'شروع جلسه' : 'ورود به جلسه'), onclick: function () { MP.joinMeeting(m); } }) : null,
          el('button', { type: 'button', class: 'btn btn-secondary', html: icon('send') + 'کپی متن دعوت', onclick: function () { copy(inviteText(m), 'متن دعوت کپی شد'); } }),
          el('button', { type: 'button', class: 'btn btn-secondary', html: icon('calendar') + 'افزودن به تقویم', onclick: function () { ics(m); } }),
          el('span', { class: 'spacer' }),
          m.is_host && m.status === 'live' ? el('button', { type: 'button', class: 'btn btn-danger', text: 'پایان جلسه', onclick: function () {
            MP.confirm('پایان جلسه', 'جلسه برای همه شرکت‌کنندگان تمام شود؟', 'پایان جلسه', true).then(function (ok) { if (ok) MP.api('meetings/' + m.id + '/end', { method: 'POST' }).then(function () { MP.toast('جلسه پایان یافت'); changed(); MP.meetingDetails(m); }).catch(MP.soft); });
          } }) : null,
          m.is_host && m.status !== 'ended' ? el('button', { type: 'button', class: 'btn btn-secondary', html: icon('edit') + 'ویرایش', onclick: function () { MP.meetingForm({ meeting: m }); } }) : null,
          m.can_delete ? el('button', { type: 'button', class: 'btn btn-ghost', html: icon('trash') + 'حذف', onclick: function () { remove(m); } }) : null)), { wide: true });
    }).catch(function (e) { MP.dialog.close(); MP.soft(e); });
  };

  /* ------------------------------------------------------------ form */

  MP.meetingForm = function (preset) {
    preset = preset || {};
    var m = preset.meeting || null;
    var settings = S.meetSettings || { duration: 60, waiting: 'guests' };
    var duration = m ? m.duration : settings.duration;
    var durInput = el('input', { type: 'hidden', name: 'duration', value: duration });
    var durChips = el('div', { class: 'tf-chips' }, DURATIONS.map(function (d) {
      return el('button', { type: 'button', class: 'tf-chip' + (d[0] === +duration ? ' on' : ''), text: d[1], onclick: function (e) { durInput.value = d[0]; Array.prototype.forEach.call(durChips.children, function (c) { c.classList.remove('on'); }); e.currentTarget.classList.add('on'); } });
    }));
    var pass = el('input', { name: 'password', maxlength: 64, dir: 'ltr', value: m ? m.password : '', placeholder: 'بدون رمز', autocomplete: 'off' });
    var waitSel = el('div', { class: 'mt-wait-opts' }, WAITING.map(function (w) {
      return el('label', { class: 'mt-wait-opt' }, el('input', { type: 'radio', name: 'waiting', value: w[0], checked: (m ? m.waiting : settings.waiting) === w[0] }), el('span', null, el('b', { text: w[1] }), el('small', { text: w[2] })));
    }));
    var form = el('form', { class: 'form tf' },
      el('label', { class: 'tf-titlebox' }, el('span', { class: 'tf-label', html: icon('video') + 'عنوان جلسه' + '<em>ضروری</em>' }),
        el('input', { name: 'title', class: 'tf-title', required: true, maxlength: 160, placeholder: 'مثلاً بررسی طراحی داشبورد', value: m ? m.title : preset.title || '', autocomplete: 'off' })),
      el('section', { class: 'tf-sec' }, el('span', { class: 'tf-label', html: icon('calendar') + 'زمان' }),
        el('div', { class: 'row' }, MP.dateField('date', m ? m.date : preset.date || S.today, 'تاریخ'), MP.field('ساعت', el('input', { name: 'time', type: 'time', value: m ? m.time : preset.time || '' }), 'خالی بماند = همین الان')),
        el('span', { class: 'tf-note', text: 'مدت جلسه (پس از آن، جلسه خودکار پایان می‌یابد)' }), durChips, durInput),
      el('section', { class: 'tf-sec' }, el('span', { class: 'tf-label', html: icon('user') + 'دعوت همکاران' }),
        MP.peoplePicker('people', m ? m.people : preset.people || [], [S.me.id]),
        el('span', { class: 'tf-note', html: icon('send') + ' به دعوت‌شدگان اعلان داده می‌شود؛ مهمان بیرون از سازمان را با لینک جلسه دعوت کنید.' })),
      el('section', { class: 'tf-sec' }, el('span', { class: 'tf-label', html: icon('lock') + 'امنیت و ورود' }),
        MP.field('رمز جلسه (فقط برای مهمان‌های بیرونی)', el('div', { class: 'mt-pass' }, pass, el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'رمز تصادفی', onclick: function () { pass.value = String(Math.floor(100000 + Math.random() * 900000)); } }))),
        el('span', { class: 'tf-note', text: 'اتاق انتظار: چه کسانی برای ورود باید تأیید میزبان را بگیرند؟' }), waitSel),
      el('details', { class: 'tf-more' }, el('summary', { text: 'تنظیمات بیشتر' }),
        MP.field('توضیحات / دستور جلسه', el('textarea', { name: 'description', rows: 3, maxlength: 2000, placeholder: 'موضوعاتی که بررسی می‌شود…' }, m ? m.description : '')),
        el('div', { class: 'row' },
          MP.field('پروژه', MP.projectSelect('project_id', m ? m.project_id : preset.projectId || 0)),
          MP.field('لینک بیرونی (اختیاری)', el('input', { name: 'url', type: 'url', placeholder: 'اگر جلسه در سرویس دیگری است', dir: 'ltr', value: m ? m.url : '' })))),
      MP.actions(m ? 'ذخیره تغییرات' : 'ساخت جلسه و دعوت'));
    if (m && m.url || m && m.description) $('.tf-more', form).open = true;
    form.onsubmit = function (e) {
      e.preventDefault();
      var f = form.elements, url = f.url.value.trim();
      if (!f.title.value.trim()) { f.title.focus(); MP.toast('عنوان جلسه را بنویسید', { error: true }); return; }
      if (url) { try { if (['http:', 'https:'].indexOf(new URL(url).protocol) < 0) throw new Error(); } catch (err) { f.url.setCustomValidity('لینک باید با https یا http شروع شود'); f.url.reportValidity(); return; } }
      MP.busy(form, true);
      MP.api(m ? 'meetings/' + m.id : 'meetings', { method: 'POST', body: {
        title: f.title.value.trim(), date: f.date.value, time: f.time.value, url: url, project_id: +f.project_id.value,
        people: MP.checked(form, 'people'), duration: +durInput.value, password: pass.value.trim(), waiting: (form.querySelector('input[name="waiting"]:checked') || {}).value || 'guests',
        description: f.description.value.trim() } })
        .then(function (saved) {
          MP.toast(m ? 'جلسه ذخیره شد' : 'جلسه ساخته شد و به دعوت‌شدگان اطلاع داده شد');
          changed();
          MP.meetingDetails(saved);
        })
        .catch(function (err) { MP.busy(form, false); MP.soft(err); });
    };
    form.elements.url.oninput = function () { form.elements.url.setCustomValidity(''); };
    MP.dialog.open(m ? 'ویرایش جلسه' : 'جلسه جدید', form, { wide: true });
    if (!m) setTimeout(function () { form.elements.title.focus(); }, 60);
  };

  /* ------------------------------------------------------------ settings (supervisors) */

  /** Gathers ICE candidates with the servers in the form: shows whether STUN and TURN answer from this network. */
  function testIce(form, btn) {
    var f = form.elements, out = $('.mt-test-out', form), servers = [];
    f.stun.value.split(/[\s,]+/).filter(Boolean).forEach(function (u) { servers.push({ urls: u }); });
    if (f.turn_url.value.trim()) servers.push({ urls: f.turn_url.value.trim().split(/[\s,]+/), username: f.turn_user.value, credential: f.turn_pass.value });
    if (!window.RTCPeerConnection) { out.textContent = 'این مرورگر WebRTC ندارد.'; return; }
    var pc, found = { host: 0, srflx: 0, relay: 0 }, done = false;
    try { pc = new RTCPeerConnection({ iceServers: servers }); } catch (err) { out.textContent = 'آدرس سرورها معتبر نیست: ' + err.message; return; }
    btn.disabled = true; out.textContent = 'در حال تست (حداکثر ۸ ثانیه)…';
    function finish() {
      if (done) return; done = true; btn.disabled = false; pc.close();
      out.replaceChildren(
        el('div', { class: found.srflx ? 'ok' : 'bad', text: (found.srflx ? '✓ ' : '✗ ') + 'STUN: ' + (found.srflx ? 'پاسخ داد' : 'پاسخی نیامد (احتمالاً فیلتر است)') }),
        f.turn_url.value.trim() ? el('div', { class: found.relay ? 'ok' : 'bad', text: (found.relay ? '✓ ' : '✗ ') + 'TURN: ' + (found.relay ? 'کار می‌کند' : 'پاسخی نیامد؛ آدرس، نام کاربری و رمز را بررسی کنید') })
          : el('div', { class: 'bad', text: '✗ TURN تنظیم نشده؛ بدون آن، بیشتر اتصال‌ها روی اینترنت همراه برقرار نمی‌شود.' }),
        el('small', { text: 'این تست از شبکه همین دستگاه است؛ نتیجه برای شبکه‌های دیگر ممکن است فرق کند.' }));
    }
    pc.onicecandidate = function (e) {
      if (!e.candidate) return finish();
      var m = / typ (\w+)/.exec(e.candidate.candidate); if (m && found[m[1]] !== undefined) found[m[1]]++;
    };
    pc.createDataChannel('t');
    pc.createOffer().then(function (d) { return pc.setLocalDescription(d); }).catch(finish);
    setTimeout(finish, 8000);
  }

  function settingsDialog() {
    MP.api('meetings/settings').then(function (s) {
      var form = el('form', { class: 'form' },
        el('p', { class: 'hint', text: 'تصویر و صدا مستقیم بین مرورگرها رد و بدل می‌شود. اگر بعضی شرکت‌کنندگان (مثلاً روی اینترنت همراه) تصویر یکدیگر را نمی‌بینند، یک سرور TURN وارد کنید.' }),
        MP.field('سرورهای STUN', el('input', { name: 'stun', dir: 'ltr', value: s.stun, placeholder: 'stun:stun.l.google.com:19302' }), 'چند آدرس را با فاصله یا ویرگول جدا کنید.'),
        MP.field('سرور TURN (اختیاری)', el('input', { name: 'turn_url', dir: 'ltr', value: s.turn_url || '', placeholder: 'turn:turn.example.com:3478' })),
        el('div', { class: 'row' }, MP.field('نام کاربری TURN', el('input', { name: 'turn_user', dir: 'ltr', value: s.turn_user || '' })), MP.field('رمز TURN', el('input', { name: 'turn_pass', dir: 'ltr', type: 'password', value: s.turn_pass || '' }))),
        el('div', { class: 'row' },
          MP.field('مدت پیش‌فرض جلسه', MP.select('duration', DURATIONS.map(function (d) { return [d[0], d[1]]; }), +s.duration)),
          MP.field('اتاق انتظار پیش‌فرض', MP.select('waiting', WAITING.map(function (w) { return [w[0], w[1]]; }), s.waiting))),
        el('div', { class: 'mt-test' }, el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('repeat') + 'تست اتصال', onclick: function (e) { testIce(form, e.currentTarget); } }), el('div', { class: 'mt-test-out' })),
        MP.actions('ذخیره'));
      form.onsubmit = function (e) {
        e.preventDefault();
        var f = form.elements;
        MP.busy(form, true);
        MP.api('meetings/settings', { method: 'POST', body: { stun: f.stun.value, turn_url: f.turn_url.value, turn_user: f.turn_user.value, turn_pass: f.turn_pass.value, duration: +f.duration.value, waiting: f.waiting.value } })
          .then(function (n) { S.meetSettings = n; MP.dialog.close(); MP.toast('تنظیمات جلسه ذخیره شد'); })
          .catch(function (err) { MP.busy(form, false); MP.soft(err); });
      };
      MP.dialog.open('تنظیمات جلسات آنلاین', form, { wide: true });
    }).catch(MP.soft);
  }

  /* ------------------------------------------------------------ view */

  $('#mt-new').onclick = function () { MP.meetingForm(); };
  $('#mt-settings').onclick = settingsDialog;
  $('#mt-q').oninput = function (e) { clearTimeout(qTimer); qTimer = setTimeout(function () { q = e.target.value.trim(); load(); }, 250); };
  MP.view('meetings', { open: function (o) {
    if (!S.meetSettings) MP.api('meetings/settings').then(function (s) { S.meetSettings = s; }).catch(function () {});
    load().then(function () { if (o && o.open) MP.meetingDetails({ id: +o.open, title: 'جلسه' }); });
  } });
  setInterval(function () { if (MP.visible('meetings') && !document.hidden && !document.querySelector('dialog[open]')) load(); }, 30000);
})();
