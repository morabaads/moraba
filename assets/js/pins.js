/*
 * Design review with pins, shared by the client portal and the panel.
 * MPPins.mount(box, item, opts) draws the image with numbered pins and the comment threads beside it.
 * Clicking the image opens a small note box at that point.
 * opts: { team: bool, name: () => string, post(body) → Promise<item>, resolve(pinId) → Promise<item> }
 */
(function () {
  'use strict';
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.append(c); });
    return n;
  }
  function fa(n) { return String(n).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function time(s) { return fa(String(s || '').slice(11, 16)); }

  function mount(box, item, opts) {
    var active = 0, draft = null;
    box.classList.add('pins-view');
    function draw() {
      box.replaceChildren();
      var roots = item.pins.filter(function (p) { return !p.parent_id; });
      var num = {}; roots.forEach(function (p, i) { num[p.id] = i + 1; });
      var stage = h('div', { class: 'pins-stage' });
      var img = h('img', { src: item.file.url, alt: item.title, draggable: 'false' });
      stage.append(img);
      roots.forEach(function (p) {
        stage.append(h('button', { type: 'button', class: 'pin' + (p.resolved ? ' done' : '') + (p.team ? ' team' : '') + (active === p.id ? ' on' : ''), style: 'left:' + p.x + '%;top:' + p.y + '%', text: fa(num[p.id]), title: p.body, onclick: function (e) { e.stopPropagation(); active = p.id; draft = null; draw(); var t = box.querySelector('[data-thread="' + p.id + '"]'); if (t) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }));
      });
      if (draft) {
        stage.append(h('span', { class: 'pin new', style: 'left:' + draft.x + '%;top:' + draft.y + '%', text: '+' }));
        var ta = h('textarea', { rows: 3, maxlength: 1000, placeholder: 'نظرتان درباره این قسمت…' });
        var pop = h('form', { class: 'pin-pop', style: 'left:' + Math.min(Math.max(draft.x, 18), 82) + '%;top:' + draft.y + '%' + (draft.y > 60 ? ';transform:translate(-50%,calc(-100% - 18px))' : '') }, [
          ta, h('div', { class: 'pin-pop-actions' }, [h('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'ثبت نظر' }), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'انصراف', onclick: function (e) { e.stopPropagation(); draft = null; draw(); } })])]);
        pop.addEventListener('click', function (e) { e.stopPropagation(); });
        pop.onsubmit = function (e) {
          e.preventDefault(); if (!ta.value.trim()) return;
          pop.querySelector('[type=submit]').disabled = true;
          opts.post({ x: draft.x, y: draft.y, body: ta.value.trim(), name: opts.name ? opts.name() : '' }).then(function (it) { item = it; draft = null; active = 0; draw(); }).catch(function (err) { pop.querySelector('[type=submit]').disabled = false; alert(err.message || 'ثبت نشد'); });
        };
        stage.append(pop);
        setTimeout(function () { ta.focus(); }, 30);
      }
      stage.addEventListener('click', function (e) {
        var r = img.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
        draft = { x: Math.round((e.clientX - r.left) / r.width * 1000) / 10, y: Math.round((e.clientY - r.top) / r.height * 1000) / 10 };
        active = 0; draw();
      });

      var side = h('aside', { class: 'pins-side' });
      side.append(h('p', { class: 'pins-hint', text: roots.length ? 'روی هر قسمت طرح کلیک کنید تا نظر جدید بگذارید.' : 'برای نظر دادن، روی همان قسمتی از طرح که منظورتان است کلیک کنید.' }));
      roots.slice().sort(function (a, b) { return a.resolved - b.resolved; }).forEach(function (p) {
        var replies = item.pins.filter(function (x) { return x.parent_id === p.id; });
        var reply = h('form', { class: 'pin-reply' }, [h('input', { placeholder: 'پاسخ…', maxlength: 1000 }), h('button', { type: 'submit', class: 'btn btn-ghost btn-sm', text: 'ارسال' })]);
        reply.onsubmit = function (e) {
          e.preventDefault(); var i = reply.querySelector('input'); if (!i.value.trim()) return;
          opts.post({ parent_id: p.id, body: i.value.trim(), name: opts.name ? opts.name() : '' }).then(function (it) { item = it; active = p.id; draw(); }).catch(function (err) { alert(err.message || 'ثبت نشد'); });
        };
        side.append(h('article', { class: 'pin-thread' + (active === p.id ? ' on' : '') + (p.resolved ? ' done' : ''), 'data-thread': p.id, onclick: function () { if (active !== p.id) { active = p.id; draw(); } } }, [
          h('div', { class: 'pin-head' }, [h('b', { class: 'pin-no', text: fa(num[p.id]) }), h('strong', { text: p.author + (p.team ? ' · تیم' : '') }), h('small', { text: time(p.created_at) }),
            opts.team && opts.resolve ? h('button', { type: 'button', class: 'pin-resolve', text: p.resolved ? 'باز کردن' : 'انجام شد ✓', onclick: function (e) { e.stopPropagation(); opts.resolve(p.id).then(function (it) { item = it; draw(); }); } }) : (p.resolved ? h('small', { class: 'pin-ok', text: 'انجام شد' }) : null)]),
          h('p', { text: p.body })
        ].concat(replies.map(function (r) { return h('div', { class: 'pin-rep' + (r.team ? ' team' : '') }, [h('strong', { text: r.author + (r.team ? ' · تیم' : '') }), h('p', { text: r.body })]); })).concat([reply])));
      });
      box.append(h('div', { class: 'pins-wrap' }, [stage, side]));
    }
    draw();
    return { update: function (it) { item = it; draw(); } };
  }
  window.MPPins = { mount: mount };
})();
