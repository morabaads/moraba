/* Boot: load everything once, pick the start page from the URL hash, then keep counts fresh. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S;

  MP.api('bootstrap').then(function (boot) {
    MP.applyBoot(boot);
    return Promise.all([
      MP.loadTasks(), MP.loadProjects(), MP.loadMeetings(), MP.loadAttendance(),
      MP.api('channels').then(function (l) { S.channels = l; }),
      MP.api('reminders').then(function (l) { S.reminders = l; }),
      MP.api('leaves', { query: { scope: 'mine' } }).then(function (l) { S.leaves = l; }),
      MP.api('notifications').then(function (l) { S.notifications = l; MP.renderNotifications(); })
    ]);
  }).then(function () {
    document.body.classList.remove('is-loading');
    var start = (location.hash || '').slice(1);
    // Home-screen shortcuts (manifest): #new-task, #punch.
    if (start === 'new-task') { MP.showView('dashboard'); setTimeout(function () { MP.taskForm(); }, 300); }
    else if (start === 'widgets') { MP.showView('dashboard'); setTimeout(MP.openWidgets, 300); }
    else if (/^task-\d+$/.test(start)) { MP.showView('mytasks'); setTimeout(function () { MP.openTask(+start.slice(5)); }, 300); }
    else if (start === 'punch') { MP.showView('attendance'); setTimeout(function () { var c = document.getElementById('punch-chip'); if (c) c.click(); }, 300); }
    else MP.showView(start || 'dashboard');
    MP.renderPrompts();
    setInterval(function () { if (!document.hidden) MP.refreshCounts(); }, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) MP.refreshCounts(); });
    window.addEventListener('hashchange', function () {
      var v = location.hash.slice(1);
      if (/^task-\d+$/.test(v)) { MP.openTask(+v.slice(5)); return; }
      if (v === 'widgets') { MP.openWidgets(); return; }
      if (v && v !== S.view) MP.showView(v);
    });
  }).catch(function (err) {
    document.body.classList.remove('is-loading');
    MP.toast(err.message || 'بارگذاری پنل انجام نشد.', { error: true, duration: 10000, action: 'تلاش دوباره', onAction: function () { location.reload(); } });
  });
})();
