/* Jalali (Solar Hijri) ⇄ Gregorian conversion — the Borkowski algorithm used by jalaali-js. */
(function (root) {
  'use strict';
  var breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  function div(a, b) { return ~~(a / b); }
  function mod(a, b) { return a - ~~(a / b) * b; }

  function jalCal(jy) {
    var bl = breaks.length, gy = jy + 621, leapJ = -14, jp = breaks[0], jm, jump = 0, leap, leapG, march, n, i;
    for (i = 1; i < bl; i += 1) {
      jm = breaks[i]; jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap: leap, gy: gy, march: march };
  }
  function g2d(gy, gm, gd) {
    var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
    return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  }
  function d2g(jdn) {
    var j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    var i = div(mod(j, 1461), 4) * 5 + 308;
    var gd = div(mod(i, 153), 5) + 1, gm = mod(div(i, 153), 12) + 1, gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy: gy, gm: gm, gd: gd };
  }
  function j2d(jy, jm, jd) {
    var r = jalCal(jy);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }
  function d2j(jdn) {
    var gy = d2g(jdn).gy, jy = gy - 621, r = jalCal(jy), jdn1f = g2d(gy, 3, r.march), jd, jm, k;
    k = jdn - jdn1f;
    if (k >= 0) {
      if (k <= 185) { jm = 1 + div(k, 31); jd = mod(k, 31) + 1; return { jy: jy, jm: jm, jd: jd }; }
      k -= 186;
    } else {
      jy -= 1; k += 179;
      if (r.leap === 1) k += 1;
    }
    jm = 7 + div(k, 30); jd = mod(k, 30) + 1;
    return { jy: jy, jm: jm, jd: jd };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  var J = {
    months: ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'],
    weekdays: ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'],
    /** 'YYYY-MM-DD' (Gregorian) → {jy, jm, jd} */
    fromIso: function (iso) {
      var p = String(iso).split('-').map(Number);
      return d2j(g2d(p[0], p[1], p[2]));
    },
    /** Jalali parts → 'YYYY-MM-DD' (Gregorian) */
    toIso: function (jy, jm, jd) {
      var g = d2g(j2d(jy, jm, jd));
      return g.gy + '-' + pad(g.gm) + '-' + pad(g.gd);
    },
    isLeap: function (jy) { return jalCal(jy).leap === 0; },
    monthLength: function (jy, jm) {
      if (jm <= 6) return 31;
      if (jm <= 11) return 30;
      return J.isLeap(jy) ? 30 : 29;
    },
    /** Weekday of a Gregorian ISO date with Saturday = 0. */
    weekday: function (iso) {
      var p = String(iso).split('-').map(Number);
      return (new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() + 1) % 7;
    },
    addDays: function (iso, n) {
      var p = String(iso).split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    },
    diffDays: function (a, b) {
      var pa = String(a).split('-').map(Number), pb = String(b).split('-').map(Number);
      return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
    },
    weekStart: function (iso) { return J.addDays(iso, -J.weekday(iso)); },
    fa: function (n) { return Number(n).toLocaleString('fa-IR', { useGrouping: false }); },
    faDigits: function (s) { return String(s).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); },
    latinDigits: function (s) { return String(s).replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }); },
    /** '۸ مهر ۱۴۰۵' */
    format: function (iso, withYear) {
      if (!iso) return '';
      var j = J.fromIso(iso);
      return J.fa(j.jd) + ' ' + J.months[j.jm - 1] + (withYear === false ? '' : ' ' + J.fa(j.jy));
    },
    /** 'چهارشنبه ۸ مهر ۱۴۰۵' */
    formatLong: function (iso) { return J.weekdays[J.weekday(iso)] + ' ' + J.format(iso); }
  };
  root.Jalali = J;
})(window);
