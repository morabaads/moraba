/* Photo viewer shared by the panel and the client portal: the photo large on top, the other photos as thumbnails
 * underneath (scroll sideways, tap one to bring it up). Needs no other script; uses MP.zoomable when the panel has it. */
(function () {
  'use strict';
  var SVG = {
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    right: '<path d="M9 6l6 6-6 6"/>'
  };
  function ico(n) { return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SVG[n] + '</svg>'; }
  function fa(n) { return String(n).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function mk(tag, cls, attrs) { var e = document.createElement(tag); if (cls) e.className = cls; for (var k in attrs || {}) if (attrs[k] != null) e.setAttribute(k, attrs[k]); return e; }

  /**
   * A row of thumbnails. items: [{ url, thumb?, video? }]. Returns { el, set(i) }: set marks one as current and
   * scrolls it into view; tapping one calls onPick(i).
   */
  function strip(items, onPick) {
    var row = mk('div', 'gv-strip', { role: 'listbox', 'aria-label': 'عکس‌ها' }), cells = [];
    items.forEach(function (it, i) {
      var b = mk('button', 'gv-th' + (it.video ? ' is-vid' : ''), { type: 'button', role: 'option', 'aria-label': 'عکس ' + fa(i + 1) });
      var src = it.thumb || (it.video ? it.poster : it.url);
      if (src) { var im = mk('img', null, { alt: '', loading: 'lazy', draggable: 'false' }); im.src = src; b.append(im); }
      b.addEventListener('click', function (e) { e.stopPropagation(); onPick(i); });
      cells.push(b); row.append(b);
    });
    // Dragging with the mouse scrolls the row too (touch scrolls it natively).
    var drag = null;
    row.addEventListener('pointerdown', function (e) { e.stopPropagation(); if (e.pointerType === 'mouse') drag = { x: e.clientX, s: row.scrollLeft, moved: false }; });
    row.addEventListener('pointermove', function (e) { if (!drag) return; var dx = e.clientX - drag.x; if (Math.abs(dx) > 4) drag.moved = true; row.scrollLeft = drag.s - dx; });
    row.addEventListener('pointerup', function (e) { e.stopPropagation(); setTimeout(function () { drag = null; }); });
    row.addEventListener('click', function (e) { if (drag && drag.moved) { e.stopPropagation(); e.preventDefault(); } }, true);
    return {
      el: row,
      set: function (i) {
        cells.forEach(function (c, n) { c.classList.toggle('on', n === i); c.setAttribute('aria-selected', String(n === i)); });
        var c = cells[i]; if (!c) return;
        var r = c.getBoundingClientRect(), rr = row.getBoundingClientRect();
        row.scrollTo({ left: row.scrollLeft + (r.left + r.width / 2) - (rr.left + rr.width / 2), behavior: row.dataset.ready ? 'smooth' : 'auto' });
        row.dataset.ready = '1';
      }
    };
  }

  /** Shares a photo: the file itself where the phone allows it, otherwise its link. */
  function share(it) {
    var link = new URL(it.url, location.href).href;
    if (window.MorabaApp && MorabaApp.share) { try { MorabaApp.share(link); return; } catch (e) { /* fall through */ } }
    if (!navigator.share) { if (navigator.clipboard) navigator.clipboard.writeText(link); return; }
    fetch(it.url, { credentials: 'same-origin' }).then(function (r) { return r.blob(); }).then(function (b) {
      var f = new File([b], it.name || 'photo.jpg', { type: b.type || 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) return navigator.share({ files: [f] });
      return navigator.share({ url: link });
    }).catch(function () { navigator.share({ url: link }).catch(function () {}); });
  }

  /** Full-screen viewer. items: [{ url, mid?, thumb?, name?, video?, poster?, caption? }]; start: index. */
  function open(items, start) {
    if (!items || !items.length) return;
    var i = Math.max(0, Math.min(items.length - 1, start || 0)), vid = null;
    var v = mk('div', 'gv gv-simple', { role: 'dialog', 'aria-label': 'عکس‌ها' });
    var top = mk('div', 'gv-top'), x = mk('button', 'icon-btn gv-btn', { type: 'button', 'aria-label': 'بستن' }), sh = mk('button', 'icon-btn gv-btn', { type: 'button', 'aria-label': 'اشتراک‌گذاری' });
    var dl = mk('a', 'icon-btn gv-btn', { 'aria-label': 'دانلود', target: '_blank', rel: 'noopener' });
    x.innerHTML = ico('close'); sh.innerHTML = ico('share'); dl.innerHTML = ico('download');
    top.append(x, sh, mk('span', 'gv-sp'), dl);
    // The counter sits on the photo's corner, so the photo and the counter share a frame.
    var stage = mk('div', 'gv-stage'), frame = mk('div', 'gv-frame'), img = mk('img', null, { alt: '', draggable: 'false' }), n = mk('span', 'gv-n gv-badge');
    frame.append(img, n); stage.append(frame);
    var next = mk('button', 'gv-nav gv-next', { type: 'button', 'aria-label': 'بعدی' }), prev = mk('button', 'gv-nav gv-prev', { type: 'button', 'aria-label': 'قبلی' });
    next.innerHTML = ico('left'); prev.innerHTML = ico('right');
    var cap = mk('div', 'gv-cap');
    var st = strip(items, function (k) { i = k; show(); });
    v.append(top, prev, next, stage, cap);
    if (items.length > 1) v.append(st.el); else v.classList.add('gv-one');
    var z = window.MP && MP.zoomable ? MP.zoomable(img, stage) : { reset: function () {}, zoomed: function () { return false; }, touched: function () { return false; } };

    function show() {
      var it = items[i]; z.reset();
      if (vid) { vid.pause(); vid.remove(); vid = null; }
      if (it.video) {
        img.hidden = true;
        vid = mk('video', 'gv-video', { controls: '', autoplay: '', playsinline: '', poster: it.poster || null }); vid.src = it.url; frame.insertBefore(vid, n);
      } else {
        img.hidden = false;
        if (it.mid) { img.src = it.mid; var full = new Image(); full.onload = function () { if (items[i] === it) img.src = it.url; }; full.src = it.url; } else img.src = it.url;
      }
      n.textContent = fa(i + 1) + ' از ' + fa(items.length); n.hidden = items.length < 2;
      cap.replaceChildren(); cap.hidden = !it.caption && !it.name;
      if (it.caption) { var p = mk('p', null, { dir: 'auto' }); p.textContent = it.caption; cap.append(p); } else if (it.name) { var s = mk('small', null, { dir: 'auto' }); s.textContent = it.name; cap.append(s); }
      dl.href = it.url + (it.url.indexOf('?') >= 0 ? '&' : '?') + 'download=1';
      prev.hidden = i === 0; next.hidden = i === items.length - 1;
      st.set(i);
    }
    function go(d) { var k = i + d; if (k < 0 || k >= items.length) return; i = k; show(); }
    function key(e) { if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') go(1); else if (e.key === 'ArrowRight') go(-1); }
    var sx = null;
    v.addEventListener('pointerdown', function (e) { sx = z.zoomed() || e.target.closest('button, a') ? null : { x: e.clientX, y: e.clientY }; });
    v.addEventListener('pointerup', function (e) { if (!sx) return; var dx = e.clientX - sx.x, dy = e.clientY - sx.y; sx = null; if (z.touched()) return; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1); else if (dy > 120) close(); });
    x.onclick = function () { close(); }; sh.onclick = function () { share(items[i]); };
    next.onclick = function () { go(1); }; prev.onclick = function () { go(-1); };
    // The phone's back button closes the viewer.
    var layer = window.MP && MP.pushLayer ? MP.pushLayer(function () { layer = null; close(); }) : null;
    var hist = false;
    if (!layer && window.history && history.pushState) { try { history.pushState({ gv: 1 }, ''); hist = true; } catch (e) { /* ignore */ } }
    function onPop() { hist = false; close(); }
    if (hist) window.addEventListener('popstate', onPop);
    var closed = false;
    function close() {
      if (closed) return; closed = true;
      if (vid) vid.pause();
      document.removeEventListener('keydown', key); window.removeEventListener('popstate', onPop);
      v.classList.add('out'); setTimeout(function () { v.remove(); }, 160);
      if (layer) { var l = layer; layer = null; MP.popLayer(l); }
      if (hist) { hist = false; history.back(); }
    }
    document.addEventListener('keydown', key);
    document.body.append(v); show();
    return { close: close };
  }

  window.MPViewer = { open: open, strip: strip, share: share };
})();
