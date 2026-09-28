/* Public client group: a customer reads and writes messages with only the private link. */
(function () {
  'use strict';
  var url = window.MP_CLIENT.url, lastId = 0, box = document.getElementById('chat-messages'), form = document.getElementById('client-form');
  var nameKey = 'mp-client-name';
  try { form.elements.name.value = localStorage.getItem(nameKey) || ''; } catch (e) { /* storage blocked */ }

  function when(mysql) {
    return String(mysql || '').slice(11, 16).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; });
  }
  function load(scroll) {
    return fetch(url + '?after=' + lastId, { credentials: 'omit' }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.message); return d; }); })
      .then(function (data) {
        document.getElementById('client-title').textContent = data.title;
        document.getElementById('client-sub').textContent = 'گفت‌وگوی ' + data.client + ' با تیم مربع';
        data.messages.forEach(function (m) {
          lastId = Math.max(lastId, m.id);
          var row = document.createElement('div'); row.className = 'bubble-row ' + (m.team ? 'other' : 'me');
          var b = document.createElement('div'); b.className = 'bubble';
          var who = document.createElement('span'); who.className = 'b-author'; who.textContent = m.author + (m.team ? ' (تیم مربع)' : '');
          b.append(who);
          if (m.file && /^audio\//.test(m.file.mime || '')) {
            var au = document.createElement('audio'); au.controls = true; au.preload = 'metadata'; au.src = m.file.url; au.className = 'b-audio'; b.append(au);
          } else if (m.file) {
            var a = document.createElement('a'); a.href = m.file.url; a.target = '_blank'; a.rel = 'noopener';
            if (m.file.image) { var img = document.createElement('img'); img.className = 'b-img'; img.src = m.file.url; img.alt = m.file.name; a.append(img); }
            else { a.className = 'file-chip'; a.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7"/></svg>'; a.append(document.createTextNode(m.file.name)); }
            b.append(a);
          }
          if (m.body) { var p = document.createElement('p'); p.textContent = m.body; b.append(p); }
          var t = document.createElement('span'); t.className = 'b-meta'; t.textContent = when(m.created_at);
          b.append(t); row.append(b); box.append(row);
        });
        if (data.messages.length || scroll) box.scrollTop = box.scrollHeight;
      })
      .catch(function (err) {
        document.getElementById('client-title').textContent = err.message || 'این گروه در دسترس نیست.';
        form.hidden = true;
        clearInterval(timer);
      });
  }
  form.onsubmit = function (e) {
    e.preventDefault();
    var body = form.elements.message.value.trim(), name = form.elements.name.value.trim();
    if (!body) return;
    try { localStorage.setItem(nameKey, name); } catch (err) { /* ignore */ }
    form.elements.message.value = '';
    fetch(url, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: body, name: name }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.message); }); })
      .then(function () { return load(true); })
      .catch(function (err) { form.elements.message.value = body; alert(err.message || 'ارسال پیام انجام نشد.'); });
  };
  var timer = setInterval(function () { if (!document.hidden) load(false); }, 6000);
  load(true);
})();
