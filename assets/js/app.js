/* Boot: load everything once, pick the start page from the URL hash, then keep counts fresh. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, C = window.MP_CONFIG || {};

  function load() {
    return MP.api('bootstrap').then(function (boot) {
      MP.applyBoot(boot);
      return Promise.all([
        MP.loadTasks(), MP.loadProjects(), MP.loadMeetings(), MP.loadAttendance(),
        MP.api('channels').then(function (l) { S.channels = l; }),
        MP.api('reminders').then(function (l) { S.reminders = l; }),
        MP.api('leaves', { query: { scope: 'mine' } }).then(function (l) { S.leaves = l; }),
        MP.api('notifications').then(function (l) { S.notifications = l; MP.renderNotifications(); })
      ]);
    });
  }

  var started = false;
  function begin() {
    if (started) return;
    started = true;
    document.body.classList.remove('is-loading');
    var start = (location.hash || '').slice(1);
    if (MP.liveStart) MP.liveStart();
    // Home-screen shortcuts (manifest): #new-task, #punch.
    if (start === 'new-task') { MP.showView('dashboard'); setTimeout(function () { MP.taskForm(); }, 300); }
    else if (start === 'widgets') { MP.showView('dashboard'); setTimeout(MP.openWidgets, 300); }
    else if (/^task-\d+$/.test(start)) { MP.showView('mytasks'); setTimeout(function () { MP.openTask(+start.slice(5)); }, 300); }
    else if (MP.chatRoute && MP.chatRoute(start)) { /* a chat, a message link or an invite */ }
    else if (start === 'punch') { MP.showView('attendance'); setTimeout(function () { var c = document.getElementById('punch-chip'); if (c) c.click(); }, 300); }
    else MP.showView(C.chatApp ? 'messages' : start || 'dashboard');
    MP.renderPrompts();
    setInterval(function () { if (!document.hidden) MP.refreshCounts(); }, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) MP.refreshCounts(); });
    window.addEventListener('hashchange', function () {
      var v = location.hash.slice(1);
      if (/^task-\d+$/.test(v)) { MP.openTask(+v.slice(5)); return; }
      if (MP.chatRoute && MP.chatRoute(v)) return;
      if (v === 'widgets') { MP.openWidgets(); return; }
      if (v && v !== S.view && !C.chatApp) MP.showView(v);
    });
  }
  function failed(err) {
    document.body.classList.remove('is-loading');
    MP.toast(err.message || 'بارگذاری پنل انجام نشد.', { error: true, duration: 10000, action: 'تلاش دوباره', onAction: function () { location.reload(); } });
  }

  /*
   * «مربع چت» opens at once, like Telegram: from the copy of the last session kept on this device (the person,
   * the team, the chat list, projects), while the server's fresh answer loads behind it and replaces it.
   * The messages of the chat that opens come the same way (messages.js keeps a copy per chat).
   */
  function quick() {
    if (!C.chatApp || !MP.kv) return Promise.resolve(false);
    return Promise.all([MP.kv.get('api:bootstrap'), MP.kv.get('api:channels'), MP.kv.get('api:projects')]).then(function (c) {
      if (!c[0] || !c[0].me || !c[1] || !c[1].length) return false;
      MP.applyBoot(c[0]);
      S.channels = c[1];
      if (c[2]) MP.applyProjects(c[2]);
      return true;
    }, function () { return false; });
  }

  quick().then(function (fast) {
    if (!fast) { load().then(function () { begin(); MP.emit('booted'); }).catch(failed); return; }
    begin();
    load().then(function () {
      MP.emit('channels');
      if (MP.visible('messages') && MP.chatDesk && MP.chatDesk.folder) MP.chatDesk.folder(MP.chatDesk.folder());
      MP.emit('booted');
    }).catch(function (err) {
      // Signed out (or the account changed) since last time: start over at the sign-in page.
      var again = 0; try { again = +sessionStorage.getItem('mp_reboot') || 0; } catch (e) { /* private */ }
      if (err && (err.status === 401 || err.status === 403) && Date.now() - again > 60000) {
        try { sessionStorage.setItem('mp_reboot', String(Date.now())); } catch (e) { /* private */ }
        location.reload(); return;
      }
      MP.toast(err.message || 'اتصال به سایت برقرار نشد؛ نسخه ذخیره‌شده نمایش داده می‌شود.', { error: true });
    });
  });
})();
// The sign-in itself ended (cookie expired or signed out elsewhere): back to the sign-in page, once a minute at most.
window.MP.on('signedout', function () {
  var t = 0; try { t = +sessionStorage.getItem('mp_reboot') || 0; } catch (e) { /* private */ }
  if (Date.now() - t < 60000) return;
  try { sessionStorage.setItem('mp_reboot', String(Date.now())); } catch (e) { /* private */ }
  location.reload();
});
