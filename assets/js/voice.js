/*
 * Smart input: speak (or type) one Persian sentence and the form fills itself.
 *   «۱۳۰ تومن برای افزونه برای پروژه زیوا»        → expense 130,000 · title «افزونه» · project زیوا
 *   «فردا ساعت ۱۱ باید کار فلان تحویل داده شود»      → reminder tomorrow 11:00 · title «کار فلان تحویل داده شود»
 * Parsing runs in the browser; speech recognition uses the browser's own engine (Chrome/Safari).
 * Works in Node too (for tests): module.exports = the parser.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------ Numbers */

  var ONES = { 'صفر': 0, 'یک': 1, 'یه': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'چار': 4, 'پنج': 5, 'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9,
    'ده': 10, 'یازده': 11, 'دوازده': 12, 'سیزده': 13, 'چهارده': 14, 'پانزده': 15, 'پونزده': 15, 'شانزده': 16, 'شونزده': 16, 'هفده': 17, 'هیفده': 17, 'هجده': 18, 'هیجده': 18, 'نوزده': 19,
    'بیست': 20, 'سی': 30, 'چهل': 40, 'پنجاه': 50, 'شصت': 60, 'هفتاد': 70, 'هشتاد': 80, 'نود': 90,
    'صد': 100, 'یکصد': 100, 'دویست': 200, 'سیصد': 300, 'چهارصد': 400, 'پانصد': 500, 'پونصد': 500, 'ششصد': 600, 'شیشصد': 600, 'هفتصد': 700, 'هشتصد': 800, 'نهصد': 900 };
  var SCALES = { 'هزار': 1e3, 'تومنی': 0, 'میلیون': 1e6, 'ملیون': 1e6, 'میلیارد': 1e9, 'ملیارد': 1e9 };
  delete SCALES['تومنی'];
  var ORDINAL = { 'اول': 1, 'یکم': 1, 'دوم': 2, 'سوم': 3, 'سیم': 3 };
  var MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  var DAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سهشنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

  function latin(s) {
    return String(s).replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); });
  }
  /** Canonical text: Latin digits, Persian ی/ک, no ZWNJ inside weekday names, single spaces. */
  function normalize(s) {
    return latin(s).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[،,؛]/g, function (c, i, str) {
      return /\d/.test(str[i - 1] || '') && /\d/.test(str[i + 1] || '') ? '' : ' ';
    }).replace(/(\d)٫(\d)/g, '$1.$2')
      .replace(/(یک|دو|سه|چهار|پنج)[\s‌]+شنبه/g, '$1شنبه').replace(/\s*‌\s*/g, '‌')
      .replace(/(\d)([^\d\s.:\/])/g, '$1 $2').replace(/([^\d\s.:\/])(\d)/g, '$1 $2')
      .replace(/\s+/g, ' ').trim();
  }
  function wordValue(w) {
    if (/^\d+(\.\d+)?$/.test(w)) return parseFloat(w);
    if (Object.prototype.hasOwnProperty.call(ONES, w)) return ONES[w];
    return null;
  }
  /** Ordinal day like «پنجم», «بیست و پنجم», «۵ام», «سوم». */
  function ordinalValue(w) {
    if (ORDINAL[w]) return ORDINAL[w];
    var m = w.match(/^(.+?)(ام|م|مین)$/);
    if (m) { var v = wordValue(m[1]); if (v !== null) return v; }
    return null;
  }

  /**
   * Reads number runs from a token list: «دو میلیون و پونصد», «۱.۵ میلیون», «۱۳۰ هزار», «یک و نیم».
   * Returns [{start, end, value, scaled}] with token indexes (end exclusive).
   */
  function numberRuns(tokens) {
    var runs = [], i = 0;
    while (i < tokens.length) {
      if (wordValue(tokens[i]) === null && !SCALES[tokens[i]]) { i++; continue; }
      var start = i, total = 0, cur = 0, lastScale = 0, scaled = false, any = false;
      for (; i < tokens.length; i++) {
        var t = tokens[i], v = wordValue(t);
        if (v !== null) { if (cur && v >= cur && cur % 1000 !== 0 && v >= 10 && !(cur >= 100 && v < 100)) break; cur += v; any = true; continue; }
        if (SCALES[t]) { cur = (cur || 1) * SCALES[t]; total += cur; lastScale = SCALES[t]; cur = 0; scaled = true; any = true; continue; }
        if (t === 'نیم' && any) { if (!cur && lastScale) total += lastScale / 2; else cur += 0.5; continue; }
        if (t === 'و' && i + 1 < tokens.length && (wordValue(tokens[i + 1]) !== null || tokens[i + 1] === 'نیم' || SCALES[tokens[i + 1]])) continue;
        break;
      }
      if (any) runs.push({ start: start, end: i, value: total + cur, scaled: scaled });
      if (i === start) i++;
    }
    return runs;
  }

  /* ------------------------------------------------------------ Dates & times */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * Finds a date phrase. ctx: {today (ISO), J (Jalali helpers), future (bool)}.
   * Returns {iso, remove: [regex source strings]} or null.
   */
  function findDate(text, ctx) {
    var J = ctx.J, today = ctx.today, m;
    var rel = [[/پس[ ‌]?فردا/, 2], [/پریروز/, -2], [/فردا/, 1], [/دیروز/, -1], [/امروز|امشب/, 0]];
    for (var k = 0; k < rel.length; k++) {
      m = text.match(rel[k][0]);
      if (m) return { iso: J.addDays(today, rel[k][1]), phrase: m[0] };
    }
    m = text.match(/(\d+|[^\s]+) روز (دیگه|دیگر|بعد)/);
    if (m && wordValue(m[1]) !== null) return { iso: J.addDays(today, wordValue(m[1])), phrase: m[0] };
    m = text.match(/(هفته|ماه) (بعد|دیگه|دیگر|آینده)/);
    if (m) return { iso: m[1] === 'هفته' ? J.addDays(today, 7) : J.addDays(today, 30), phrase: m[0] };
    // «۵ مهر», «پنجم مهر», «۲۵ ام آبان ۱۴۰۵», «بیست و پنجم آذر»
    var monthRe = new RegExp('((?:[^\\s]+ و )?[^\\s]+) (' + MONTHS.join('|') + ')(?: (\\d{4}))?');
    m = text.match(monthRe);
    if (m) {
      var dayWords = m[1].split(' و '), day = 0;
      dayWords.forEach(function (w) { var v = ordinalValue(w); if (v === null) v = wordValue(w.replace(/ام$/, '')); day += v || 0; });
      if (day >= 1 && day <= 31) {
        var t = J.fromIso(today), jm = MONTHS.indexOf(m[2]) + 1, jy = m[3] ? +m[3] : t.jy;
        if (!m[3] && ctx.future && (jm < t.jm || (jm === t.jm && day < t.jd))) jy++;
        return { iso: J.toIso(jy, jm, Math.min(day, J.monthLength(jy, jm))), phrase: m[0] };
      }
    }
    // Weekday: «شنبه», «پنجشنبه بعد»; next occurrence (today counts unless «بعد/آینده»).
    for (var d = DAYS.length - 1; d >= 0; d--) {
      var re = new RegExp('(?:^|\\s)(' + DAYS[d] + ')( (?:بعد|آینده|دیگه|دیگر))?(?=\\s|$)');
      m = text.match(re);
      if (m) {
        var diff = (d - J.weekday(today) + 7) % 7;
        if (m[2] || (diff === 0 && ctx.future && m[2])) diff = diff || 7;
        return { iso: J.addDays(today, diff), phrase: m[0].trim() };
      }
    }
    return null;
  }

  /** «ساعت ۱۱», «۱۱ و نیم», «ساعت ۳ و ربع بعدازظهر», «۱۷:۴۵», «۸ صبح», «ساعت دو و بیست دقیقه». */
  function findTime(text) {
    var m = text.match(/(?:ساعت )?(\d{1,2}):(\d{2})/), h, min = 0, phrase;
    if (m) { h = +m[1]; min = +m[2]; phrase = m[0]; }
    else {
      m = text.match(/(ساعت )?([^\s]+)( و (نیم|ربع|[^\s]+)( دقیقه)?)?( (صبح|ظهر|بعد[ ‌]?از[ ‌]?ظهر|عصر|شب|نصف[ ‌]?شب|نیمه[ ‌]?شب))?/g) || [];
      for (var i = 0; i < m.length; i++) {
        var p = m[i].match(/^(ساعت )?([^\s]+)(?: و (نیم|ربع|[^\s]+)(?: دقیقه)?)?(?: (صبح|ظهر|بعد[ ‌]?از[ ‌]?ظهر|عصر|شب|نصف[ ‌]?شب|نیمه[ ‌]?شب))?$/);
        if (!p) continue;
        var hv = wordValue(p[2]);
        if (hv === null || hv > 24 || hv % 1) continue;
        if (!p[1] && !p[4]) continue; // a bare number is not a time
        h = hv; phrase = m[i];
        if (p[3]) min = p[3] === 'نیم' ? 30 : p[3] === 'ربع' ? 15 : (wordValue(p[3]) || 0);
        if (min > 59) { min = 0; phrase = (p[1] || '') + p[2]; }
        var period = p[4] || '';
        if (/بعد[ ‌]?از[ ‌]?ظهر|عصر/.test(period) && h < 12) h += 12;
        else if (/نصف|نیمه/.test(period)) h = h === 12 ? 0 : h;
        else if (period === 'شب') h = h === 12 ? 0 : (h >= 6 && h < 12 ? h + 12 : h);
        else if (period === 'ظهر') h = h <= 3 ? h + 12 : h;
        else if (!period && h >= 1 && h <= 6) h += 12; // office hours: «ساعت ۳» means 15:00
        break;
      }
    }
    if (h === undefined || h > 24) return null;
    return { time: pad(h % 24) + ':' + pad(min), phrase: phrase };
  }

  function cleanup(text, phrases, fillers) {
    phrases.forEach(function (p) { if (p) text = text.replace(p, ' '); });
    var words = text.replace(/\s+/g, ' ').trim().split(' ');
    // trim filler words at both ends («برای», «بابت», «که», «باید» …)
    while (words.length && fillers.indexOf(words[0]) >= 0) words.shift();
    while (words.length && fillers.indexOf(words[words.length - 1]) >= 0) words.pop();
    return words.join(' ').replace(/\s+([.,،!؟?])/g, '$1').trim();
  }

  /* ------------------------------------------------------------ Money */

  var EXPENSE = /(خرج|هزینه|پرداخت(?! شد به ما)|پرداختی|خرید|خریدم|خریدیم|دادم|دادیم|قسط|واریز کردم|واریز کردیم|بدهی)/;
  var INCOME = /(دخل|درآمد|دریافت|دریافتی|گرفتم|گرفتیم|واریزی|فروش|فروختم|فروختیم|پیش[ ‌]?پرداخت گرفت|تسویه کرد|واریز شد|پول اومد|پول آمد)/;
  var CATEGORY_HINTS = [
    [/هاست|دامنه|سرور|افزونه|پلاگین|قالب|لایسنس|اشتراک|نرم[ ‌]?افزار|اپ/, 'نرم‌افزار و سرویس'],
    [/اجاره/, 'اجاره'], [/حقوق|دستمزد|پاداش/, 'حقوق'],
    [/ناهار|نهار|شام|غذا|پذیرایی|قهوه|چای|شیرینی/, 'پذیرایی'],
    [/تاکسی|اسنپ|تپسی|بنزین|کرایه|پیک/, 'رفت‌وآمد'],
    [/تبلیغ|تبلیغات|کمپین/, 'تبلیغات'],
    [/قبض|برق|گاز|اینترنت|تلفن|شارژ/, 'قبوض'],
    [/لوازم|تجهیزات|کامپیوتر|لپ[ ‌]?تاپ|مانیتور|ماوس|کیبورد/, 'تجهیزات']
  ];
  var MONEY_FILLERS = ['برای', 'بابت', 'به', 'مبلغ', 'از', 'و', 'که', 'رو', 'را', 'یه', 'یک', 'تومن', 'تومان', 'ریال', 'پروژه', 'در', 'با'];

  /**
   * ctx: {today, J, projects: [{id,name}], categories: [string]}
   * → {amount, type, title, project_id, category, date, time, found: [field names]}
   */
  function parseMoney(input, ctx) {
    var text = normalize(input), out = { found: [] }, remove = [];
    var tokens = text.split(' '), runs = numberRuns(tokens);

    // Date/time first so «ساعت ۵» or «۵ مهر» is never taken as the amount.
    var date = findDate(text, ctx), time = findTime(text);
    if (date) { out.date = date.iso; out.found.push('date'); remove.push(date.phrase); }
    if (time) { out.time = time.time; out.found.push('time'); remove.push(time.phrase); }
    var taken = (date ? date.phrase : '') + ' ' + (time ? time.phrase : '');

    var best = null;
    runs.forEach(function (r) {
      var phrase = tokens.slice(r.start, r.end).join(' ');
      if (taken.indexOf(phrase) >= 0 && !r.scaled) return;
      var unit = tokens[r.end] || '', v = r.value;
      if (/^ریال$/.test(unit)) v = Math.round(v / 10);
      else if (!r.scaled && v < 1000) v = v * 1000; // «۱۳۰ تومن» in speech means 130,000 toman
      var score = v + (/^(تومن|تومان|ریال)$/.test(unit) ? 1e12 : 0) + (r.scaled ? 1e11 : 0);
      if (!best || score > best.score) best = { v: v, score: score, phrase: phrase + (/^(تومن|تومان|ریال)$/.test(unit) ? ' ' + unit : '') };
    });
    if (best && best.v > 0) { out.amount = Math.round(best.v); out.found.push('amount'); remove.push(best.phrase); }

    if (INCOME.test(text)) out.type = 'income';
    else out.type = 'expense';
    out.found.push('type');
    var typeWord = text.match(out.type === 'income' ? INCOME : EXPENSE);
    if (typeWord) remove.push(new RegExp('(^|\\s)' + typeWord[0] + '(?=\\s|$)'));

    // Project: the longest project name that appears in the sentence.
    var lower = text;
    (ctx.projects || []).slice().sort(function (a, b) { return b.name.length - a.name.length; }).some(function (p) {
      var name = normalize(p.name);
      if (name && lower.indexOf(name) >= 0) {
        out.project_id = p.id; out.found.push('project');
        remove.push(new RegExp('(برای |بابت |از |در )?(پروژه(ی)? )?' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        return true;
      }
      return false;
    });

    // Category: an existing category named in the sentence, else a keyword hint.
    // Look for categories outside the project phrase, so «پروژه زیوا» never picks a category called «پروژه».
    var rest = lower;
    remove.forEach(function (r) { rest = rest.replace(r, ' '); });
    (ctx.categories || []).some(function (c) { var n = normalize(c); if (n && new RegExp('(^|\\s)' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)').test(rest)) { out.category = c; return true; } return false; });
    if (!out.category) CATEGORY_HINTS.some(function (h) { if (h[0].test(lower)) { out.category = h[1]; return true; } return false; });
    if (out.category) out.found.push('category');

    out.title = cleanup(text, remove, MONEY_FILLERS);
    if (out.title) out.found.push('title');
    return out;
  }

  /* ------------------------------------------------------------ Reminders */

  var REMIND_FILLERS = ['یادم', 'بنداز', 'بیار', 'یادآوری', 'کن', 'که', 'باید', 'رو', 'را', 'به', 'من', 'لطفا', 'لطفاً', 'برای', 'در', 'تا'];

  /** ctx: {today, J} → {title, date, time, repeat, found} */
  function parseReminder(input, ctx) {
    var text = normalize(input), out = { found: [] }, remove = [];
    text = text.replace(/^(یادم (بنداز|بیار)|یادآوری کن|یادآوری)\s*/, '');
    var rep = text.match(/هر روز|روزانه|هر هفته|هفتگی|هر ماه|ماهانه|هر (شنبه|یکشنبه|دوشنبه|سهشنبه|چهارشنبه|پنجشنبه|جمعه)/);
    if (rep) {
      out.repeat = /روز/.test(rep[0]) && !/شنبه|جمعه/.test(rep[0]) ? 'daily' : /ماه/.test(rep[0]) ? 'monthly' : 'weekly';
      out.found.push('repeat');
      if (!rep[1]) remove.push(rep[0]); else remove.push('هر ');
    }
    var date = findDate(text, { today: ctx.today, J: ctx.J, future: true }), time = findTime(text);
    if (date) { out.date = date.iso; out.found.push('date'); remove.push(date.phrase); }
    if (time) { out.time = time.time; out.found.push('time'); remove.push(time.phrase); }
    // A time already passed today with no date given means tomorrow.
    if (time && !date && ctx.now && time.time <= ctx.now) { out.date = ctx.J.addDays(ctx.today, 1); out.found.push('date'); }
    out.title = cleanup(text, remove, REMIND_FILLERS) || normalize(input);
    out.found.push('title');
    return out;
  }

  /* ------------------------------------------------------------ Tasks (supervisor batches) */

  var TASK_FILLERS = ['برای', 'تسک', 'تسکهای', 'تسک‌های', 'کار', 'کارهای', 'اضافه', 'کن', 'کنید', 'بشه', 'بشود', 'شود', 'بذار', 'بزار', 'بگذار', 'بده', 'بدید', 'تعریف', 'انجام', 'بدن', 'روز', 'روزهای', 'روزای', 'در', 'به', 'را', 'رو', 'که', 'باید', 'هم', 'همچنین', 'این', 'اینها', 'اینا', 'ها', 'تا', 'و', 'از', 'یک', 'یه', 'میخوام', 'می‌خوام', 'لطفا', 'لطفاً', 'ساعت', 'پروژه', 'پروژهٔ', 'پروژه‌ی'];
  var CUT = '\u0001';

  /** Every date phrase in a segment: ranges, «کل هفته», lists of weekdays, relative days, Jalali dates. */
  function allDates(text, ctx) {
    var J = ctx.J, today = ctx.today, dates = [], m;
    function add(iso) { if (dates.indexOf(iso) < 0) dates.push(iso); }
    function dayIndex(w) { return DAYS.indexOf(w); }
    function next(d, strict) { var diff = (d - J.weekday(today) + 7) % 7; if (strict && !diff) diff = 7; return J.addDays(today, diff); }
    // «از شنبه تا چهارشنبه»
    var rangeRe = new RegExp('از (' + DAYS.join('|') + ') تا (' + DAYS.join('|') + ')( (?:هفته )?(?:بعد|آینده))?');
    m = text.match(rangeRe);
    if (m) {
      var shift = m[3] ? 7 : 0, a = J.addDays(next(dayIndex(m[1])), shift), n = (dayIndex(m[2]) - dayIndex(m[1]) + 7) % 7;
      for (var i = 0; i <= n; i++) add(J.addDays(a, i));
      text = text.replace(m[0], CUT);
    }
    // «کل هفته / هر روز این هفته / تمام هفته» → the rest of this week without Friday
    m = text.match(/(کل|تمام|همه) (روزهای )?(این )?هفته|هر روز این هفته|هر روز تا آخر هفته/);
    if (m) {
      for (var d = J.weekday(today); d <= 5; d++) add(J.addDays(today, d - J.weekday(today)));
      text = text.replace(m[0], CUT);
    }
    // «هفته بعد شنبه و دوشنبه» → weekday list shifted a week
    var weekShift = /هفته (بعد|آینده|دیگه|دیگر)/.test(text) ? 7 : 0;
    if (weekShift) text = text.replace(/هفته (بعد|آینده|دیگه|دیگر)/, CUT);
    var dayRe = new RegExp('(^|[\\s' + CUT + '])(' + DAYS.join('|') + ')(?= |$|' + CUT + ')', 'g');
    var found = [];
    text = text.replace(dayRe, function (all, pre, w) { found.push(w); return pre + CUT; });
    found.forEach(function (w) { add(J.addDays(next(dayIndex(w)), weekShift)); });
    // relative days and Jalali dates, repeatedly
    for (var guard = 0; guard < 10; guard++) {
      var one = findDate(text, { today: today, J: J, future: true });
      if (!one) break;
      add(one.iso); text = text.replace(one.phrase, CUT);
    }
    dates.sort();
    return { dates: dates, text: text };
  }

  /** Splits one chunk into several task titles on commas and on «و» between two multi-word parts. */
  function splitTitles(chunk) {
    var out = [];
    chunk.split(/[،,؛]| و بعد | و همچنین | همچنین | بعدش /).forEach(function (part) {
      var pieces = part.split(' و '), cur = pieces[0];
      for (var i = 1; i < pieces.length; i++) {
        if (cur.trim().split(' ').length >= 2 && pieces[i].trim().split(' ').length >= 2) { out.push(cur); cur = pieces[i]; }
        else cur += ' و ' + pieces[i];
      }
      out.push(cur);
    });
    return out.map(function (t) {
      var w = t.replace(/\s+/g, ' ').trim().split(' ');
      while (w.length && TASK_FILLERS.indexOf(w[0]) >= 0) w.shift();
      while (w.length && TASK_FILLERS.indexOf(w[w.length - 1]) >= 0) w.pop();
      return w.join(' ');
    }).filter(function (t) { return t.length > 1; });
  }

  /**
   * «برای علی طراحی بنر و ارسال فاکتور شنبه و دوشنبه ساعت ۱۰، برای رضا تماس با مشتری فردا، مهدی گزارش هفتگی پنجشنبه فوری»
   * ctx: {today, J, users: [{id, name}], me, projects}
   * → [{user_ids, tasks: [title], dates: [iso], time, priority, project_id, warnings: []}]
   */
  function parseTasks(input, ctx) {
    var text = normalize(input), users = ctx.users || [];
    // Name needles: full name, first name, last name; longest first. Shared first names are ambiguous.
    var needles = [], firstCount = {};
    users.forEach(function (u) { var f = normalize(u.name).split(' ')[0]; firstCount[f] = (firstCount[f] || 0) + 1; });
    users.forEach(function (u) {
      var full = normalize(u.name), parts = full.split(' ');
      needles.push({ s: full, id: u.id, exact: true });
      if (parts.length > 1) {
        needles.push({ s: parts[0], id: u.id, ambiguous: firstCount[parts[0]] > 1 });
        needles.push({ s: parts.slice(1).join(' '), id: u.id });
      }
    });
    needles.push({ s: 'خودم', id: ctx.me, exact: true });
    needles.sort(function (a, b) { return b.s.length - a.s.length; });
    // Find mentions (non-overlapping, word-bounded).
    var mentions = [], taken = [];
    needles.forEach(function (n) {
      if (!n.s) return;
      var re = new RegExp('(^|\\s)(' + n.s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?=\\s|$|[،,])', 'g'), m;
      while ((m = re.exec(text))) {
        var start = m.index + m[1].length, end = start + m[2].length;
        if (taken.some(function (t) { return start < t[1] && end > t[0]; })) continue;
        taken.push([start, end]); mentions.push({ start: start, end: end, id: n.id, ambiguous: n.ambiguous, name: m[2] });
      }
    });
    var all = /(^|\s)(همه|همه اعضا|همه‌ی اعضا|همه همکاران|کل تیم)(?=\s|$)/.exec(text);
    if (all) mentions.push({ start: all.index + all[1].length, end: all.index + all[0].length, ids: users.map(function (u) { return u.id; }).filter(function (id) { return id !== ctx.me; }), name: all[2] });
    mentions.sort(function (a, b) { return a.start - b.start; });
    // Merge «علی و رضا» into one group.
    var groups = [];
    mentions.forEach(function (m) {
      var last = groups[groups.length - 1];
      var between = last ? text.slice(last.end, m.start) : null;
      if (last && /^[\s،,]*(و|،|,)?[\s،,]*(برای\s*)?$/.test(between)) { last.end = m.end; last.list.push(m); }
      else groups.push({ start: m.start, end: m.end, list: [m] });
    });
    if (!groups.length) groups.push({ start: 0, end: 0, list: [], self: true });
    var out = [];
    groups.forEach(function (g, i) {
      var from = g.end, to = i + 1 < groups.length ? groups[i + 1].start : text.length;
      var seg = text.slice(from, to);
      if (i === 0) { var pre = text.slice(0, g.start); if (pre.replace(/(^|\s)(برای|به|تسک|تسکهای|اضافه|کن)(?=\s|$)/g, '').trim()) seg = pre + ' ' + CUT + ' ' + seg; }
      var warnings = [], ids = [];
      g.list.forEach(function (m) { (m.ids || [m.id]).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); }); if (m.ambiguous) warnings.push('چند نفر «' + m.name + '» نام دارند؛ فرد درست را انتخاب کنید'); });
      if (!ids.length && g.self) ids = [ctx.me];
      var d = allDates(seg, ctx); seg = d.text;
      var time = findTime(seg); if (time) seg = seg.replace(time.phrase, CUT);
      var priority = 'medium';
      var pm = seg.match(/فوری|ضروری|خیلی مهم|اولویت (بالا|زیاد)|مهم/);
      if (pm) { priority = 'high'; seg = seg.replace(pm[0], CUT); }
      var lm = seg.match(/اولویت (کم|پایین)|غیر[ ‌]?فوری/);
      if (lm) { priority = 'low'; seg = seg.replace(lm[0], CUT); }
      var project = 0;
      (ctx.projects || []).slice().sort(function (a, b) { return b.name.length - a.name.length; }).some(function (p) {
        var name = normalize(p.name);
        var re = new RegExp('(برای |در |بابت )?(پروژه(ی|ٔ)? )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        var m = seg.match(re);
        if (m) { project = p.id; seg = seg.replace(m[0], CUT); return true; }
        return false;
      });
      var tasks = [];
      seg.split(CUT).forEach(function (chunk) { splitTitles(chunk).forEach(function (t) { tasks.push(t); }); });
      if (!d.dates.length) { d.dates = [ctx.today]; warnings.push('روزی گفته نشد؛ امروز در نظر گرفته شد'); }
      if (!tasks.length) warnings.push('عنوان تسک را نفهمیدم');
      out.push({ user_ids: ids, tasks: tasks, dates: d.dates, time: time ? time.time : '', priority: priority, project_id: project, warnings: warnings });
    });
    return out;
  }

  var Parser = { parseTasks: parseTasks, normalize: normalize, numberRuns: numberRuns, findTime: findTime, findDate: findDate, parseMoney: parseMoney, parseReminder: parseReminder };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Parser; return; }

  /* ------------------------------------------------------------ UI: the smart bar */

  var MP = root.MP, el = MP.el, icon = MP.icon;
  MP.Voice = Parser;
  var Speech = root.SpeechRecognition || root.webkitSpeechRecognition;
  MP.speechSupported = !!Speech;

  /**
   * Start listening. opts: {onText(partial, final), onEnd(finalText), onError(msg)}. Returns a stop function.
   */
  MP.listen = function (opts) {
    if (!Speech) { opts.onError && opts.onError('مرورگر شما تبدیل صوت به متن را پشتیبانی نمی‌کند؛ از میکروفون کیبورد گوشی استفاده کنید.'); return function () {}; }
    var rec = new Speech(), finalText = '', stopped = false;
    rec.lang = 'fa-IR'; rec.interimResults = true; rec.continuous = !!opts.continuous; rec.maxAlternatives = 1;
    rec.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' '; else interim += e.results[i][0].transcript;
      }
      opts.onText && opts.onText((finalText + interim).trim(), finalText.trim());
    };
    rec.onerror = function (e) {
      var msg = { 'not-allowed': 'اجازه دسترسی به میکروفون داده نشد.', 'no-speech': 'صدایی شنیده نشد؛ دوباره امتحان کنید.', network: 'تبدیل صوت به اینترنت نیاز دارد.', 'audio-capture': 'میکروفون پیدا نشد.' }[e.error];
      opts.onError && opts.onError(msg || 'تبدیل صوت انجام نشد.', e.error);
    };
    rec.onend = function () { if (!stopped) { stopped = true; opts.onEnd && opts.onEnd(finalText.trim()); } };
    try { rec.start(); } catch (err) { opts.onError && opts.onError('میکروفون در حال استفاده است.'); }
    return function () { try { rec.stop(); } catch (err) { /* already stopped */ } };
  };

  /** Records a short clip (max 20 s). opts: {onDone(File), onError(msg)}. Returns a stop function. */
  MP.recordClip = function (opts) {
    var mr = null, chunks = [], timer = null, stream = null, cancelled = false;
    if (!window.MediaRecorder || !navigator.mediaDevices) { opts.onError('ضبط صدا در این مرورگر ممکن نیست.'); return function () {}; }
    var types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/aac'], mime = '';
    for (var i = 0; i < types.length; i++) if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(types[i])) { mime = types[i]; break; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      stream = s;
      if (cancelled) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      mr = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = function () {
        s.getTracks().forEach(function (t) { t.stop(); });
        var type = (mr.mimeType || mime || 'audio/mp4').split(';')[0], ext = /mp4|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
        var blob = new Blob(chunks, { type: type });
        if (blob.size < 1200) { opts.onError('صدایی ضبط نشد؛ دوباره امتحان کنید.'); return; }
        opts.onDone(new File([blob], 'speech.' + ext, { type: type }));
      };
      mr.start(250);
      timer = setTimeout(function () { if (mr.state === 'recording') mr.stop(); }, 20000);
    }).catch(function () { opts.onError('اجازه دسترسی به میکروفون داده نشد.'); });
    return function () { clearTimeout(timer); if (mr && mr.state === 'recording') mr.stop(); else { cancelled = true; if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } };
  };

  /**
   * A mic + text bar that parses the sentence and calls apply(result).
   * opts: {placeholder, examples: [string], parse(text) → result, apply(result), describe(result) → [chip labels]}
   */
  MP.smartBar = function (opts) {
    var input = el('input', { type: 'text', class: 'smart-input', placeholder: opts.placeholder, enterkeyhint: 'done', 'aria-label': 'بگویید یا بنویسید' });
    var mic = el('button', { type: 'button', class: 'smart-mic', 'aria-label': 'گفتن با صدا', html: icon('mic') });
    var go = el('button', { type: 'button', class: 'smart-go', 'aria-label': 'پر کردن فرم', html: icon('check') });
    var chips = el('div', { class: 'smart-chips', 'aria-live': 'polite' });
    var hint = el('div', { class: 'smart-hint' }, el('span', { html: icon('mic') }), el('span', { text: opts.examples[0] }));
    var bar = el('div', { class: 'smart-bar' }, el('div', { class: 'smart-row' }, mic, input, go), chips, hint);
    var stop = null;
    function run(text) {
      if (!text.trim()) return;
      var r = opts.parse(text);
      opts.apply(r);
      chips.replaceChildren.apply(chips, opts.describe(r).map(function (c) { return el('span', { class: 'smart-chip' + (c[1] ? ' ' + c[1] : '') }, el('i', { html: icon('check') }), c[0]); }));
      hint.hidden = true;
      bar.classList.add('done');
      MP.haptic && MP.haptic(12);
    }
    go.onclick = function () { run(input.value); };
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(input.value); } });
    var n = 0;
    setInterval(function () { if (!bar.isConnected || bar.classList.contains('done') || document.activeElement === input) return; n = (n + 1) % opts.examples.length; hint.lastChild.textContent = opts.examples[n]; }, 4000);
    function speechServer() { return !!(MP.S.boot && MP.S.boot.channels && MP.S.boot.channels.speech); }
    function done(t) { stop = null; bar.classList.remove('listening'); input.placeholder = opts.placeholder; if (t || input.value) run(t || input.value); }
    function keyboardHint() {
      MP.toast(MP.isIOS && MP.isIOS() ? 'در آیفون روی میکروفون کیبورد (کنار فاصله) بزنید و بگویید؛ متن در همین کادر نوشته می‌شود.' : 'مرورگر شما تبدیل صوت را ندارد؛ از میکروفون کیبورد گوشی استفاده کنید.', { duration: 6000 });
      input.focus();
    }
    // iPhone (and any browser whose recognizer fails): record a clip and let the server transcribe it.
    function clipMode() {
      bar.classList.add('listening'); bar.classList.remove('done'); input.value = ''; input.placeholder = 'در حال ضبط… برای پایان دوباره بزنید';
      stop = MP.recordClip({
        onDone: function (file) {
          stop = null; input.placeholder = 'در حال تبدیل به متن…';
          MP.upload('speech/transcribe', file, {}).then(function (r) { done(r.text); })
            .catch(function (err) { bar.classList.remove('listening'); input.placeholder = opts.placeholder; MP.soft(err); });
        },
        onError: function (m) { stop = null; bar.classList.remove('listening'); input.placeholder = opts.placeholder; MP.toast(m, { error: true }); }
      });
    }
    if ((!Speech || (MP.isIOS && MP.isIOS())) && !speechServer()) mic.classList.add('unsupported');
    mic.onclick = function () {
      if (stop) { stop(); return; }
      var ios = MP.isIOS && MP.isIOS();
      if (ios || !Speech) { if (speechServer()) clipMode(); else keyboardHint(); return; }
      bar.classList.add('listening'); bar.classList.remove('done'); input.value = ''; input.placeholder = 'در حال شنیدن… بگویید';
      var failed = false;
      stop = MP.listen({
        onText: function (t) { input.value = t; },
        onError: function (m, code) {
          failed = true;
          if (/service-not-allowed|language-not-supported|network/.test(code || '') && speechServer()) { stop = null; bar.classList.remove('listening'); clipMode(); return; }
          MP.toast(m, { error: true });
        },
        onEnd: function (t) { if (stop === null && failed) return; done(t); }
      });
    };
    return bar;
  };
})(typeof window !== 'undefined' ? window : this);
