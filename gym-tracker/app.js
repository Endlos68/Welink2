/* Gym Tracker: Plain-JS Fitness-Fortschritts-App
   Trainingsdaten in localStorage, Gerätefotos in IndexedDB. */
(function () {
  'use strict';

  var STORAGE_KEY = 'gym-tracker-v1';
  var UI_KEY = 'gym-tracker-ui';
  var TIMER_KEY = 'gym-tracker-timer';

  function noop() {}
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  /* ================= Kategorien ================= */

  var BUILTIN_CATEGORIES = [
    { key: 'brust', label: 'Brust' },
    { key: 'arme', label: 'Arme' },
    { key: 'ruecken', label: 'Rücken' },
    { key: 'beine', label: 'Beine' },
    { key: 'bauch', label: 'Bauch' }
  ];
  /* Farben für eigene Kategorien: Schlüssel auf CSS-Variablen --cc-* */
  var CUSTOM_COLORS = ['orange', 'lime', 'himmel', 'indigo', 'magenta', 'rot', 'gold', 'stahl'];
  var NONE = 'none';

  function allCategories() { return BUILTIN_CATEGORIES.concat(data.categories); }
  function findCategory(key) {
    var list = allCategories();
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }
  function isBuiltin(key) {
    for (var i = 0; i < BUILTIN_CATEGORIES.length; i++) if (BUILTIN_CATEGORIES[i].key === key) return true;
    return false;
  }
  function isCategory(key) { return !!findCategory(key); }
  function catOf(ex) { return isCategory(ex.category) ? ex.category : NONE; }
  function catLabel(key) {
    var c = findCategory(key);
    return c ? c.label : 'Ohne Kategorie';
  }
  function catColor(key) {
    if (isBuiltin(key)) return 'var(--cat-' + key + ')';
    var c = findCategory(key);
    return c ? 'var(--cc-' + c.color + ')' : 'var(--cat-none)';
  }
  /* Kategorie-Farbe an ein Element hängen (data-cat für Tests/CSS, --cat für die Farbe) */
  function applyCat(node, key) {
    node.dataset.cat = key;
    node.style.setProperty('--cat', catColor(key));
    return node;
  }

  /* ================= Daten ================= */

  var REST_OPTIONS = [60, 90, 120, 150, 180, 240, 300];

  var data = loadData();

  function cleanGoal(g) {
    if (g === null) return null;
    if (!g || typeof g !== 'object') return undefined;
    if ((g.type === 'volume' || g.type === 'sets') && isFinite(g.value) && g.value > 0) return { type: g.type, value: +g.value };
    return undefined;
  }

  /* Alte und neue Datenstände (auch Backups) auf ein gültiges Format bringen */
  function normalizeData(p) {
    var out = { exercises: [], logs: {}, categories: [], goals: {}, settings: {} };
    if (Array.isArray(p.exercises)) {
      out.exercises = p.exercises.filter(function (e) { return e && typeof e.id === 'string' && typeof e.name === 'string'; });
    }
    if (p.logs && typeof p.logs === 'object') out.logs = p.logs;
    if (Array.isArray(p.categories)) {
      var seen = {};
      p.categories.forEach(function (c) {
        if (!c || typeof c.key !== 'string' || typeof c.label !== 'string' || !c.label.trim()) return;
        if (isBuiltin(c.key) || c.key === NONE || seen[c.key]) return;
        seen[c.key] = true;
        out.categories.push({
          key: c.key,
          label: c.label.trim().slice(0, 24),
          color: CUSTOM_COLORS.indexOf(c.color) >= 0 ? c.color : CUSTOM_COLORS[0]
        });
      });
    }
    if (p.goals && typeof p.goals === 'object') {
      Object.keys(p.goals).forEach(function (d) {
        var g = cleanGoal(p.goals[d]);
        if (g !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(d)) out.goals[d] = g;
      });
    }
    var s = p.settings && typeof p.settings === 'object' ? p.settings : {};
    out.settings = {
      restDefault: isFinite(s.restDefault) && s.restDefault > 0 ? clamp(Math.round(s.restDefault), 15, 900) : 120,
      restAuto: s.restAuto !== false,
      sound: s.sound !== false,
      vibrate: s.vibrate !== false,
      wakeLock: s.wakeLock !== false,
      notify: s.notify === true,
      goalDefault: cleanGoal(s.goalDefault) || null,
      goalDefaultSince: typeof s.goalDefaultSince === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.goalDefaultSince) ? s.goalDefaultSince : null
    };
    if (out.settings.goalDefault && !out.settings.goalDefaultSince) out.settings.goalDefaultSince = toISO(new Date());
    if (!out.settings.goalDefault) out.settings.goalDefaultSince = null;
    return out;
  }

  function isBackupShape(p) {
    return p && Array.isArray(p.exercises) && p.logs && typeof p.logs === 'object';
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (isBackupShape(parsed)) return normalizeData(parsed);
      }
    } catch (e) { /* korrupte Daten -> frisch starten */ }
    return normalizeData({});
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      toast('Speichern fehlgeschlagen. Ist der Gerätespeicher voll?');
    }
  }

  function uid(prefix) {
    return (prefix || 'ex') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function getExercise(id) {
    for (var i = 0; i < data.exercises.length; i++) {
      if (data.exercises[i].id === id) return data.exercises[i];
    }
    return null;
  }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { return {}; }
  }
  function savePrefs() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ filter: ui.filter, statsRange: ui.statsRange, statsCatMode: ui.statsCatMode }));
    } catch (e) { /* egal */ }
  }

  /* ================= Datum & Formate ================= */

  var WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

  function toISO(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function parseISO(iso) {
    var p = iso.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function todayISO() { return toISO(new Date()); }
  function shiftISO(iso, days) {
    var d = parseISO(iso);
    d.setDate(d.getDate() + days);
    return toISO(d);
  }
  function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
  function daysAgo(iso) { return daysBetween(iso, todayISO()); }
  /* Montag der Woche */
  function weekStartISO(iso) {
    var d = parseISO(iso);
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return toISO(d);
  }
  /* Kalenderwoche nach ISO 8601 */
  function isoWeek(iso) {
    var d = parseISO(iso);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    var jan4 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7);
  }

  function formatISO(iso, withYear) {
    var p = iso.split('-');
    var s = p[2] + '.' + p[1] + '.';
    return withYear ? s + p[0] : s;
  }
  function formatISOLong(iso) {
    return WEEKDAYS[parseISO(iso).getDay()] + ', ' + formatISO(iso, true);
  }
  function formatDayMonth(iso) {
    var d = parseISO(iso);
    return d.getDate() + '. ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  /* "Heute", "Gestern", "Vor 3 Tagen", sonst Datum */
  function relativeDay(iso, lower) {
    var n = daysAgo(iso);
    var s;
    if (n === 0) s = 'Heute';
    else if (n === 1) s = 'Gestern';
    else if (n === -1) s = 'Morgen';
    else if (n > 1 && n < 7) s = 'Vor ' + n + ' Tagen';
    else s = formatISO(iso, n > 300 || n < 0);
    return lower ? s.charAt(0).toLowerCase() + s.slice(1) : s;
  }
  function formatClock(ms) {
    var d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function formatSecs(sec) {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }
  function formatMinutes(min) {
    return min >= 60 ? Math.floor(min / 60) + ' h ' + (min % 60) + ' min' : min + ' min';
  }

  function formatNum(v, decimals) {
    var d = decimals === undefined ? (v >= 100 || v === Math.round(v) ? 0 : 1) : decimals;
    return v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function formatWeight(v) {
    return v.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  }
  function formatVolume(v) {
    return v >= 10000 ? formatNum(v / 1000, 1) + ' t' : formatNum(v, 0) + ' kg';
  }
  function setText(s) { return formatWeight(s.weight) + ' kg × ' + s.reps; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* ================= Metriken ================= */

  var METRICS = [
    { key: 'top', label: 'Top-Gewicht' },
    { key: 'e1rm', label: '1RM (gesch.)' },
    { key: 'volume', label: 'Volumen' }
  ];

  function epley(weight, reps) {
    return reps <= 1 ? weight : weight * (1 + reps / 30);
  }

  /* Tagesmetrik aus einer Set-Liste [{weight, reps}] */
  function dayMetric(sets, metric) {
    if (!sets || !sets.length) return null;
    var i, v = 0;
    if (metric === 'volume') {
      for (i = 0; i < sets.length; i++) v += sets[i].weight * sets[i].reps;
      return v;
    }
    if (metric === 'e1rm') {
      for (i = 0; i < sets.length; i++) v = Math.max(v, epley(sets[i].weight, sets[i].reps));
      return v;
    }
    for (i = 0; i < sets.length; i++) v = Math.max(v, sets[i].weight);
    return v;
  }

  /* Zeitreihe einer Übung: [{date, value}], aufsteigend, optional ab "since" */
  function exerciseSeries(exId, metric, since) {
    var log = data.logs[exId] || {};
    var out = [];
    Object.keys(log).sort().forEach(function (date) {
      if (since && date < since) return;
      var v = dayMetric(log[date], metric);
      if (v !== null && v > 0) out.push({ date: date, value: v });
    });
    return out;
  }

  /* Globale Serie: pro Übung relativ zum ersten Wert im Zeitraum (100 %),
     letzter bekannter Wert wird fortgeschrieben, Durchschnitt über alle Übungen. */
  function globalSeries(metric, since) {
    var perEx = [];
    var dateSet = {};
    data.exercises.forEach(function (ex) {
      var s = exerciseSeries(ex.id, metric, since);
      if (s.length) {
        perEx.push(s);
        s.forEach(function (pt) { dateSet[pt.date] = true; });
      }
    });
    if (!perEx.length) return [];
    var out = [];
    Object.keys(dateSet).sort().forEach(function (date) {
      var sum = 0, n = 0;
      perEx.forEach(function (series) {
        var baseline = series[0].value;
        if (series[0].date > date || baseline <= 0) return;
        var last = null;
        for (var i = 0; i < series.length && series[i].date <= date; i++) last = series[i].value;
        if (last !== null) { sum += (last / baseline) * 100; n++; }
      });
      if (n) out.push({ date: date, value: sum / n });
    });
    return out;
  }

  /* Rekorde einer Übung.
     'weight': schwerer als jedes Gewicht davor, mind. 1 Wdh. (das feiern wir)
     'best':   kein neues Gewicht, aber bestes geschätztes 1RM (z. B. mehr Wdh.)
     Erst ab dem zweiten Trainingstag, damit der Start nicht voller Rekorde ist. */
  function computeRecords(exId) {
    var log = data.logs[exId] || {};
    var marks = {};
    var events = [];
    var maxW = 0, maxE = 0, hasPrior = false, record = null;
    Object.keys(log).sort().forEach(function (date) {
      var sets = log[date] || [];
      sets.forEach(function (s, i) {
        var e = epley(s.weight, s.reps);
        if (hasPrior && s.weight > maxW + 1e-9) {
          (marks[date] = marks[date] || {})[i] = 'weight';
          events.push({ exId: exId, date: date, index: i, weight: s.weight, reps: s.reps, prev: maxW });
        } else if (hasPrior && e > maxE + 1e-9) {
          (marks[date] = marks[date] || {})[i] = 'best';
        }
        if (!record || s.weight > record.weight || (s.weight === record.weight && s.reps > record.reps)) {
          record = { weight: s.weight, reps: s.reps, date: date };
        }
        if (s.weight > maxW) maxW = s.weight;
        if (e > maxE) maxE = e;
      });
      if (sets.length) hasPrior = true;
    });
    return { marks: marks, events: events, record: record, bestE1rm: maxE };
  }

  function lastSession(exId, beforeISO) {
    var log = data.logs[exId] || {};
    var dates = Object.keys(log).sort();
    for (var i = dates.length - 1; i >= 0; i--) {
      if (dates[i] < beforeISO && log[dates[i]] && log[dates[i]].length) return { date: dates[i], sets: log[dates[i]] };
    }
    return null;
  }

  function lastTrainedDate(exId) {
    var dates = Object.keys(data.logs[exId] || {}).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }

  function topSet(sets) {
    var best = null;
    sets.forEach(function (s) {
      if (!best || s.weight > best.weight || (s.weight === best.weight && s.reps > best.reps)) best = s;
    });
    return best;
  }

  /* Tagesbilanz über alle Übungen; Dauer aus den Zeitstempeln der Sätze */
  function daySummary(date) {
    var sets = 0, volume = 0, exercises = 0, tMin = Infinity, tMax = -Infinity, nt = 0;
    data.exercises.forEach(function (ex) {
      var day = (data.logs[ex.id] || {})[date];
      if (!day || !day.length) return;
      exercises++;
      day.forEach(function (s) {
        sets++;
        volume += s.weight * s.reps;
        if (s.t) { nt++; tMin = Math.min(tMin, s.t); tMax = Math.max(tMax, s.t); }
      });
    });
    return { sets: sets, volume: volume, exercises: exercises, minutes: nt >= 2 ? Math.max(1, Math.round((tMax - tMin) / 60000)) : null };
  }

  /* ================= Tagesziel ================= */

  /* Tagesziel eines Tages: eigenes Ziel, sonst der Standard (erst ab dem Tag,
     an dem er festgelegt wurde, damit alte Tage nicht nachträglich zählen) */
  function goalFor(date) {
    if (has(data.goals, date)) return data.goals[date];
    var s = data.settings;
    if (s.goalDefault && (!s.goalDefaultSince || date >= s.goalDefaultSince)) return s.goalDefault;
    return null;
  }
  function setDefaultGoal(g) {
    var s = data.settings;
    if (!g) { s.goalDefault = null; s.goalDefaultSince = null; return; }
    if (!s.goalDefault || !s.goalDefaultSince || s.goalDefaultSince > todayISO()) s.goalDefaultSince = todayISO();
    s.goalDefault = g;
  }
  function goalProgress(date, sum) {
    var g = goalFor(date);
    if (!g) return null;
    sum = sum || daySummary(date);
    var cur = g.type === 'volume' ? sum.volume : sum.sets;
    return { goal: g, current: cur, ratio: g.value ? cur / g.value : 0, done: cur >= g.value };
  }
  function goalValueText(type, v) { return type === 'volume' ? formatNum(v, 0) : String(Math.round(v)); }
  function goalUnit(type) { return type === 'volume' ? 'kg' : 'Sätze'; }
  function goalText(g) {
    if (!g) return 'Kein Ziel';
    return goalValueText(g.type, g.value) + ' ' + (g.type === 'volume' ? 'kg Volumen' : 'Sätze');
  }

  /* ================= UI-State ================= */

  var prefs = loadPrefs();
  var ui = {
    view: 'training',          // training | exercises | exerciseDetail | stats | settings
    date: todayISO(),
    filter: (prefs.filter === NONE || isCategory(prefs.filter)) ? prefs.filter : 'all',
    openId: null,              // aufgeklappte Übung im Training
    draft: null,               // {exId, date, weight, reps}
    editing: null,             // {exId, date, index}
    flash: null,               // frisch eingetragener Satz {exId, date, index}
    goalAnimFrom: null,        // Fortschrittsbalken: alter Stand für die Animation
    detailId: null,
    detailMetric: 'top',
    statsMetric: 'top',
    statsRange: ['4w', '3m', '1y', 'all'].indexOf(prefs.statsRange) >= 0 ? prefs.statsRange : '3m',
    statsCatMode: prefs.statsCatMode === 'volume' ? 'volume' : 'sets',
    renaming: false,
    newCategory: null,         // Auswahl im Anlegen-Formular
    newId: null                // frisch angelegte Übung (kurz hervorheben)
  };

  /* ================= DOM-Kurzhelfer ================= */

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  function icon(name, cls) {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(SVGNS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function btn(className, text, iconName, label) {
    var b = el('button', className);
    b.type = 'button';
    if (iconName) b.appendChild(icon(iconName));
    if (text) b.appendChild(document.createTextNode(text));
    if (label) b.setAttribute('aria-label', label);
    return b;
  }

  /* Ein-/Aus-Schalter als Zeile */
  function switchRow(label, sub, checked, onChange) {
    var row = el('label', 'switch-row');
    var text = el('span', 'switch-text');
    text.appendChild(el('span', null, label));
    if (sub) text.appendChild(el('small', null, sub));
    var input = el('input', 'switch');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.checked = !!checked;
    input.addEventListener('change', function () { haptic('tick'); onChange(input.checked, input); });
    row.appendChild(text);
    row.appendChild(input);
    return row;
  }

  /* ================= Bewegung ================= */

  var reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function canTransition() {
    return !!document.startViewTransition && !reduceMotion.matches && !document.hidden;
  }

  /* DOM-Änderung als View Transition: Elemente mit view-transition-name
     gleiten an ihre neue Position, der Rest blendet über. Ohne Support sofort. */
  function transition(update, done, kind) {
    done = done || noop;
    if (!canTransition()) { update(); done(); return; }
    var vt = startVT(update, kind);
    vt.finished.then(done, done);
  }

  /* kind: Art des Wechsels für das CSS (nav | push | pop | list), sonst Überblenden */
  function startVT(update, kind) {
    var root = document.documentElement;
    if (kind) root.dataset.vt = kind; else delete root.dataset.vt;
    var vt = document.startViewTransition(update);
    vt.ready.catch(noop);
    var reset = function () { if (root.dataset.vt === kind) delete root.dataset.vt; };
    vt.finished.then(reset, reset);
    return vt;
  }

  /* Geteiltes Element: fromEl verwandelt sich in das Element, das findTarget()
     nach dem Update liefert (z. B. Vorschaubild -> großes Foto). */
  function morph(fromEl, update, findTarget, name, kind) {
    name = name || 'hero';
    if (!canTransition()) { update(); return; }
    if (!fromEl) { transition(update, null, kind); return; }
    var target = null;
    fromEl.style.viewTransitionName = name;
    var vt = startVT(function () {
      fromEl.style.viewTransitionName = '';
      update();
      target = findTarget ? findTarget() : null;
      if (!target) return undefined;
      target.style.viewTransitionName = name;
      var img = target.tagName === 'IMG' ? target : target.querySelector('img');
      return img && img.decode ? img.decode().catch(noop) : undefined;
    }, kind);
    var clear = function () { if (target) target.style.viewTransitionName = ''; };
    vt.finished.then(clear, clear);
  }

  function vtName(prefix, id) {
    return prefix + '-' + String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  /* Zahl rollt beim Ändern kurz nach oben oder unten */
  function tick(node, dir) {
    if (reduceMotion.matches || !node.animate) return;
    node.animate(
      [{ transform: 'translateY(' + (dir > 0 ? 10 : -10) + 'px)', opacity: 0.3 }, { transform: 'none', opacity: 1 }],
      { duration: 170, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
  }

  /* ================= Haptik =================
     Android: Vibration API. iOS 18+: Umschalten eines <input switch> löst
     ein kurzes haptisches Tick aus (nur innerhalb einer Nutzergeste). */

  var coarsePointer = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };

  var hapticLabel = (function () {
    var label = el('label', 'haptic');
    label.setAttribute('aria-hidden', 'true');
    var input = el('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    return label;
  })();

  /* Vibration erst nach einer Berührung (sonst blockiert der Browser) */
  function canVibrate() {
    return !!navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive);
  }

  function haptic(kind) {
    try {
      if (navigator.vibrate) {
        if (!canVibrate()) return;
        navigator.vibrate(kind === 'record' ? [20, 60, 20, 60, 40] : kind === 'success' ? [16, 60, 24] : kind === 'tap' ? 10 : 6);
        return;
      }
      if (!coarsePointer.matches) return;
      var prev = document.activeElement;
      hapticLabel.click();
      if (prev && prev !== document.activeElement && prev.focus) prev.focus({ preventScroll: true });
    } catch (e) { /* ohne Haptik weiter */ }
  }

  /* ================= Ton ================= */

  var Sound = (function () {
    var ctx = null;
    function unlock() {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        // Musik nur kurz absenken statt anhalten (Safari)
        if (navigator.audioSession) navigator.audioSession.type = 'transient';
        if (!ctx) ctx = new AC();
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) { /* ohne Ton weiter */ }
    }
    function tones(list, gap) {
      if (!ctx || ctx.state !== 'running') return;
      try {
        var t0 = ctx.currentTime + 0.02;
        list.forEach(function (f, i) {
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          var t = t0 + i * (gap || 0.2);
          o.type = 'sine';
          o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.32, t + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(t);
          o.stop(t + 0.2);
        });
      } catch (e) { /* egal */ }
    }
    return {
      unlock: unlock,
      chime: function () { tones([880, 880, 1320], 0.24); },
      record: function () { tones([660, 880, 1320], 0.12); }
    };
  })();

  document.addEventListener('pointerdown', function () { if (data.settings.sound) Sound.unlock(); }, { passive: true });

  /* ================= Konfetti =================
     Kurzer Partikel-Burst für Rekorde und erreichte Tagesziele.
     Bei "Bewegung reduzieren" gibt es stattdessen nur Badge und Hinweis. */

  var Confetti = (function () {
    var canvas = null, ctx = null, parts = [], raf = null, last = 0, W = 0, H = 0;
    var COLORS = ['#72d88b', '#9ce5ad', '#ec7c99', '#f0ba59', '#67aaed', '#b191ea', '#62cfce', '#f0f5f2'];

    function ensure() {
      if (canvas) return;
      canvas = el('canvas', 'confetti');
      canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(canvas);
      ctx = canvas.getContext('2d');
      size();
      window.addEventListener('resize', size);
    }
    function size() {
      if (!canvas) return;
      var dpr = window.devicePixelRatio || 1;
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function burst(x, y, opts) {
      if (reduceMotion.matches) return;
      opts = opts || {};
      ensure();
      var n = opts.count || 90;
      var angle = opts.angle === undefined ? -Math.PI / 2 : opts.angle;
      var spread = opts.spread || 1.3;
      var power = opts.power || 1;
      for (var i = 0; i < n; i++) {
        var a = angle + (Math.random() - 0.5) * spread;
        var v = (520 + Math.random() * 520) * power;
        parts.push({
          x: x, y: y,
          vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          w: 5 + Math.random() * 5, h: 8 + Math.random() * 7,
          rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 14,
          flip: Math.random() * Math.PI * 2, vf: 6 + Math.random() * 10,
          color: COLORS[(Math.random() * COLORS.length) | 0],
          round: Math.random() < 0.25,
          life: 0, ttl: 1.5 + Math.random() * 0.9
        });
      }
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    }
    function frame(ts) {
      var dt = Math.min(0.033, (ts - last) / 1000);
      last = ts;
      ctx.clearRect(0, 0, W, H);
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.life += dt;
        p.vx *= 1 - 1.6 * dt;
        p.vy = p.vy * (1 - 1.1 * dt) + 1500 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.flip += p.vf * dt;
        if (p.life > p.ttl || p.y > H + 40) { parts.splice(i, 1); continue; }
        var fade = p.life > p.ttl * 0.7 ? 1 - (p.life - p.ttl * 0.7) / (p.ttl * 0.3) : 1;
        ctx.save();
        ctx.globalAlpha = Math.max(0, fade);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.flip));
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
      if (parts.length) raf = requestAnimationFrame(frame);
      else { raf = null; ctx.clearRect(0, 0, W, H); }
    }
    function fromElement(node, opts) {
      var r = node && node.getBoundingClientRect ? node.getBoundingClientRect() : null;
      var x = r ? r.left + r.width / 2 : window.innerWidth / 2;
      var y = r ? r.top + r.height / 2 : window.innerHeight / 2;
      burst(x, y, opts);
    }
    /* Großer Moment: Mitte plus zwei seitliche "Kanonen" */
    function celebrate(node) {
      fromElement(node, { count: 110, spread: 1.6, power: 1.05 });
      burst(0, window.innerHeight * 0.72, { count: 45, angle: -Math.PI / 3, spread: 0.5, power: 1.25 });
      burst(window.innerWidth, window.innerHeight * 0.72, { count: 45, angle: -Math.PI * 2 / 3, spread: 0.5, power: 1.25 });
    }
    return { burst: burst, fromElement: fromElement, celebrate: celebrate };
  })();

  /* ================= Hinweis-Leiste (Toast) ================= */

  var toastTimer = null;

  function toast(text, actionLabel, onAction, variant) {
    var t = $('toast');
    var action = $('toast-action');
    clearTimeout(toastTimer);
    t.classList.toggle('is-record', variant === 'record');
    t.classList.add('show');
    $('toast-text').textContent = text;
    action.hidden = !actionLabel;
    action.textContent = actionLabel || '';
    action.onclick = function () {
      hideToast();
      if (onAction) onAction();
    };
    toastTimer = setTimeout(hideToast, actionLabel ? 6000 : variant === 'record' ? 4200 : 2800);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    $('toast').classList.remove('show');
  }

  /* ================= Bottom Sheet ================= */

  var sheet = $('sheet');

  function openSheet(title, build) {
    var body = $('sheet-body');
    body.textContent = '';
    $('sheet-title').textContent = title;
    build(body, closeSheet);
    if (!sheet.open) {
      if (sheet.showModal) sheet.showModal(); else sheet.setAttribute('open', '');
    }
    var first = body.querySelector('input[type="text"], [aria-pressed="true"], [aria-checked="true"], button');
    if (first) first.focus({ preventScroll: true });
  }

  function closeSheet() {
    if (!sheet.open) return;
    if (sheet.close) sheet.close(); else sheet.removeAttribute('open');
  }

  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
  $('sheet-close').addEventListener('click', closeSheet);

  /* Auswahl-Chips (z. B. Pausendauer, Zielvorgaben) */
  function chipRow(options, isActive, onPick, className) {
    var row = el('div', className || 'chip-row');
    options.forEach(function (o) {
      var b = btn('opt-chip', o.label);
      b.setAttribute('aria-pressed', String(isActive(o)));
      b.addEventListener('click', function () { haptic('tick'); onPick(o, b); });
      row.appendChild(b);
    });
    return row;
  }

  /* ================= Fotos (IndexedDB) =================
     Gerätefotos sind zu groß für localStorage (~5 MB Limit) und würden jeden
     Speichervorgang ausbremsen. Sie liegen daher als verkleinerte JPEG-Data-URLs
     in IndexedDB (Schlüssel = Übungs-ID) und zusätzlich im Speicher (photos). */

  var PHOTO_MAX_SIZE = 1280;   // längste Kante in px
  var PHOTO_QUALITY = 0.8;

  var photos = {};             // exId -> data:image/jpeg;base64,...

  var PhotoStore = (function () {
    var DB_NAME = 'gym-tracker-photos';
    var STORE = 'photos';
    var dbPromise = null;

    function open() {
      if (!dbPromise) {
        dbPromise = new Promise(function (resolve, reject) {
          if (!window.indexedDB) { reject(new Error('IndexedDB nicht verfügbar')); return; }
          var req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
        dbPromise.catch(function () { dbPromise = null; });
      }
      return dbPromise;
    }

    function run(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE, mode);
          var req = fn(tx.objectStore(STORE));
          tx.oncomplete = function () { resolve(req ? req.result : undefined); };
          tx.onerror = function () { reject(tx.error); };
          tx.onabort = function () { reject(tx.error); };
        });
      });
    }

    return {
      put: function (id, dataUrl) { return run('readwrite', function (s) { return s.put(dataUrl, id); }); },
      remove: function (id) { return run('readwrite', function (s) { return s.delete(id); }); },
      getAll: function () {
        var out = {};
        return run('readonly', function (s) {
          var cur = s.openCursor();
          cur.onsuccess = function () {
            var c = cur.result;
            if (c) { out[c.key] = c.value; c.continue(); }
          };
        }).then(function () { return out; });
      },
      replaceAll: function (map) {
        return run('readwrite', function (s) {
          s.clear();
          Object.keys(map).forEach(function (id) { s.put(map[id], id); });
        });
      }
    };
  })();

  function isPhotoDataUrl(v) {
    return typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(v);
  }

  function loadPhotos() {
    return PhotoStore.getAll().then(function (all) {
      photos = {};
      Object.keys(all).forEach(function (id) {
        if (isPhotoDataUrl(all[id])) photos[id] = all[id];
      });
    }).catch(noop);
  }

  /* Bild laden, auf PHOTO_MAX_SIZE verkleinern und als JPEG-Data-URL liefern.
     Moderne Browser berücksichtigen dabei die EXIF-Ausrichtung automatisch. */
  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, PHOTO_MAX_SIZE / Math.max(w, h));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY));
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Bild konnte nicht gelesen werden'));
      };
      img.src = url;
    });
  }

  function setPhoto(exId, dataUrl) {
    return PhotoStore.put(exId, dataUrl).then(function () {
      photos[exId] = dataUrl;
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(noop);
    });
  }

  function removePhoto(exId) {
    delete photos[exId];
    return PhotoStore.remove(exId).catch(noop);
  }

  var photoTarget = null;
  var photoInput = $('photo-input');

  function pickPhoto(exId, useCamera) {
    photoTarget = exId;
    if (useCamera) photoInput.setAttribute('capture', 'environment');
    else photoInput.removeAttribute('capture');
    photoInput.click();
  }

  photoInput.addEventListener('change', function () {
    var file = this.files[0];
    var exId = photoTarget;
    this.value = '';
    photoTarget = null;
    if (!file || !exId || !getExercise(exId)) return;
    resizeImage(file)
      .then(function (dataUrl) { return setPhoto(exId, dataUrl); })
      .then(function () {
        haptic('tap');
        transition(render);
      })
      .catch(function () { toast('Das Foto konnte nicht gespeichert werden.'); });
  });

  /* Vorschaubild; ohne Foto ein Kamera-Platzhalter */
  function buildThumb(exId, tag) {
    var node = el(tag || 'div', 'thumb');
    if (photos[exId]) {
      var img = el('img');
      img.src = photos[exId];
      img.alt = '';
      img.decoding = 'async';
      node.appendChild(img);
    } else {
      node.classList.add('is-empty');
      node.appendChild(icon('camera'));
    }
    return node;
  }

  /* Vorschaubild als Button: Foto groß zeigen oder direkt Kamera öffnen */
  function buildPhotoButton(ex) {
    var b = buildThumb(ex.id, 'button');
    b.type = 'button';
    if (photos[ex.id]) {
      b.setAttribute('aria-label', 'Foto von ' + ex.name + ' anzeigen');
      b.addEventListener('click', function () { openLightbox(ex.id, b.querySelector('img')); });
    } else {
      b.setAttribute('aria-label', 'Foto von ' + ex.name + ' aufnehmen');
      b.title = 'Foto vom Gerät aufnehmen';
      b.addEventListener('click', function () { pickPhoto(ex.id, true); });
    }
    return b;
  }

  /* ================= Vollbild-Foto ================= */

  var lightboxSource = null;

  function openLightbox(exId, sourceImg) {
    var ex = getExercise(exId);
    if (!ex || !photos[exId]) return;
    var lb = $('lightbox');
    var img = $('lightbox-img');
    img.src = photos[exId];
    img.alt = 'Foto: ' + ex.name;
    $('lightbox-caption').textContent = ex.name;
    lightboxSource = sourceImg || null;
    haptic('tap');
    var reveal = function () {
      lb.hidden = false;
      document.body.classList.add('no-scroll');
      $('lightbox-close').focus({ preventScroll: true });
    };
    var ready = img.decode ? img.decode().catch(noop) : Promise.resolve();
    ready.then(function () {
      morph(sourceImg, reveal, function () { return img; }, 'photo');
    });
  }

  function closeLightbox() {
    var lb = $('lightbox');
    if (lb.hidden) return;
    var src = lightboxSource && document.body.contains(lightboxSource) ? lightboxSource : null;
    lightboxSource = null;
    var hide = function () {
      lb.hidden = true;
      document.body.classList.remove('no-scroll');
      var back = src && src.closest('button');
      if (back) back.focus({ preventScroll: true });
    };
    morph(src ? $('lightbox-img') : null, hide, function () { return src; }, 'photo');
  }

  $('lightbox').addEventListener('click', closeLightbox);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLightbox();
  });

  /* ================= Pausentimer =================
     Läuft über Zeitstempel (endAt), damit er auch nach App-Wechsel oder
     gesperrtem Bildschirm stimmt. Ton/Vibration nur, solange die App offen ist;
     Benachrichtigungen im Hintergrund, wo das Betriebssystem es zulässt. */

  var RING = 2 * Math.PI * 19;
  var timer = loadTimer();
  var timerInterval = null;
  var timerTimeout = null;

  function loadTimer() {
    try {
      var t = JSON.parse(localStorage.getItem(TIMER_KEY));
      if (t && isFinite(t.endAt) && isFinite(t.duration) && Date.now() - t.endAt < 5 * 60000) return t;
    } catch (e) { /* egal */ }
    return null;
  }
  function saveTimer() {
    try {
      if (timer) localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
      else localStorage.removeItem(TIMER_KEY);
    } catch (e) { /* egal */ }
  }

  /* Pause für eine Übung: eigene Einstellung, sonst Standard; 0 = keine Pause */
  function restFor(ex) {
    if (ex && ex.rest === 0) return 0;
    if (ex && isFinite(ex.rest) && ex.rest > 0) return ex.rest;
    return data.settings.restDefault;
  }

  function startRest(exId, setNo, seconds) {
    var now = Date.now();
    timer = { exId: exId, setNo: setNo, duration: seconds, startAt: now, endAt: now + seconds * 1000, alerted: false };
    saveTimer();
    if (data.settings.sound) Sound.unlock();
    WakeLock.update();
    scheduleTimer();
    updateDock();
  }

  function setRestDuration(seconds) {
    if (!timer) return;
    timer.duration = seconds;
    timer.endAt = timer.startAt + seconds * 1000;
    if (timer.endAt > Date.now()) timer.alerted = false;
    saveTimer();
    scheduleTimer();
    updateDock();
  }

  function adjustRest(delta) {
    if (!timer) return;
    var now = Date.now();
    timer.endAt = Math.max(now, timer.endAt + delta * 1000);
    timer.duration = Math.max(1, (timer.endAt - timer.startAt) / 1000);
    if (timer.endAt > now) timer.alerted = false;
    saveTimer();
    scheduleTimer();
    updateDock();
  }

  function stopRest() {
    timer = null;
    saveTimer();
    clearInterval(timerInterval);
    clearTimeout(timerTimeout);
    WakeLock.update();
    updateDock();
  }

  function scheduleTimer() {
    clearInterval(timerInterval);
    clearTimeout(timerTimeout);
    if (!timer) return;
    timerInterval = setInterval(updateDock, 250);
    var ms = timer.endAt - Date.now();
    if (ms > 0 && !timer.alerted) timerTimeout = setTimeout(updateDock, ms + 30);
  }

  function updateDock() {
    var dock = $('rest-dock');
    document.body.classList.toggle('has-dock', !!timer);
    if (!timer) { dock.hidden = true; return; }
    var now = Date.now();
    var left = timer.endAt - now;
    if (left <= 0 && !timer.alerted) {
      timer.alerted = true;
      saveTimer();
      restAlert(-left);
    }
    if (left < -5 * 60000) { stopRest(); return; }

    var done = left <= 0;
    dock.hidden = false;
    dock.classList.toggle('is-done', done);
    var ex = getExercise(timer.exId);
    $('rest-time').textContent = done ? '+' + formatSecs(-left / 1000) : formatSecs(Math.ceil(left / 1000));
    $('rest-sub').textContent = done
      ? 'Jetzt Satz ' + timer.setNo + (ex ? ' · ' + ex.name : '')
      : 'Satz ' + timer.setNo + ' um ' + formatClock(timer.endAt) + (ex ? ' · ' + ex.name : '');
    var ratio = done ? 1 : clamp(1 - left / (timer.duration * 1000), 0, 1);
    var bar = $('rest-bar');
    bar.style.strokeDasharray = RING.toFixed(2);
    bar.style.strokeDashoffset = (RING * ratio).toFixed(2);
    $('rest-minus').hidden = done;
    $('rest-plus').hidden = done;
    $('rest-close').setAttribute('aria-label', done ? 'Pause schließen' : 'Pause beenden');
  }

  function restAlert(lateMs) {
    var ex = getExercise(timer.exId);
    var what = (ex ? ex.name + ', ' : '') + 'Satz ' + timer.setNo;
    $('rest-live').textContent = 'Pause vorbei. Weiter mit ' + what + '.';
    if (document.hidden) notify('Pause vorbei', 'Weiter mit ' + what);
    if (lateMs > 4000) return;   // nicht nachträglich lärmen
    if (data.settings.vibrate && canVibrate()) {
      try { navigator.vibrate([220, 90, 220, 90, 320]); } catch (e) { /* egal */ }
    }
    if (data.settings.sound) Sound.chime();
  }

  function notify(title, body) {
    if (!data.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    var opts = { body: body, tag: 'rest', renotify: true, icon: 'icon.svg', vibrate: [220, 90, 220] };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(function (reg) { return reg.showNotification(title, opts); }).catch(noop);
    } else {
      try { new Notification(title, opts); } catch (e) { /* egal */ }
    }
  }

  /* Bildschirm während der Pause anlassen (Screen Wake Lock) */
  var WakeLock = (function () {
    var sentinel = null, pending = false;
    var supported = 'wakeLock' in navigator;
    function want() { return supported && !!timer && data.settings.wakeLock && !document.hidden; }
    function release() {
      if (sentinel) { try { sentinel.release(); } catch (e) { /* egal */ } sentinel = null; }
    }
    function update() {
      if (!want()) { release(); return; }
      if (sentinel || pending) return;
      pending = true;
      navigator.wakeLock.request('screen').then(function (s) {
        pending = false;
        sentinel = s;
        s.addEventListener('release', function () { if (sentinel === s) sentinel = null; });
        if (!want()) release();
      }).catch(function () { pending = false; });
    }
    return { update: update, supported: supported };
  })();

  $('rest-minus').addEventListener('click', function () { haptic('tick'); adjustRest(-15); });
  $('rest-plus').addEventListener('click', function () { haptic('tick'); adjustRest(15); });
  $('rest-close').addEventListener('click', function () { haptic('tap'); stopRest(); });
  $('rest-main').addEventListener('click', function () {
    if (!timer) return;
    var ex = getExercise(timer.exId);
    if (timer.endAt <= Date.now()) { haptic('tap'); stopRest(); return; }
    if (ex) openRestSheet(ex);
  });

  /* Auswahl der Pausendauer für eine Übung */
  function openRestSheet(ex) {
    openSheet('Pause nach jedem Satz', function (body, close) {
      body.appendChild(el('p', 'sheet-sub', ex.name));
      var options = [{ v: null, label: 'Standard (' + formatSecs(data.settings.restDefault) + ')' }]
        .concat(REST_OPTIONS.map(function (s) { return { v: s, label: formatSecs(s) }; }))
        .concat([{ v: 0, label: 'Keine Pause' }]);
      var current = ex.rest === 0 ? 0 : (isFinite(ex.rest) && ex.rest > 0 ? ex.rest : null);
      body.appendChild(chipRow(options, function (o) { return o.v === current; }, function (o) {
        if (o.v === null) delete ex.rest; else ex.rest = o.v;
        saveData();
        if (timer && timer.exId === ex.id) {
          var sec = restFor(ex);
          if (sec > 0) setRestDuration(sec); else stopRest();
        }
        close();
        transition(render);
      }, 'chip-row chip-grid'));
    });
  }

  /* ================= Kopfzeile & Filter ================= */

  function renderHeader() {
    var main = $('header-main');
    main.textContent = '';

    if (ui.view === 'training') {
      var isToday = ui.date === todayISO();
      var n = daysAgo(ui.date);
      var titleText = n === 0 ? 'Heute' : n === 1 ? 'Gestern' : n === -1 ? 'Morgen' : WEEKDAYS_LONG[parseISO(ui.date).getDay()];
      var box = el('div', 'date-title');
      box.appendChild(el('h1', 'title', titleText));
      var sub = el('p', 'subtitle');
      sub.appendChild(el('span', null, (n === 0 || n === 1 || n === -1 ? WEEKDAYS_LONG[parseISO(ui.date).getDay()] + ', ' : '') + formatDayMonth(ui.date)));
      if (!isToday) {
        var back = btn('link-btn', 'Zu heute');
        back.addEventListener('click', function () { changeDate(todayISO()); });
        sub.appendChild(back);
      }
      box.appendChild(sub);
      main.appendChild(box);

      var actions = el('div', 'header-actions');
      var prev = btn('icon-btn', null, 'chevron-left', 'Vorheriger Tag');
      prev.addEventListener('click', function () { changeDate(shiftISO(ui.date, -1)); });
      var next = btn('icon-btn', null, 'chevron-right', 'Nächster Tag');
      next.addEventListener('click', function () { changeDate(shiftISO(ui.date, 1)); });
      actions.appendChild(prev);
      actions.appendChild(next);
      main.appendChild(actions);
    } else if (ui.view === 'exercises') {
      var h = el('h1', 'title', 'Übungen');
      if (data.exercises.length) h.appendChild(el('span', 'title-count', String(data.exercises.length)));
      main.appendChild(h);
    } else if (ui.view === 'exerciseDetail') {
      var backBtn = btn('back-btn', 'Übungen', 'chevron-left');
      backBtn.addEventListener('click', closeDetail);
      main.appendChild(backBtn);
      var acts = el('div', 'header-actions');
      var rename = btn('icon-btn', null, 'pencil', 'Übung umbenennen');
      rename.addEventListener('click', function () {
        ui.renaming = true;
        renderDetailHead(getExercise(ui.detailId));
        var input = $('rename-input');
        if (input) { input.focus(); input.select(); }
      });
      var del = btn('icon-btn danger', null, 'trash', 'Übung löschen');
      del.addEventListener('click', deleteExercise);
      acts.appendChild(rename);
      acts.appendChild(del);
      main.appendChild(acts);
    } else if (ui.view === 'stats') {
      main.appendChild(el('h1', 'title', 'Statistik'));
    } else {
      main.appendChild(el('h1', 'title', 'Einstellungen'));
    }

    var showFilter = (ui.view === 'training' || ui.view === 'exercises') && data.exercises.length > 0;
    $('filter-bar').hidden = !showFilter;
    if (showFilter) renderFilterBar();
  }

  function categoryCounts() {
    var counts = { all: data.exercises.length };
    counts[NONE] = 0;
    allCategories().forEach(function (c) { counts[c.key] = 0; });
    data.exercises.forEach(function (ex) { counts[catOf(ex)]++; });
    return counts;
  }

  function renderFilterBar() {
    var bar = $('filter-bar');
    var oldSeg = bar.querySelector('.seg-cats');
    var scrollLeft = oldSeg ? oldSeg.scrollLeft : 0;
    bar.textContent = '';
    var seg = el('div', 'seg-cats');
    bar.appendChild(seg);
    var counts = categoryCounts();
    if (ui.filter === NONE && !counts[NONE]) ui.filter = 'all';
    if (ui.filter !== 'all' && ui.filter !== NONE && !isCategory(ui.filter)) ui.filter = 'all';

    var items = [{ key: 'all', label: 'Alle' }].concat(allCategories());
    if (counts[NONE]) items.push({ key: NONE, label: 'Ohne' });

    items.forEach(function (it) {
      var chip = btn('chip');
      if (it.key !== 'all') applyCat(chip, it.key);
      chip.appendChild(el('span', 'chip-dot' + (it.key === 'all' ? ' all' : '')));
      chip.appendChild(el('span', 'chip-label', it.label));
      chip.setAttribute('aria-label', it.label + ', ' + plural(counts[it.key] || 0, 'Übung', 'Übungen'));
      chip.setAttribute('aria-pressed', String(ui.filter === it.key));
      chip.addEventListener('click', function () {
        if (ui.filter === it.key) return;
        haptic('tick');
        setFilter(it.key);
      });
      seg.appendChild(chip);
    });

    // Viele eigene Kategorien: Leiste scrollt, aktiver Chip bleibt sichtbar
    seg.scrollLeft = scrollLeft;
    seg.classList.toggle('is-scrollable', seg.scrollWidth > seg.clientWidth + 1);
    var active = seg.querySelector('[aria-pressed="true"]');
    if (active && seg.scrollWidth > seg.clientWidth + 1) {
      var left = active.offsetLeft - 12;
      var right = active.offsetLeft + active.offsetWidth + 12 - seg.clientWidth;
      if (seg.scrollLeft > left) seg.scrollLeft = left;
      else if (seg.scrollLeft < right) seg.scrollLeft = right;
    }
  }

  function setFilter(key) {
    ui.filter = key;
    ui.newCategory = null;
    savePrefs();
    transition(function () {
      renderHeader();
      renderView();
    }, null, 'list');
  }

  function matchesFilter(ex) {
    return ui.filter === 'all' || catOf(ex) === ui.filter;
  }

  /* Gruppen in fester Kategorie-Reihenfolge, "Ohne Kategorie" zuletzt */
  function groupByCategory(list) {
    var groups = allCategories().map(function (c) { return { key: c.key, label: c.label, items: [] }; });
    groups.push({ key: NONE, label: 'Ohne Kategorie', items: [] });
    var byKey = {};
    groups.forEach(function (g) { byKey[g.key] = g; });
    list.forEach(function (ex) { byKey[catOf(ex)].items.push(ex); });
    return groups.filter(function (g) { return g.items.length; });
  }

  function groupHead(g) {
    var h = applyCat(el('h2', 'group-head'), g.key);
    h.appendChild(el('span', 'chip-dot'));
    h.appendChild(el('span', null, g.label));
    h.appendChild(el('span', 'count', String(g.items.length)));
    return h;
  }

  /* Liste rendern: bei "Alle" nach Kategorie gruppiert, sonst flach */
  function renderGrouped(container, list, buildItem, stackClass) {
    if (ui.filter === 'all') {
      groupByCategory(list).forEach(function (g) {
        container.appendChild(groupHead(g));
        if (g.key === NONE && ui.view === 'exercises') {
          container.appendChild(el('p', 'group-note', 'Tippe eine Übung an, um ihr eine Kategorie zu geben.'));
        }
        var stack = el('div', stackClass);
        g.items.forEach(function (ex) { stack.appendChild(buildItem(ex)); });
        container.appendChild(stack);
      });
    } else {
      var flat = el('div', stackClass);
      list.forEach(function (ex) { flat.appendChild(buildItem(ex)); });
      container.appendChild(flat);
    }
  }

  function emptyState(iconName, title, text, actionText, onAction) {
    var box = el('div', 'empty');
    var ico = el('div', 'empty-ico');
    ico.appendChild(icon(iconName));
    box.appendChild(ico);
    box.appendChild(el('h2', null, title));
    box.appendChild(el('p', null, text));
    if (actionText) {
      var b = btn('btn-primary', actionText, 'plus');
      b.addEventListener('click', onAction);
      box.appendChild(b);
    }
    return box;
  }

  function goCreateExercise(category) {
    if (category && isCategory(category)) ui.newCategory = category;
    show('exercises', function () {
      var input = $('exercise-add-name');
      input.focus();
    });
  }

  /* ================= Navigation ================= */

  var VIEW_IDS = {
    training: 'view-training',
    exercises: 'view-exercises',
    exerciseDetail: 'view-exercise-detail',
    stats: 'view-stats',
    settings: 'view-settings'
  };

  function applyView(view) {
    ui.view = view;
    Object.keys(VIEW_IDS).forEach(function (v) { $(VIEW_IDS[v]).hidden = v !== view; });
    var tabView = view === 'exerciseDetail' ? 'exercises' : view;
    document.querySelectorAll('.tab').forEach(function (t) {
      if (t.dataset.view === tabView) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    renderHeader();
    renderView();
    window.scrollTo(0, 0);
  }

  function show(view, after) {
    transition(function () { applyView(view); }, after, 'nav');
  }

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      var view = t.dataset.view;
      if (view === ui.view) { window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' }); return; }
      haptic('tick');
      show(view);
    });
  });

  function renderView() {
    if (ui.view === 'training') renderTraining();
    else if (ui.view === 'exercises') renderExercises();
    else if (ui.view === 'exerciseDetail') renderDetail();
    else if (ui.view === 'stats') renderStats();
    else renderSettings();
  }

  function render() {
    renderHeader();
    renderView();
    updateDock();
  }

  /* Schatten unter der Kopfzeile, sobald gescrollt wird */
  window.addEventListener('scroll', function () {
    $('app-header').classList.toggle('is-scrolled', window.scrollY > 4);
  }, { passive: true });

  /* Kopfzeilenhöhe für scroll-margin der Karten */
  if (window.ResizeObserver) {
    new ResizeObserver(function (entries) {
      var h = entries[0].contentRect.height;
      document.documentElement.style.setProperty('--header-h', Math.round(h) + 'px');
    }).observe($('app-header'));
  }

  /* ================= View: Training ================= */

  function changeDate(iso) {
    if (iso === ui.date) return;
    haptic('tick');
    ui.date = iso;
    ui.editing = null;
    ui.draft = null;
    transition(function () {
      renderHeader();
      renderTraining();
    }, null, 'list');
  }

  function renderTraining() {
    var list = $('training-list');
    list.textContent = '';

    if (!data.exercises.length) {
      list.appendChild(emptyState('barbell', 'Noch keine Übungen',
        'Leg deine Geräte und Übungen einmal an. Danach trägst du hier jeden Satz mit zwei Tipps ein.',
        'Erste Übung anlegen', function () { goCreateExercise(null); }));
      return;
    }

    list.appendChild(buildDayCard());

    var items = data.exercises.filter(matchesFilter);
    if (!items.length) {
      var label = catLabel(ui.filter);
      list.appendChild(emptyState('list', 'Keine Übungen für ' + label,
        'Leg eine Übung in dieser Kategorie an oder wähle oben eine andere.',
        'Übung für ' + label + ' anlegen', function () { goCreateExercise(ui.filter); }));
      return;
    }

    if (ui.openId && !getExercise(ui.openId)) ui.openId = null;
    renderGrouped(list, items, buildTrainingItem, 'ex-stack');
  }

  /* Tageskarte: Tagesziel mit Fortschritt, Sätze, Übungen, Dauer */
  function buildDayCard() {
    var sum = daySummary(ui.date);
    var prog = goalProgress(ui.date, sum);
    var isToday = ui.date === todayISO();
    var card = el('section', 'day-card' + (prog && prog.done ? ' is-done' : ''));
    card.setAttribute('aria-label', 'Tagesübersicht');

    var top = el('div', 'day-top');
    var main = el('div', 'day-main');
    if (prog) {
      var label = el('span', 'day-label');
      label.appendChild(icon(prog.done ? 'check' : 'target'));
      label.appendChild(document.createTextNode(prog.done ? 'Tagesziel erreicht' : 'Tagesziel'));
      main.appendChild(label);
      var line = el('p', 'day-goal');
      line.appendChild(el('b', null, goalValueText(prog.goal.type, prog.current)));
      line.appendChild(el('span', 'of', ' / ' + goalValueText(prog.goal.type, prog.goal.value) + ' ' + goalUnit(prog.goal.type)));
      main.appendChild(line);
    } else {
      main.appendChild(el('span', 'day-label', isToday ? 'Heute' : 'An diesem Tag'));
      main.appendChild(el('p', 'day-goal', sum.sets ? formatNum(sum.volume, 0) + ' kg Volumen' : 'Noch kein Satz'));
    }
    top.appendChild(main);
    var edit = btn('btn-chip', prog ? 'Ziel ändern' : 'Tagesziel setzen', 'target');
    edit.addEventListener('click', function () { openGoalSheet(ui.date); });
    top.appendChild(edit);
    card.appendChild(top);

    if (prog) {
      var track = el('div', 'goal-track');
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-label', 'Fortschritt Tagesziel');
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', String(prog.goal.value));
      track.setAttribute('aria-valuenow', String(Math.round(prog.current)));
      var fill = el('div', 'goal-fill');
      var target = Math.min(1, prog.ratio);
      var from = ui.goalAnimFrom;
      ui.goalAnimFrom = null;
      if (from !== null && from !== target && !reduceMotion.matches) {
        fill.style.transform = 'scaleX(' + from + ')';
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { fill.style.transform = 'scaleX(' + target + ')'; });
        });
      } else {
        fill.style.transform = 'scaleX(' + target + ')';
      }
      track.appendChild(fill);
      card.appendChild(track);
    }

    var parts = [];
    if (sum.sets) {
      parts.push(plural(sum.sets, 'Satz', 'Sätze'));
      parts.push(plural(sum.exercises, 'Übung', 'Übungen'));
      if (prog && prog.goal.type === 'sets') parts.push(formatNum(sum.volume, 0) + ' kg');
      if (sum.minutes !== null) parts.push(formatMinutes(sum.minutes));
    }
    if (prog && !prog.done) {
      parts.push('noch ' + goalValueText(prog.goal.type, prog.goal.value - prog.current) + ' ' + goalUnit(prog.goal.type));
    }
    if (parts.length) card.appendChild(el('p', 'day-stats', parts.join(' · ')));
    return card;
  }

  function trainingMeta(ex, sets) {
    var meta = el('span', 'ex-meta');
    if (sets.length) {
      var top = topSet(sets);
      meta.textContent = plural(sets.length, 'Satz', 'Sätze') + ' · Top ' + formatWeight(top.weight) + ' kg';
      return meta;
    }
    var last = lastSession(ex.id, ui.date);
    if (last) {
      var t = topSet(last.sets);
      meta.textContent = relativeDay(last.date) + ' · ' + setText(t);
    } else {
      meta.textContent = 'Noch nicht trainiert';
    }
    return meta;
  }

  function buildTrainingItem(ex) {
    var log = data.logs[ex.id] || {};
    var sets = log[ui.date] || [];
    var open = ui.openId === ex.id;

    var item = el('article', 'ex' + (open ? ' is-open' : ''));
    applyCat(item, catOf(ex));
    item.dataset.id = ex.id;
    item.style.viewTransitionName = vtName('tr', ex.id);

    var head = el('div', 'ex-head');
    head.appendChild(buildPhotoButton(ex));

    var toggle = el('button', 'ex-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(open));
    var text = el('span', 'ex-text');
    text.appendChild(el('span', 'ex-name', ex.name));
    text.appendChild(trainingMeta(ex, sets));
    toggle.appendChild(text);

    var status = el('span', 'ex-status');
    if (sets.length) {
      var pill = el('span', 'done-pill');
      pill.appendChild(icon('check'));
      pill.appendChild(el('span', null, String(sets.length)));
      pill.setAttribute('aria-label', plural(sets.length, 'Satz', 'Sätze') + ' erledigt');
      status.appendChild(pill);
    }
    status.appendChild(icon('chevron-down', 'chev'));
    toggle.appendChild(status);
    toggle.addEventListener('click', function () { toggleOpen(ex.id); });
    head.appendChild(toggle);
    item.appendChild(head);

    if (open) item.appendChild(buildLogPanel(ex, sets));
    return item;
  }

  function toggleOpen(exId) {
    haptic('tap');
    var opening = ui.openId !== exId;
    transition(function () {
      ui.openId = opening ? exId : null;
      ui.editing = null;
      ui.draft = null;
      renderTraining();
    }, function () {
      if (!opening) return;
      var card = document.querySelector('.ex[data-id="' + exId + '"]');
      if (card) card.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    });
  }

  /* Vorbelegung der Stepper: heute schon trainiert -> letzter Satz von heute,
     sonst der erste Satz vom letzten Mal (Arbeitsgewicht statt Abwärtssatz). */
  function prefillValues(exId) {
    var log = data.logs[exId] || {};
    var todaySets = log[ui.date];
    if (todaySets && todaySets.length) return todaySets[todaySets.length - 1];
    var last = lastSession(exId, ui.date);
    if (last) return last.sets[0];
    var dates = Object.keys(log).sort();
    for (var i = dates.length - 1; i >= 0; i--) {
      var sets = log[dates[i]];
      if (sets && sets.length) return sets[sets.length - 1];
    }
    return null;
  }

  function getDraft(ex) {
    if (ui.draft && ui.draft.exId === ex.id && ui.draft.date === ui.date) return ui.draft;
    var pre = prefillValues(ex.id);
    ui.draft = { exId: ex.id, date: ui.date, weight: pre ? pre.weight : 20, reps: pre ? pre.reps : 10 };
    return ui.draft;
  }

  function isValidSet(w, r) {
    return isFinite(w) && w > 0 && isFinite(r) && r > 0 && r === Math.round(r);
  }

  function recordBadge(kind) {
    var badge = el('span', 'badge-pr ' + (kind === 'weight' ? 'is-record' : 'is-best'));
    badge.appendChild(icon(kind === 'weight' ? 'trophy' : 'trend'));
    badge.appendChild(document.createTextNode(kind === 'weight' ? 'Rekord' : 'Bestleistung'));
    badge.title = kind === 'weight' ? 'Neuer Rekord: so schwer wie nie zuvor' : 'Bestleistung: bestes geschätztes 1RM (mehr Wiederholungen)';
    return badge;
  }

  function buildLogPanel(ex, sets) {
    var form = el('form', 'log');
    form.noValidate = true;
    var editing = ui.editing && ui.editing.exId === ex.id && ui.editing.date === ui.date ? ui.editing : null;
    var recs = computeRecords(ex.id);
    var marks = recs.marks[ui.date] || {};

    if (ex.note) {
      var note = el('p', 'log-note');
      note.appendChild(icon('note'));
      note.appendChild(el('span', null, ex.note));
      form.appendChild(note);
    }

    // Referenz: letztes Mal und persönlicher Rekord
    var last = lastSession(ex.id, ui.date);
    var ref = el('div', 'log-ref');
    if (last) {
      var lastLine = el('p');
      lastLine.appendChild(el('b', null, 'Letztes Mal'));
      lastLine.appendChild(document.createTextNode(' (' + relativeDay(last.date, true) + '): ' +
        last.sets.map(function (s) { return formatWeight(s.weight) + ' × ' + s.reps; }).join(' · ')));
      ref.appendChild(lastLine);
    } else if (!sets.length) {
      ref.appendChild(el('p', null, 'Erster Satz für diese Übung. Gewicht und Wiederholungen einstellen, dann eintragen.'));
    }
    if (recs.record) {
      var recLine = el('p', 'log-rec');
      recLine.appendChild(icon('trophy'));
      recLine.appendChild(el('b', null, 'Rekord '));
      recLine.appendChild(document.createTextNode(setText(recs.record) + ' (' + formatISO(recs.record.date, true) + ')'));
      ref.appendChild(recLine);
    }
    if (ref.childNodes.length) form.appendChild(ref);

    if (sets.length) {
      var ol = el('ol', 'sets');
      ol.setAttribute('aria-label', 'Sätze heute');
      sets.forEach(function (s, idx) {
        ol.appendChild(buildSetRow(ex, s, idx, marks[idx], editing && editing.index === idx));
      });
      form.appendChild(ol);
    }

    var draft = getDraft(ex);
    var logBtn = el('button', 'btn-primary');
    logBtn.type = 'submit';
    logBtn.textContent = editing ? 'Satz ' + (editing.index + 1) + ' speichern' : 'Satz ' + (sets.length + 1) + ' eintragen';

    function sync() { logBtn.disabled = !isValidSet(draft.weight, draft.reps); }

    var steppers = el('div', 'steppers');
    steppers.appendChild(buildStepper(draft, { field: 'weight', step: 2.5, unit: 'kg', label: 'Gewicht', decimal: true }, sync));
    steppers.appendChild(buildStepper(draft, { field: 'reps', step: 1, unit: 'Wdh.', label: 'Wiederholungen', decimal: false }, sync));
    form.appendChild(steppers);

    var actions = el('div', 'log-actions');
    if (editing) {
      var cancel = btn('btn-secondary', 'Abbrechen');
      cancel.addEventListener('click', function () {
        haptic('tick');
        transition(function () {
          ui.editing = null;
          ui.draft = null;
          renderTraining();
        });
      });
      actions.appendChild(cancel);
    }
    actions.appendChild(logBtn);
    form.appendChild(actions);
    if (!editing) form.appendChild(buildRestLine(ex, sets.length));
    sync();

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!isValidSet(draft.weight, draft.reps)) return;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (editing) saveEdit(ex, editing, draft);
      else addSet(ex, draft);
    });
    return form;
  }

  /* Hinweis unter dem Eintragen-Button: welche Pause danach startet */
  function buildRestLine(ex, setCount) {
    var row = el('div', 'log-rest');
    var sec = restFor(ex);
    var change = btn('rest-link');
    change.appendChild(icon('timer'));
    if (sec <= 0) {
      change.appendChild(document.createTextNode('Ohne Pausentimer'));
    } else if (data.settings.restAuto) {
      change.appendChild(document.createTextNode('Danach ' + formatSecs(sec) + ' Pause'));
    } else {
      change.appendChild(document.createTextNode('Pause: ' + formatSecs(sec)));
    }
    change.setAttribute('aria-label', 'Pausendauer für ' + ex.name + ' ändern');
    change.addEventListener('click', function () { openRestSheet(ex); });
    row.appendChild(change);
    if (sec > 0 && !data.settings.restAuto) {
      var start = btn('btn-chip', 'Pause starten');
      start.addEventListener('click', function () {
        haptic('tap');
        startRest(ex.id, setCount + 1, sec);
      });
      row.appendChild(start);
    }
    return row;
  }

  function buildSetRow(ex, s, idx, mark, isEditing) {
    var li = el('li', 'set' + (isEditing ? ' is-editing' : ''));
    var f = ui.flash;
    if (f && f.exId === ex.id && f.date === ui.date && f.index === idx) li.classList.add('is-new');

    var main = el('button', 'set-main');
    main.type = 'button';
    main.setAttribute('aria-label', 'Satz ' + (idx + 1) + ': ' + setText(s) +
      (mark === 'weight' ? ', neuer Rekord' : mark === 'best' ? ', Bestleistung' : '') + '. Bearbeiten');
    main.appendChild(el('span', 'set-no', String(idx + 1)));
    var val = el('span', 'set-val');
    val.appendChild(document.createTextNode(formatWeight(s.weight)));
    val.appendChild(el('span', 'u', ' kg'));
    val.appendChild(el('span', 'x', '×'));
    val.appendChild(document.createTextNode(String(s.reps)));
    main.appendChild(val);
    if (mark) main.appendChild(recordBadge(mark));
    main.addEventListener('click', function () {
      if (isEditing) {
        transition(function () { ui.editing = null; ui.draft = null; renderTraining(); });
        return;
      }
      haptic('tap');
      transition(function () {
        ui.editing = { exId: ex.id, date: ui.date, index: idx };
        ui.draft = { exId: ex.id, date: ui.date, weight: s.weight, reps: s.reps };
        renderTraining();
      });
    });
    li.appendChild(main);

    var del = btn('set-del', null, 'x', 'Satz ' + (idx + 1) + ' löschen');
    del.addEventListener('click', function () { deleteSet(ex, idx); });
    li.appendChild(del);
    return li;
  }

  /* Stepper: −/+ (gedrückt halten wiederholt schneller), Zahl direkt antippbar */
  function buildStepper(draft, opts, onChange) {
    var f = opts.field;
    var max = opts.max || 999;
    var wrap = el('div', 'stepper');

    var minus = btn('step-btn', null, 'minus', opts.label + ' verringern');
    var plus = btn('step-btn', null, 'plus', opts.label + ' erhöhen');

    var field = el('label', 'step-field');
    var input = el('input', 'step-input');
    input.type = 'text';
    input.inputMode = opts.decimal ? 'decimal' : 'numeric';
    input.autocomplete = 'off';
    input.enterKeyHint = 'done';
    input.setAttribute('aria-label', opts.label + ' (' + opts.unit + ')');
    field.appendChild(input);
    field.appendChild(el('span', 'step-unit', opts.unit));

    function fmt(v) {
      if (opts.decimal) return formatWeight(v);
      return opts.thousands ? v.toLocaleString('de-DE') : String(v);
    }
    function parse(s) {
      if (opts.thousands) s = s.replace(/\./g, '');
      return parseFloat(s.replace(',', '.'));
    }
    function show() {
      input.value = fmt(draft[f]);
      input.style.width = Math.max(1, input.value.length) + 0.3 + 'ch';
      minus.disabled = draft[f] <= 0;
    }
    function clean(v) {
      v = Math.max(0, Math.min(max, v));
      return opts.decimal ? Math.round(v * 100) / 100 : Math.round(v);
    }
    function stepBy(dir) {
      var cur = draft[f];
      var s = opts.step;
      // auf das Raster einrasten (z. B. 61 -> 62,5 bzw. 60)
      var next = dir > 0 ? Math.floor(cur / s + 1e-9) * s + s : Math.ceil(cur / s - 1e-9) * s - s;
      next = clean(next);
      if (next === cur) return false;
      draft[f] = next;
      show();
      tick(input, dir);
      onChange();
      return true;
    }

    input.addEventListener('focus', function () { input.select(); });
    input.addEventListener('input', function () {
      var v = parse(input.value);
      input.style.width = Math.max(1, input.value.length) + 0.3 + 'ch';
      draft[f] = isFinite(v) ? clean(v) : NaN;
      minus.disabled = !(draft[f] > 0);
      onChange();
    });
    input.addEventListener('blur', function () {
      if (!isFinite(draft[f])) draft[f] = 0;
      show();
      onChange();
    });

    holdRepeat(minus, function () { return stepBy(-1); });
    holdRepeat(plus, function () { return stepBy(1); });

    wrap.appendChild(minus);
    wrap.appendChild(field);
    wrap.appendChild(plus);
    wrap.setValue = function (v) { draft[f] = clean(v); show(); onChange(); };
    show();
    return wrap;
  }

  function holdRepeat(button, fn) {
    var timerId = null;
    var delay = 0;
    function stop() {
      clearTimeout(timerId);
      timerId = null;
      button.classList.remove('is-pressed');
    }
    function loop() {
      if (!fn()) { stop(); return; }
      haptic('tick');
      delay = Math.max(40, delay * 0.8);
      timerId = setTimeout(loop, delay);
    }
    button.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || button.disabled) return;
      e.preventDefault();
      button.classList.add('is-pressed');
      if (fn()) haptic('tick');
      delay = 160;
      timerId = setTimeout(loop, 420);
      try { button.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) {
      button.addEventListener(ev, stop);
    });
    // Tastatur (Enter/Leertaste) löst nur click aus
    button.addEventListener('click', function (e) {
      if (e.detail === 0 && fn()) haptic('tick');
    });
    button.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function addSet(ex, draft) {
    var date = ui.date;
    var goalBefore = goalProgress(date);
    if (!data.logs[ex.id]) data.logs[ex.id] = {};
    var day = data.logs[ex.id][date] || (data.logs[ex.id][date] = []);
    var set = { weight: draft.weight, reps: draft.reps };
    if (date === todayISO()) set.t = Date.now();
    day.push(set);
    saveData();

    var idx = day.length - 1;
    var recs = computeRecords(ex.id);
    var mark = (recs.marks[date] || {})[idx];
    var event = null;
    if (mark === 'weight') {
      recs.events.forEach(function (e) { if (e.date === date && e.index === idx) event = e; });
    }
    var goalAfter = goalProgress(date);
    var goalReached = goalAfter && goalAfter.done && !(goalBefore && goalBefore.done);
    if (goalBefore) ui.goalAnimFrom = Math.min(1, goalBefore.ratio);

    haptic(mark === 'weight' ? 'record' : mark ? 'success' : 'tap');
    if (mark === 'weight' && data.settings.sound) Sound.record();

    // Pausentimer für den nächsten Satz
    var sec = restFor(ex);
    if (data.settings.restAuto && sec > 0) startRest(ex.id, idx + 2, sec);

    transition(function () {
      ui.flash = { exId: ex.id, date: date, index: idx };
      renderTraining();
    }, function () {
      ui.flash = null;
      var card = document.querySelector('.ex[data-id="' + ex.id + '"]');
      if (card) card.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      if (event) {
        Confetti.celebrate(card && card.querySelector('.set.is-new .badge-pr, .set:last-child .badge-pr'));
        toast('Neuer Rekord: ' + formatWeight(event.weight) + ' kg (vorher ' + formatWeight(event.prev) + ' kg)', null, null, 'record');
      } else if (goalReached) {
        var dayCard = document.querySelector('.day-card');
        Confetti.fromElement(dayCard, { count: 70, spread: 1.4, power: 0.8 });
        toast('Tagesziel erreicht: ' + goalText(goalAfter.goal), null, null, 'record');
      }
    });
  }

  function saveEdit(ex, editing, draft) {
    var day = (data.logs[ex.id] || {})[editing.date];
    if (!day || !day[editing.index]) return;
    var old = day[editing.index];
    var updated = { weight: draft.weight, reps: draft.reps };
    if (old.t) updated.t = old.t;
    day[editing.index] = updated;
    saveData();
    haptic('tap');
    transition(function () {
      ui.editing = null;
      ui.draft = null;
      ui.flash = { exId: ex.id, date: editing.date, index: editing.index };
      renderTraining();
    }, function () { ui.flash = null; });
  }

  function deleteSet(ex, idx) {
    var date = ui.date;
    var day = (data.logs[ex.id] || {})[date];
    if (!day) return;
    var removed = day.splice(idx, 1)[0];
    if (!day.length) delete data.logs[ex.id][date];
    saveData();
    haptic('tap');
    transition(function () {
      ui.editing = null;
      renderTraining();
    });
    toast('Satz ' + (idx + 1) + ' gelöscht', 'Rückgängig', function () {
      var log = data.logs[ex.id] || (data.logs[ex.id] = {});
      var d = log[date] || (log[date] = []);
      d.splice(Math.min(idx, d.length), 0, removed);
      saveData();
      transition(render);
    });
  }

  /* ================= Tagesziel-Sheet ================= */

  /* date = null bearbeitet das Standard-Ziel für alle Tage */
  function openGoalSheet(date) {
    var isDefault = !date;
    var current = isDefault ? data.settings.goalDefault : goalFor(date);
    var lastValue = { volume: 6000, sets: 20 };
    if (current) lastValue[current.type] = current.value;
    var state = {
      type: current ? current.type : 'volume',
      remember: !isDefault && !data.settings.goalDefault
    };
    var title = isDefault ? 'Standard-Tagesziel'
      : 'Tagesziel ' + (date === todayISO() ? 'für heute' : 'für ' + formatISOLong(date));

    openSheet(title, function (body, close) {
      var seg = el('div', 'segmented');
      var valueBox = el('div', 'sheet-value');
      var rememberBox = el('div');
      var saveBtn = btn('btn-primary sheet-save', 'Ziel speichern');

      [{ key: 'volume', label: 'Volumen' }, { key: 'sets', label: 'Sätze' }, { key: 'none', label: 'Kein Ziel' }].forEach(function (o) {
        var b = btn(null, o.label);
        b.setAttribute('aria-pressed', String(state.type === o.key));
        b.addEventListener('click', function () {
          haptic('tick');
          state.type = o.key;
          seg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
          renderValue();
        });
        seg.appendChild(b);
      });

      function renderValue() {
        valueBox.textContent = '';
        rememberBox.textContent = '';
        saveBtn.disabled = false;
        if (state.type === 'none') {
          valueBox.appendChild(el('p', 'sheet-note', isDefault
            ? 'Ohne Standard startet jeder Tag ohne Ziel. Für einzelne Tage kannst du trotzdem eins setzen.'
            : 'An diesem Tag gibt es kein Ziel.'));
          saveBtn.textContent = 'Speichern';
          return;
        }
        saveBtn.textContent = 'Ziel speichern';
        var vol = state.type === 'volume';
        var draft = { value: lastValue[state.type] };
        var presetRow = null;
        var stepper = buildStepper(draft, {
          field: 'value', step: vol ? 250 : 1, unit: vol ? 'kg' : 'Sätze', label: 'Ziel',
          decimal: false, thousands: vol, max: vol ? 100000 : 200
        }, function () {
          lastValue[state.type] = draft.value;
          saveBtn.disabled = !(draft.value > 0);
          if (presetRow) {
            presetRow.querySelectorAll('button').forEach(function (x) {
              x.setAttribute('aria-pressed', String(+x.dataset.v === draft.value));
            });
          }
        });
        valueBox.appendChild(stepper);
        var presets = vol ? [3000, 4000, 5000, 6000, 8000, 10000] : [10, 12, 16, 20, 24, 30];
        presetRow = chipRow(presets.map(function (p) { return { v: p, label: vol ? formatNum(p, 0) : String(p) }; }),
          function (o) { return o.v === draft.value; },
          function (o) { stepper.setValue(o.v); });
        presetRow.querySelectorAll('button').forEach(function (x, i) { x.dataset.v = String(presets[i]); });
        valueBox.appendChild(presetRow);
        if (!isDefault) {
          rememberBox.appendChild(switchRow('Als Standard für alle Tage', 'Neue Tage starten mit diesem Ziel.', state.remember, function (on) { state.remember = on; }));
        }
      }

      saveBtn.addEventListener('click', function () {
        var g = state.type === 'none' ? null : { type: state.type, value: lastValue[state.type] };
        if (g && !(g.value > 0)) return;
        var before = isDefault ? null : goalProgress(date);
        if (isDefault) {
          setDefaultGoal(g);
        } else {
          data.goals[date] = g;
          if (state.remember && g) setDefaultGoal(g);
        }
        saveData();
        haptic('tap');
        ui.goalAnimFrom = before ? Math.min(1, before.ratio) : 0;
        close();
        transition(render);
      });

      body.appendChild(seg);
      body.appendChild(valueBox);
      body.appendChild(rememberBox);
      body.appendChild(saveBtn);
      renderValue();
    });
  }

  /* ================= Kategorien-Sheet ================= */

  function nextFreeColor() {
    var used = data.categories.map(function (c) { return c.color; });
    for (var i = 0; i < CUSTOM_COLORS.length; i++) if (used.indexOf(CUSTOM_COLORS[i]) < 0) return CUSTOM_COLORS[i];
    return CUSTOM_COLORS[data.categories.length % CUSTOM_COLORS.length];
  }

  function openCategorySheet(cat, onDone) {
    var isNew = !cat;
    var state = { color: cat ? cat.color : nextFreeColor() };
    openSheet(isNew ? 'Neue Kategorie' : 'Kategorie bearbeiten', function (body, close) {
      var form = el('form', 'sheet-form');
      form.noValidate = true;
      var label = el('label', 'field-label', 'Name');
      label.htmlFor = 'cat-name';
      var input = el('input', 'text-input');
      input.id = 'cat-name';
      input.type = 'text';
      input.maxLength = 24;
      input.autocomplete = 'off';
      input.placeholder = 'z. B. Schultern';
      input.value = cat ? cat.label : '';
      var hint = el('p', 'form-hint');
      hint.setAttribute('role', 'alert');

      var swLabel = el('p', 'field-label', 'Farbe');
      var swatches = el('div', 'swatches');
      swatches.setAttribute('role', 'radiogroup');
      swatches.setAttribute('aria-label', 'Farbe');
      CUSTOM_COLORS.forEach(function (c) {
        var b = btn('swatch');
        b.style.setProperty('--cat', 'var(--cc-' + c + ')');
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(state.color === c));
        b.setAttribute('aria-label', 'Farbe ' + c);
        b.addEventListener('click', function () {
          haptic('tick');
          state.color = c;
          swatches.querySelectorAll('.swatch').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
        });
        swatches.appendChild(b);
      });

      var actions = el('div', 'sheet-actions');
      if (!isNew) {
        var count = data.exercises.filter(function (e) { return e.category === cat.key; }).length;
        var del = btn('btn-secondary danger-text', 'Löschen', 'trash');
        del.addEventListener('click', function () {
          var msg = '„' + cat.label + '“ löschen?' + (count ? ' ' + plural(count, 'Übung landet', 'Übungen landen') + ' unter „Ohne Kategorie“.' : '');
          if (!confirm(msg)) return;
          data.categories = data.categories.filter(function (c) { return c.key !== cat.key; });
          data.exercises.forEach(function (e) { if (e.category === cat.key) delete e.category; });
          if (ui.filter === cat.key) ui.filter = 'all';
          if (ui.newCategory === cat.key) ui.newCategory = null;
          saveData();
          savePrefs();
          close();
          transition(render);
          toast('Kategorie „' + cat.label + '“ gelöscht');
        });
        actions.appendChild(del);
      }
      var save = el('button', 'btn-primary', isNew ? 'Kategorie anlegen' : 'Speichern');
      save.type = 'submit';
      actions.appendChild(save);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = input.value.trim().slice(0, 24);
        if (!name) { hint.textContent = 'Gib der Kategorie einen Namen.'; input.focus(); return; }
        var clash = allCategories().some(function (c) {
          return c.label.toLowerCase() === name.toLowerCase() && (!cat || c.key !== cat.key);
        });
        if (clash) { hint.textContent = '„' + name + '“ gibt es schon.'; input.focus(); return; }
        var key;
        if (isNew) {
          key = uid('c');
          data.categories.push({ key: key, label: name, color: state.color });
        } else {
          key = cat.key;
          cat.label = name;
          cat.color = state.color;
        }
        saveData();
        haptic('success');
        close();
        if (onDone) onDone(key);
        transition(render);
      });

      form.appendChild(label);
      form.appendChild(input);
      form.appendChild(swLabel);
      form.appendChild(swatches);
      form.appendChild(hint);
      form.appendChild(actions);
      body.appendChild(form);
    });
  }

  /* ================= View: Übungen ================= */

  function buildCatPicker(container, selected, onPick, withAdd) {
    container.textContent = '';
    allCategories().forEach(function (c) {
      var opt = applyCat(btn('cat-option'), c.key);
      opt.setAttribute('role', 'radio');
      opt.setAttribute('aria-checked', String(selected === c.key));
      opt.appendChild(el('span', 'chip-dot'));
      opt.appendChild(el('span', 'chip-label', c.label));
      opt.addEventListener('click', function () {
        haptic('tick');
        onPick(c.key);
      });
      container.appendChild(opt);
    });
    if (withAdd) {
      var add = btn('cat-option cat-add', null, null, 'Neue Kategorie anlegen');
      add.appendChild(icon('plus'));
      add.appendChild(el('span', 'chip-label', 'Neu'));
      add.addEventListener('click', function () {
        openCategorySheet(null, function (key) { onPick(key); });
      });
      container.appendChild(add);
    }
    container.classList.toggle('is-scrollable', container.scrollWidth > container.clientWidth + 1);
  }

  function renderAddPicker() {
    var selected = ui.newCategory || (isCategory(ui.filter) ? ui.filter : null);
    buildCatPicker($('add-cats'), selected, function (key) {
      ui.newCategory = key;
      $('add-hint').textContent = '';
      renderAddPicker();
    }, true);
  }

  $('exercise-add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('exercise-add-name');
    var hint = $('add-hint');
    var name = input.value.trim();
    if (!name) {
      hint.textContent = 'Gib der Übung einen Namen.';
      input.focus();
      return;
    }
    var cat = ui.newCategory || (isCategory(ui.filter) ? ui.filter : null);
    if (!cat) {
      hint.textContent = 'Wähle eine Kategorie für „' + name + '“.';
      var picker = $('add-cats');
      picker.classList.remove('is-nudged');
      void picker.offsetWidth;
      picker.classList.add('is-nudged');
      haptic('tap');
      return;
    }
    hint.textContent = '';
    var ex = { id: uid('ex'), name: name, category: cat, createdAt: todayISO() };
    data.exercises.push(ex);
    saveData();
    input.value = '';
    ui.newCategory = cat;
    ui.newId = ex.id;
    if (ui.filter !== 'all' && ui.filter !== cat) ui.filter = cat;
    savePrefs();
    haptic('success');
    transition(function () {
      renderHeader();
      renderExercises();
    }, function () { ui.newId = null; });
    toast('„' + name + '“ angelegt (' + catLabel(cat) + ')');
  });

  function renderExercises() {
    renderAddPicker();
    var list = $('exercise-list');
    list.textContent = '';
    if (!data.exercises.length) {
      list.appendChild(emptyState('camera', 'Deine Geräte, auf einen Blick',
        'Name eingeben, Kategorie wählen, anlegen. Danach kannst du für jede Übung ein Foto vom Gerät machen.'));
      return;
    }
    var items = data.exercises.filter(matchesFilter);
    if (!items.length) {
      list.appendChild(emptyState('list', 'Keine Übungen für ' + catLabel(ui.filter), 'Leg oben die erste an.'));
      return;
    }
    renderGrouped(list, items, buildListRow, 'list-stack');
  }

  function buildListRow(ex) {
    var row = el('button', 'row' + (ui.newId === ex.id ? ' is-new' : ''));
    row.type = 'button';
    applyCat(row, catOf(ex));
    row.dataset.id = ex.id;
    row.style.viewTransitionName = vtName('ls', ex.id);

    var thumb = buildThumb(ex.id);
    row.appendChild(thumb);

    var text = el('span', 'ex-text');
    text.appendChild(el('span', 'ex-name', ex.name));
    var last = lastTrainedDate(ex.id);
    var rec = computeRecords(ex.id).record;
    var meta = el('span', 'ex-meta');
    if (rec) {
      meta.appendChild(icon('trophy', 'meta-ico'));
      meta.appendChild(document.createTextNode(formatWeight(rec.weight) + ' kg · zuletzt ' + relativeDay(last, true)));
    } else {
      meta.textContent = 'Noch nicht trainiert';
    }
    text.appendChild(meta);
    row.appendChild(text);
    row.appendChild(icon('chevron-right', 'chev'));

    row.addEventListener('click', function () { openDetail(ex.id, thumb); });
    return row;
  }

  /* ================= View: Übungsdetail ================= */

  function openDetail(exId, fromThumb) {
    haptic('tap');
    ui.detailId = exId;
    ui.renaming = false;
    morph(fromThumb, function () { applyView('exerciseDetail'); }, function () {
      return $('detail-photo').querySelector('.photo-frame, .photo-empty');
    }, 'hero', 'push');
  }

  function closeDetail() {
    haptic('tick');
    var exId = ui.detailId;
    var from = $('detail-photo').querySelector('.photo-frame, .photo-empty');
    morph(from, function () { applyView('exercises'); }, function () {
      var row = document.querySelector('.row[data-id="' + exId + '"]');
      if (!row) return null;
      row.scrollIntoView({ block: 'nearest' });
      return row.querySelector('.thumb');
    }, 'hero', 'pop');
  }

  function deleteExercise() {
    var ex = getExercise(ui.detailId);
    if (!ex) return;
    if (!confirm('„' + ex.name + '“ mit allen Trainingsdaten und Foto löschen? Das lässt sich nicht rückgängig machen.')) return;
    data.exercises = data.exercises.filter(function (e) { return e.id !== ex.id; });
    delete data.logs[ex.id];
    saveData();
    removePhoto(ex.id);
    if (ui.openId === ex.id) ui.openId = null;
    if (timer && timer.exId === ex.id) stopRest();
    show('exercises');
    toast('„' + ex.name + '“ gelöscht');
  }

  function renderDetailHead(ex) {
    var head = $('detail-head');
    head.textContent = '';
    if (ui.renaming) {
      var form = el('form', 'rename-form');
      var input = el('input', 'text-input');
      input.id = 'rename-input';
      input.type = 'text';
      input.maxLength = 60;
      input.value = ex.name;
      input.setAttribute('aria-label', 'Neuer Name');
      input.enterKeyHint = 'done';
      var save = el('button', 'btn-primary', 'Speichern');
      save.type = 'submit';
      var cancel = btn('icon-btn', null, 'x', 'Umbenennen abbrechen');
      cancel.addEventListener('click', function () { ui.renaming = false; renderDetailHead(ex); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); ui.renaming = false; renderDetailHead(ex); }
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = input.value.trim();
        if (!name) { input.focus(); return; }
        ex.name = name;
        saveData();
        ui.renaming = false;
        haptic('tap');
        renderDetailHead(ex);
      });
      form.appendChild(input);
      form.appendChild(save);
      form.appendChild(cancel);
      head.appendChild(form);
    } else {
      var h = el('h1', 'detail-title', ex.name);
      h.id = 'detail-name';
      head.appendChild(h);
    }
  }

  function renderDetailCats(ex) {
    buildCatPicker($('detail-cats'), catOf(ex), function (key) {
      if (catOf(ex) === key) return;
      ex.category = key;
      saveData();
      renderDetailCats(ex);
    }, true);
  }

  function renderDetailPhoto(ex) {
    var box = $('detail-photo');
    box.textContent = '';
    var hasPhoto = !!photos[ex.id];

    if (hasPhoto) {
      var frame = el('button', 'photo-frame');
      frame.type = 'button';
      frame.setAttribute('aria-label', 'Foto groß anzeigen');
      var img = el('img');
      img.src = photos[ex.id];
      img.alt = 'Foto: ' + ex.name;
      frame.appendChild(img);
      frame.addEventListener('click', function () { openLightbox(ex.id, img); });
      box.appendChild(frame);
    } else {
      var empty = el('div', 'photo-empty');
      empty.appendChild(icon('camera'));
      empty.appendChild(el('b', null, 'Noch kein Foto vom Gerät'));
      empty.appendChild(el('span', null, 'Mit Foto erkennst du die Übung sofort wieder.'));
      box.appendChild(empty);
    }

    var actions = el('div', 'photo-actions');
    var cam = btn('btn-secondary', hasPhoto ? 'Neues Foto' : 'Foto aufnehmen', 'camera');
    cam.addEventListener('click', function () { pickPhoto(ex.id, true); });
    var gal = btn('btn-secondary', 'Aus Galerie', 'image');
    gal.addEventListener('click', function () { pickPhoto(ex.id, false); });
    actions.appendChild(cam);
    actions.appendChild(gal);
    if (hasPhoto) {
      var del = btn('icon-btn danger', null, 'trash', 'Foto entfernen');
      del.addEventListener('click', function () {
        var old = photos[ex.id];
        removePhoto(ex.id).then(function () {
          haptic('tap');
          transition(function () { renderDetailPhoto(ex); });
          toast('Foto entfernt', 'Rückgängig', function () {
            setPhoto(ex.id, old).then(function () { transition(render); });
          });
        });
      });
      actions.appendChild(del);
    }
    box.appendChild(actions);
  }

  function renderDetailFacts(ex) {
    var dl = $('detail-facts');
    dl.textContent = '';
    var log = data.logs[ex.id] || {};
    var days = Object.keys(log).filter(function (d) { return log[d] && log[d].length; });
    dl.hidden = !days.length;
    if (!days.length) return;
    var recs = computeRecords(ex.id);
    var rec = recs.record;
    dl.appendChild(fact('Rekord', formatWeight(rec.weight), 'kg', '× ' + rec.reps + ' · ' + formatISO(rec.date), 'is-record'));
    dl.appendChild(fact('Bestes 1RM', formatNum(recs.bestE1rm, recs.bestE1rm >= 100 ? 0 : 1), 'kg', 'geschätzt'));
    dl.appendChild(fact('Trainingstage', String(days.length), null, plural(recs.events.length, 'Rekord', 'Rekorde')));
  }

  function fact(label, value, unit, sub, cls) {
    var box = el('div', 'fact' + (cls ? ' ' + cls : ''));
    box.appendChild(el('dt', null, label));
    var dd = el('dd', null, value);
    if (unit) dd.appendChild(el('small', null, unit));
    box.appendChild(dd);
    if (sub) {
      var s = el('dd', 'fact-sub', typeof sub === 'string' ? sub : sub.text);
      if (sub.cls) s.classList.add(sub.cls);
      box.appendChild(s);
    }
    return box;
  }

  var noteTimer = null;
  $('detail-note').addEventListener('input', function () {
    var ex = getExercise(ui.detailId);
    if (!ex) return;
    var v = this.value.slice(0, 200);
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () {
      if (v.trim()) ex.note = v.trim(); else delete ex.note;
      saveData();
    }, 300);
  });

  function renderDetailExtra(ex) {
    var note = $('detail-note');
    if (document.activeElement !== note) note.value = ex.note || '';
    var box = $('detail-rest');
    box.textContent = '';
    var sec = restFor(ex);
    var row = btn('setting-row');
    var text = el('span', 'setting-text');
    text.appendChild(el('span', null, 'Pause nach jedem Satz'));
    text.appendChild(el('small', null, ex.rest === 0 ? 'Kein Pausentimer' :
      (isFinite(ex.rest) && ex.rest > 0 ? formatSecs(sec) + ' (eigene Einstellung)' : formatSecs(sec) + ' (Standard)')));
    row.appendChild(icon('timer'));
    row.appendChild(text);
    row.appendChild(icon('chevron-right', 'chev'));
    row.addEventListener('click', function () { openRestSheet(ex); });
    box.appendChild(row);
  }

  function renderDetail() {
    var ex = getExercise(ui.detailId);
    if (!ex) { applyView('exercises'); return; }
    renderDetailHead(ex);
    renderDetailCats(ex);
    renderDetailPhoto(ex);
    renderDetailFacts(ex);
    renderDetailExtra(ex);

    buildSegmented($('detail-metric-toggle'), METRICS, ui.detailMetric, function (key) {
      ui.detailMetric = key;
      transition(renderDetailChart);
    });
    renderDetailChart();

    var hist = $('detail-history');
    hist.textContent = '';
    var log = data.logs[ex.id] || {};
    var marks = computeRecords(ex.id).marks;
    var dates = Object.keys(log).sort().reverse();
    if (!dates.length) {
      hist.appendChild(el('li', 'empty-line', 'Noch keine Trainingstage.'));
    }
    dates.slice(0, 40).forEach(function (date) {
      var li = el('li');
      li.appendChild(el('span', 'h-date', formatISOLong(date)));
      li.appendChild(el('span', 'h-vol', formatNum(dayMetric(log[date], 'volume'), 0) + ' kg Volumen'));
      var setsBox = el('span', 'h-sets');
      log[date].forEach(function (s, i) {
        var m = marks[date] && marks[date][i];
        var chip = el('span', 'h-set' + (m === 'weight' ? ' rec' : m === 'best' ? ' pr' : ''));
        if (m === 'weight') chip.appendChild(icon('trophy'));
        chip.appendChild(document.createTextNode(formatWeight(s.weight) + ' × ' + s.reps));
        if (m) chip.title = m === 'weight' ? 'Rekord' : 'Bestleistung';
        setsBox.appendChild(chip);
      });
      li.appendChild(setsBox);
      hist.appendChild(li);
    });
  }

  function renderDetailChart() {
    var ex = getExercise(ui.detailId);
    if (!ex) return;
    var metric = ui.detailMetric;
    var series = exerciseSeries(ex.id, metric);
    $('detail-chart-empty').hidden = series.length > 0;
    setPressed($('detail-metric-toggle'), metric);
    drawChart($('detail-chart'), series, {
      hintEl: $('detail-chart-hint'),
      hintFormat: function (pt, isLast) {
        var v = metric === 'top' ? formatWeight(pt.value) : formatNum(pt.value, metric === 'volume' ? 0 : 1);
        return [(isLast ? 'Zuletzt ' : '') + formatISO(pt.date, true) + ': ', v + ' kg', ' ' + metricLabel(metric)];
      }
    });
  }

  function metricLabel(key) {
    for (var i = 0; i < METRICS.length; i++) if (METRICS[i].key === key) return METRICS[i].label;
    return key;
  }

  function buildSegmented(container, items, active, onChange) {
    container.textContent = '';
    items.forEach(function (m) {
      var b = btn(null, m.label);
      b.dataset.key = m.key;
      b.setAttribute('aria-pressed', String(m.key === active));
      b.addEventListener('click', function () {
        if (b.getAttribute('aria-pressed') === 'true') return;
        haptic('tick');
        onChange(m.key);
      });
      container.appendChild(b);
    });
  }

  function setPressed(container, key) {
    container.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.key === key));
    });
  }

  /* ================= View: Statistik ================= */

  var RANGES = [
    { key: '4w', label: '4 Wochen', days: 28 },
    { key: '3m', label: '3 Monate', days: 91 },
    { key: '1y', label: '1 Jahr', days: 365 },
    { key: 'all', label: 'Alles', days: null }
  ];

  function allTrainingDates() {
    var set = {};
    data.exercises.forEach(function (ex) {
      var log = data.logs[ex.id] || {};
      Object.keys(log).forEach(function (d) { if (log[d] && log[d].length) set[d] = true; });
    });
    return Object.keys(set).sort();
  }

  /* Zeitraum [since, until]; prevSince für den Vergleich mit dem Zeitraum davor */
  function statsRange() {
    var today = todayISO();
    var r = RANGES.filter(function (x) { return x.key === ui.statsRange; })[0] || RANGES[1];
    if (!r.days) {
      var dates = allTrainingDates();
      return { since: dates.length ? dates[0] : today, until: today, prevSince: null, days: dates.length ? daysBetween(dates[0], today) + 1 : 1 };
    }
    var since = shiftISO(today, -(r.days - 1));
    return { since: since, until: today, prevSince: shiftISO(since, -r.days), days: r.days };
  }

  /* Kennzahlen für einen Zeitraum */
  function periodStats(since, until) {
    var days = {};
    var sets = 0, volume = 0, records = 0, exercises = {};
    data.exercises.forEach(function (ex) {
      var log = data.logs[ex.id] || {};
      Object.keys(log).forEach(function (d) {
        if (d < since || d > until || !log[d] || !log[d].length) return;
        days[d] = true;
        exercises[ex.id] = true;
        log[d].forEach(function (s) { sets++; volume += s.weight * s.reps; });
      });
      computeRecords(ex.id).events.forEach(function (e) { if (e.date >= since && e.date <= until) records++; });
    });
    var dayList = Object.keys(days);
    var durations = [];
    var goalDays = 0, goalHit = 0;
    dayList.forEach(function (d) {
      var sum = daySummary(d);
      if (sum.minutes !== null) durations.push(sum.minutes);
      var p = goalProgress(d, sum);
      if (p) { goalDays++; if (p.done) goalHit++; }
    });
    var avgDur = durations.length ? Math.round(durations.reduce(function (a, b) { return a + b; }, 0) / durations.length) : null;
    return {
      days: dayList.length, sets: sets, volume: volume, records: records,
      exercises: Object.keys(exercises).length, avgMinutes: avgDur,
      goalDays: goalDays, goalHit: goalHit
    };
  }

  function deltaSub(cur, prev) {
    if (prev === null || prev === undefined) return null;
    if (!prev) return cur ? { text: 'neu im Zeitraum', cls: 'up' } : null;
    var pct = Math.round((cur - prev) / prev * 100);
    if (pct === 0) return { text: '±0 % vs. davor' };
    return { text: (pct > 0 ? '+' : '') + pct + ' % vs. davor', cls: pct > 0 ? 'up' : 'down' };
  }

  function renderStats() {
    buildSegmented($('stats-range'), RANGES, ui.statsRange, function (key) {
      ui.statsRange = key;
      savePrefs();
      transition(renderStats, null, 'list');
    });

    var hasData = allTrainingDates().length > 0;
    $('stats-body').hidden = !hasData;
    var empty = $('stats-empty');
    empty.hidden = hasData;
    empty.textContent = '';
    if (!hasData) {
      empty.appendChild(emptyState('chart', 'Noch keine Trainingsdaten',
        'Sobald du Sätze einträgst, siehst du hier Kalender, Wochenvolumen, Rekorde und deine Entwicklung.'));
      return;
    }

    var range = statsRange();
    var cur = periodStats(range.since, range.until);
    var prev = range.prevSince ? periodStats(range.prevSince, shiftISO(range.since, -1)) : null;
    var weeks = Math.max(1, range.days / 7);

    var grid = $('stats-numbers');
    grid.textContent = '';
    grid.appendChild(fact('Trainingstage', String(cur.days), null, 'Ø ' + formatNum(cur.days / weeks, 1) + ' pro Woche'));
    grid.appendChild(fact('Sätze', formatNum(cur.sets, 0), null, prev ? deltaSub(cur.sets, prev.sets) : null));
    var vol = formatVolume(cur.volume).split(' ');
    grid.appendChild(fact('Volumen', vol[0], vol[1], prev ? deltaSub(cur.volume, prev.volume) : null));
    if (cur.avgMinutes !== null) {
      grid.appendChild(fact('Ø Dauer', String(cur.avgMinutes), 'min', 'pro Training'));
    } else {
      grid.appendChild(fact('Übungen', String(cur.exercises), null, 'trainiert'));
    }
    var av = formatVolume(cur.days ? cur.volume / cur.days : 0).split(' ');
    grid.appendChild(fact('Ø Volumen', av[0], av[1], 'pro Training'));
    grid.appendChild(fact('Rekorde', String(cur.records), null,
      cur.goalDays ? 'Ziel ' + cur.goalHit + '/' + cur.goalDays + ' Tage' : 'neue Bestgewichte', 'is-record'));

    renderHeatmap();
    renderWeekly(range);
    renderRecordList(range);
    renderProgressList(range);
    buildSegmented($('stats-cat-mode'), [{ key: 'sets', label: 'Sätze' }, { key: 'volume', label: 'Volumen' }], ui.statsCatMode, function (key) {
      ui.statsCatMode = key;
      savePrefs();
      setPressed($('stats-cat-mode'), key);
      renderCategoryBars(statsRange());
    });
    renderCategoryBars(range);

    buildSegmented($('stats-metric-toggle'), METRICS, ui.statsMetric, function (key) {
      ui.statsMetric = key;
      transition(function () { renderStatsChart(statsRange()); });
    });
    renderStatsChart(range);
  }

  /* Trainingskalender: 18 Wochen, Montag oben */
  function renderHeatmap() {
    var box = $('stats-heatmap');
    box.textContent = '';
    var WEEKS = 18;
    var today = todayISO();
    var start = shiftISO(weekStartISO(today), -7 * (WEEKS - 1));
    var vol = {};
    data.exercises.forEach(function (ex) {
      var log = data.logs[ex.id] || {};
      Object.keys(log).forEach(function (d) {
        if (d >= start && d <= today && log[d] && log[d].length) vol[d] = (vol[d] || 0) + dayMetric(log[d], 'volume');
      });
    });
    var max = 0;
    Object.keys(vol).forEach(function (d) { max = Math.max(max, vol[d]); });

    var months = el('div', 'hm-months');
    var grid = el('div', 'hm-grid');
    var lastMonth = -1;
    var trainedDays = 0;
    for (var w = 0; w < WEEKS; w++) {
      var weekISO = shiftISO(start, 7 * w);
      var m = parseISO(weekISO).getMonth();
      var ml = el('span', null, m !== lastMonth && w < WEEKS - 1 ? MONTHS_SHORT[m] : '');
      ml.style.gridColumn = String(w + 1);
      months.appendChild(ml);
      lastMonth = m;
      for (var d = 0; d < 7; d++) {
        var iso = shiftISO(weekISO, d);
        var cell = el('span', 'hm-cell');
        var v = vol[iso] || 0;
        var level = !v ? 0 : v / max > 0.75 ? 4 : v / max > 0.5 ? 3 : v / max > 0.25 ? 2 : 1;
        cell.dataset.level = String(level);
        if (iso > today) cell.classList.add('is-future');
        if (iso === today) cell.classList.add('is-today');
        if (v) {
          trainedDays++;
          var p = goalProgress(iso);
          if (p && p.done) cell.classList.add('is-goal');
        }
        cell.title = formatISOLong(iso) + ': ' + (v ? formatNum(v, 0) + ' kg' : 'kein Training');
        grid.appendChild(cell);
      }
    }
    var days = el('div', 'hm-days');
    ['Mo', '', 'Mi', '', 'Fr', '', 'So'].forEach(function (t) { days.appendChild(el('span', null, t)); });

    var wrap = el('div', 'hm-wrap');
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', 'Trainingskalender: ' + trainedDays + ' Trainingstage in den letzten 18 Wochen');
    wrap.appendChild(el('span', 'hm-corner'));
    wrap.appendChild(months);
    wrap.appendChild(days);
    wrap.appendChild(grid);
    box.appendChild(wrap);

    var legend = el('div', 'hm-legend');
    legend.appendChild(el('span', null, 'Weniger'));
    [0, 1, 2, 3, 4].forEach(function (l) {
      var c = el('span', 'hm-cell');
      c.dataset.level = String(l);
      legend.appendChild(c);
    });
    legend.appendChild(el('span', null, 'Mehr'));
    var goalKey = el('span', 'hm-goal-key');
    var gc = el('span', 'hm-cell is-goal');
    gc.dataset.level = '2';
    goalKey.appendChild(gc);
    goalKey.appendChild(document.createTextNode('Ziel erreicht'));
    legend.appendChild(goalKey);
    box.appendChild(legend);

    // Serie: Wochen in Folge mit mindestens einem Training
    var trained = {};
    allTrainingDates().forEach(function (dd) { trained[weekStartISO(dd)] = (trained[weekStartISO(dd)] || 0) + 1; });
    var wk = weekStartISO(today);
    var thisWeek = trained[wk] || 0;
    if (!thisWeek) wk = shiftISO(wk, -7);
    var streak = 0;
    while (trained[wk]) { streak++; wk = shiftISO(wk, -7); }
    var sEl = $('stats-streak');
    sEl.textContent = '';
    sEl.appendChild(el('b', null, streak ? plural(streak, 'Woche', 'Wochen') + ' in Folge' : 'Noch keine Serie'));
    sEl.appendChild(document.createTextNode(' · diese Woche ' + plural(thisWeek, 'Training', 'Trainings')));
  }

  /* Volumen pro Kalenderwoche im Zeitraum (höchstens 52 Wochen) */
  function renderWeekly(range) {
    var firstWeek = weekStartISO(range.since);
    var lastWeek = weekStartISO(range.until);
    var weeks = [];
    for (var wk = firstWeek; wk <= lastWeek; wk = shiftISO(wk, 7)) weeks.push({ date: wk, value: 0, days: {} });
    if (weeks.length > 52) weeks = weeks.slice(weeks.length - 52);
    var idx = {};
    weeks.forEach(function (w, i) { idx[w.date] = i; });
    data.exercises.forEach(function (ex) {
      var log = data.logs[ex.id] || {};
      Object.keys(log).forEach(function (d) {
        var i = idx[weekStartISO(d)];
        if (i === undefined || !log[d] || !log[d].length) return;
        weeks[i].value += dayMetric(log[d], 'volume');
        weeks[i].days[d] = true;
      });
    });
    drawChart($('stats-weekly'), weeks, {
      type: 'bar',
      hintEl: $('stats-weekly-hint'),
      hintFormat: function (pt) {
        var n = Object.keys(pt.days).length;
        return ['KW ' + isoWeek(pt.date) + ' (' + formatISO(pt.date) + ' bis ' + formatISO(shiftISO(pt.date, 6)) + '): ',
          formatNum(pt.value, 0) + ' kg', ' · ' + plural(n, 'Training', 'Trainings')];
      }
    });
  }

  function rankRow(ex, title, sub, value, cls) {
    var li = applyCat(el('li', 'rank-row'), catOf(ex));
    li.appendChild(el('span', 'chip-dot'));
    var text = el('span', 'rank-text');
    text.appendChild(el('span', 'rank-title', title));
    text.appendChild(el('span', 'rank-sub', sub));
    li.appendChild(text);
    li.appendChild(el('span', 'rank-val' + (cls ? ' ' + cls : ''), value));
    return li;
  }

  function renderRecordList(range) {
    var list = $('stats-records');
    list.textContent = '';
    var events = [];
    data.exercises.forEach(function (ex) {
      computeRecords(ex.id).events.forEach(function (e) {
        if (e.date >= range.since && e.date <= range.until) events.push(e);
      });
    });
    events.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.weight - a.weight; });
    if (!events.length) {
      list.appendChild(el('li', 'empty-line', 'Noch keine neuen Rekorde in diesem Zeitraum.'));
      return;
    }
    events.slice(0, 8).forEach(function (e) {
      var ex = getExercise(e.exId);
      list.appendChild(rankRow(ex, ex.name, formatWeight(e.weight) + ' kg × ' + e.reps + ' · ' + relativeDay(e.date),
        '+' + formatWeight(e.weight - e.prev) + ' kg', 'up'));
    });
  }

  function renderProgressList(range) {
    var list = $('stats-progress');
    list.textContent = '';
    var rows = [];
    data.exercises.forEach(function (ex) {
      var s = exerciseSeries(ex.id, 'top', range.since);
      if (s.length < 2) return;
      var first = s[0].value, last = s[s.length - 1].value;
      if (first <= 0) return;
      rows.push({ ex: ex, first: first, last: last, pct: (last - first) / first * 100 });
    });
    rows.sort(function (a, b) { return b.pct - a.pct; });
    if (!rows.length) {
      list.appendChild(el('li', 'empty-line', 'Dafür braucht eine Übung mindestens zwei Trainingstage im Zeitraum.'));
      return;
    }
    rows.slice(0, 6).forEach(function (r) {
      var sign = r.pct > 0.05 ? '+' : r.pct < -0.05 ? '' : '±';
      list.appendChild(rankRow(r.ex, r.ex.name, formatWeight(r.first) + ' → ' + formatWeight(r.last) + ' kg',
        sign + formatNum(r.pct, 1) + ' %', r.pct > 0.05 ? 'up' : r.pct < -0.05 ? 'down' : ''));
    });
  }

  function renderCategoryBars(range) {
    var box = $('stats-cats');
    box.textContent = '';
    var mode = ui.statsCatMode;
    var counts = {};
    allCategories().forEach(function (c) { counts[c.key] = 0; });
    counts[NONE] = 0;
    data.exercises.forEach(function (ex) {
      var log = data.logs[ex.id] || {};
      Object.keys(log).forEach(function (date) {
        if (date < range.since || date > range.until) return;
        var sets = log[date] || [];
        counts[catOf(ex)] += mode === 'volume' ? (dayMetric(sets, 'volume') || 0) : sets.length;
      });
    });
    var keys = allCategories().map(function (c) { return c.key; });
    if (counts[NONE]) keys.push(NONE);
    var max = 0, total = 0;
    keys.forEach(function (k) { max = Math.max(max, counts[k]); total += counts[k]; });
    if (!max) {
      box.appendChild(el('p', 'empty-line', 'In diesem Zeitraum noch keine Sätze eingetragen.'));
      return;
    }
    keys.forEach(function (k) {
      var row = applyCat(el('div', 'cat-bar'), k);
      var label = el('span', 'cat-bar-label');
      label.appendChild(el('span', 'chip-dot'));
      label.appendChild(el('span', 'chip-label', k === NONE ? 'Ohne' : catLabel(k)));
      var track = el('span', 'cat-bar-track');
      var fill = el('span', 'cat-bar-fill');
      fill.style.width = (counts[k] / max * 100) + '%';
      track.appendChild(fill);
      var valText = mode === 'volume' ? formatVolume(counts[k]) : String(counts[k]);
      var share = total ? Math.round(counts[k] / total * 100) : 0;
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(el('span', 'cat-bar-val', valText));
      row.setAttribute('aria-label', (k === NONE ? 'Ohne Kategorie' : catLabel(k)) + ': ' + valText + ' (' + share + ' %)');
      row.title = share + ' % vom Gesamt';
      box.appendChild(row);
    });
  }

  function renderStatsChart(range) {
    var series = globalSeries(ui.statsMetric, range.since);
    $('stats-chart-empty').hidden = series.length > 1;
    setPressed($('stats-metric-toggle'), ui.statsMetric);
    drawChart($('stats-chart'), series.length > 1 ? series : [], {
      baseline: 100,
      hintEl: $('stats-chart-hint'),
      hintFormat: function (pt, isLast) {
        var diff = pt.value - 100;
        return [(isLast ? 'Zuletzt ' : '') + formatISO(pt.date, true) + ': ', formatNum(pt.value, 1) + ' %',
          ' (' + (diff >= 0 ? '+' : '') + formatNum(diff, 1) + ' % im Zeitraum)'];
      }
    });
  }

  /* ================= View: Einstellungen ================= */

  function renderSettings() {
    var s = data.settings;

    // Pausentimer
    var rest = $('settings-rest');
    rest.textContent = '';
    rest.appendChild(el('p', 'field-label', 'Standard-Pause'));
    rest.appendChild(chipRow(REST_OPTIONS.map(function (v) { return { v: v, label: formatSecs(v) }; }),
      function (o) { return o.v === s.restDefault; },
      function (o) {
        s.restDefault = o.v;
        saveData();
        renderSettings();
      }, 'chip-row chip-grid'));
    var list = el('div', 'switch-list');
    list.appendChild(switchRow('Nach jedem Satz automatisch starten', null, s.restAuto, function (on) { s.restAuto = on; saveData(); }));
    list.appendChild(switchRow('Ton am Ende der Pause', 'Musik wird kurz leiser, nicht angehalten.', s.sound, function (on) {
      s.sound = on;
      saveData();
      if (on) { Sound.unlock(); Sound.chime(); }
    }));
    if (navigator.vibrate) {
      list.appendChild(switchRow('Vibration am Ende der Pause', null, s.vibrate, function (on) { s.vibrate = on; saveData(); }));
    }
    if (WakeLock.supported) {
      list.appendChild(switchRow('Bildschirm während der Pause anlassen', 'So siehst und hörst du das Ende zuverlässig.', s.wakeLock, function (on) {
        s.wakeLock = on;
        saveData();
        WakeLock.update();
      }));
    }
    if ('Notification' in window && 'serviceWorker' in navigator) {
      var denied = Notification.permission === 'denied';
      list.appendChild(switchRow('Benachrichtigung im Hintergrund',
        denied ? 'Im Browser blockiert. In den Website-Einstellungen erlauben.' : 'Wenn die App gerade nicht offen ist. Klappt nicht auf jedem Gerät.',
        s.notify && Notification.permission === 'granted', function (on, input) {
          if (!on) { s.notify = false; saveData(); return; }
          Notification.requestPermission().then(function (p) {
            s.notify = p === 'granted';
            saveData();
            if (!s.notify) {
              input.checked = false;
              toast('Benachrichtigungen wurden nicht erlaubt.');
            }
          });
        }));
    }
    rest.appendChild(list);

    // Tagesziel
    var goal = $('settings-goal');
    goal.textContent = '';
    var gRow = btn('setting-row');
    gRow.appendChild(icon('target'));
    var gText = el('span', 'setting-text');
    gText.appendChild(el('span', null, 'Standard für neue Tage'));
    gText.appendChild(el('small', null, s.goalDefault ? goalText(s.goalDefault) : 'Kein Standardziel'));
    gRow.appendChild(gText);
    gRow.appendChild(icon('chevron-right', 'chev'));
    gRow.addEventListener('click', function () { openGoalSheet(null); });
    goal.appendChild(gRow);
    goal.appendChild(el('p', 'panel-sub', 'Einzelne Tage änderst du im Training über die Tageskarte.'));

    // Kategorien
    var cats = $('settings-cats');
    cats.textContent = '';
    var counts = categoryCounts();
    var ul = el('ul', 'cat-list');
    allCategories().forEach(function (c) {
      var li = applyCat(el('li', 'cat-item'), c.key);
      li.appendChild(el('span', 'chip-dot'));
      var t = el('span', 'cat-item-text');
      t.appendChild(el('span', null, c.label));
      t.appendChild(el('small', null, plural(counts[c.key] || 0, 'Übung', 'Übungen') + (isBuiltin(c.key) ? ' · Standard' : '')));
      li.appendChild(t);
      if (!isBuiltin(c.key)) {
        var edit = btn('icon-btn', null, 'pencil', c.label + ' bearbeiten');
        edit.addEventListener('click', function () { openCategorySheet(c); });
        li.appendChild(edit);
      }
      ul.appendChild(li);
    });
    cats.appendChild(ul);
    var add = btn('btn-secondary add-cat-btn', 'Kategorie hinzufügen', 'plus');
    add.addEventListener('click', function () { openCategorySheet(null); });
    cats.appendChild(add);
  }

  /* ================= Export / Import ================= */

  $('data-export').addEventListener('click', function () {
    var backup = {
      exercises: data.exercises, logs: data.logs, categories: data.categories,
      goals: data.goals, settings: data.settings, photos: photos
    };
    var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gym-tracker-backup-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    toast('Backup gespeichert');
  });

  $('data-import').addEventListener('click', function () { $('data-import-file').click(); });

  $('data-import-file').addEventListener('change', function () {
    var file = this.files[0];
    this.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(reader.result);
        if (!isBackupShape(parsed)) throw new Error('bad format');
      } catch (e) {
        alert('Datei konnte nicht gelesen werden (kein gültiges Backup).');
        return;
      }
      if (!confirm('Backup laden? Die aktuellen Daten auf diesem Gerät werden ersetzt.')) return;
      var keepSettings = !parsed.settings;
      var oldSettings = data.settings;
      data = normalizeData(parsed);
      if (keepSettings) data.settings = oldSettings;
      saveData();

      // Backup mit Fotos ersetzt alle Fotos. Ältere Backups ohne Fotos
      // behalten die vorhandenen Fotos, soweit die Übung noch existiert.
      var source = (parsed.photos && typeof parsed.photos === 'object') ? parsed.photos : photos;
      var next = {};
      data.exercises.forEach(function (ex) {
        if (isPhotoDataUrl(source[ex.id])) next[ex.id] = source[ex.id];
      });
      photos = next;
      PhotoStore.replaceAll(next).catch(function () {
        toast('Die Fotos aus dem Backup konnten nicht gespeichert werden.');
      });
      ui.openId = null;
      ui.draft = null;
      ui.editing = null;
      if (ui.filter !== 'all' && ui.filter !== NONE && !isCategory(ui.filter)) ui.filter = 'all';
      if (timer && !getExercise(timer.exId)) stopRest();
      render();
      toast('Backup geladen: ' + plural(data.exercises.length, 'Übung', 'Übungen'));
    };
    reader.readAsText(file);
  });

  /* ================= Diagramme (Canvas) =================
     Linie oder Balken; Finger oder Maus über das Diagramm ziehen zeigt
     den jeweiligen Wert. Ohne Auswahl steht der letzte Wert im Hinweis. */

  function drawChart(canvas, points, opts) {
    canvas._chart = { points: points, opts: opts, active: points.length ? points.length - 1 : -1 };
    paintChart(canvas);
    if (!canvas._wired) wireChart(canvas);
  }

  /* 1, 2, 2,5 oder 5 mal Zehnerpotenz */
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return nice * mag;
  }

  function chartGeometry(canvas) {
    var c = canvas._chart;
    var isBar = c.opts.type === 'bar';
    var cssW = canvas.clientWidth || canvas.parentNode.clientWidth || 300;
    var cssH = canvas.clientHeight || 220;
    var padL = 44, padR = 14, padT = 14, padB = 26;
    var plotW = cssW - padL - padR;
    var plotH = cssH - padT - padB;
    var min = Infinity, max = -Infinity;
    c.points.forEach(function (p) { min = Math.min(min, p.value); max = Math.max(max, p.value); });
    if (c.opts.baseline !== undefined) {
      min = Math.min(min, c.opts.baseline);
      max = Math.max(max, c.opts.baseline);
    }
    if (isBar) min = 0;
    if (min === max) { if (isBar) max = max || 1; else { min -= 1; max += 1; } }
    var range = max - min;
    var step = niceStep((range * (isBar ? 1.05 : 1.2)) / 4);
    min = isBar ? 0 : Math.floor((min - range * 0.08) / step) * step;
    max = Math.ceil((max + (isBar ? 0 : range * 0.08)) / step) * step;
    if (max <= min) max = min + step;
    var ticks = [];
    for (var v = min; v <= max + step / 2; v += step) ticks.push(v);
    var n = c.points.length;
    return {
      cssW: cssW, cssH: cssH, padL: padL, padR: padR, padT: padT, padB: padB, plotW: plotW, plotH: plotH,
      min: min, max: max, ticks: ticks, decimals: step % 1 === 0 ? 0 : (step * 10) % 1 === 0 ? 1 : 2,
      slot: n ? plotW / n : plotW,
      x: function (i) {
        if (isBar) return padL + (i + 0.5) * (plotW / Math.max(1, n));
        return n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW;
      },
      y: function (val) { return padT + plotH - ((val - min) / (max - min)) * plotH; }
    };
  }

  function axisLabel(v, decimals) {
    if (v >= 10000) return formatNum(v / 1000, v % 1000 === 0 ? 0 : 1) + 't';
    return formatNum(v, decimals);
  }

  function paintChart(canvas) {
    var c = canvas._chart;
    var points = c.points;
    var isBar = c.opts.type === 'bar';
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || canvas.parentNode.clientWidth || 300;
    var cssH = canvas.clientHeight || 220;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    updateHint(canvas);
    if (!points.length) return;

    var css = getComputedStyle(document.documentElement);
    var cLine = css.getPropertyValue('--chart-line').trim() || '#72d88b';
    var cFill = css.getPropertyValue('--chart-fill').trim() || 'rgba(114,216,139,0.2)';
    var cBar = css.getPropertyValue('--chart-bar').trim() || 'rgba(114,216,139,0.42)';
    var cGrid = css.getPropertyValue('--chart-grid').trim() || '#313935';
    var cText = css.getPropertyValue('--chart-text').trim() || '#919b96';
    var cSurface = css.getPropertyValue('--chart-surface').trim() || '#181d1b';

    var g = chartGeometry(canvas);

    ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = cText;
    ctx.strokeStyle = cGrid;
    ctx.lineWidth = 1;
    g.ticks.forEach(function (v) {
      var y = Math.round(g.y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(g.padL, y);
      ctx.lineTo(g.cssW - g.padR, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(axisLabel(v, g.decimals), g.padL - 8, y);
    });

    if (c.opts.baseline !== undefined) {
      ctx.save();
      ctx.strokeStyle = cText;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(g.padL, g.y(c.opts.baseline));
      ctx.lineTo(g.cssW - g.padR, g.y(c.opts.baseline));
      ctx.stroke();
      ctx.restore();
    }

    // X-Beschriftung (max. ~5 Labels)
    ctx.fillStyle = cText;
    ctx.textBaseline = 'top';
    var step = Math.max(1, Math.ceil(points.length / 5));
    for (var i = 0; i < points.length; i += step) {
      ctx.textAlign = isBar || points.length === 1 ? 'center' : i === 0 ? 'left' : 'center';
      ctx.fillText(formatISO(points[i].date), g.x(i), g.padT + g.plotH + 9);
    }

    if (isBar) {
      var bw = Math.max(3, Math.min(28, g.slot * 0.62));
      var base = g.y(0);
      points.forEach(function (p, idx) {
        if (!p.value) return;
        var x = g.x(idx) - bw / 2;
        var y = g.y(p.value);
        var h = Math.max(2, base - y);
        var r = Math.min(5, bw / 2, h);
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.lineTo(x, base - h + r);
        ctx.quadraticCurveTo(x, base - h, x + r, base - h);
        ctx.lineTo(x + bw - r, base - h);
        ctx.quadraticCurveTo(x + bw, base - h, x + bw, base - h + r);
        ctx.lineTo(x + bw, base);
        ctx.closePath();
        ctx.fillStyle = idx === c.active ? cLine : cBar;
        ctx.fill();
      });
      return;
    }

    if (points.length > 1) {
      var grad = ctx.createLinearGradient(0, g.padT, 0, g.padT + g.plotH);
      grad.addColorStop(0, cFill);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      points.forEach(function (p, idx) {
        if (idx === 0) ctx.moveTo(g.x(idx), g.y(p.value)); else ctx.lineTo(g.x(idx), g.y(p.value));
      });
      ctx.lineTo(g.x(points.length - 1), g.padT + g.plotH);
      ctx.lineTo(g.x(0), g.padT + g.plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      points.forEach(function (p, idx) {
        if (idx === 0) ctx.moveTo(g.x(idx), g.y(p.value)); else ctx.lineTo(g.x(idx), g.y(p.value));
      });
      ctx.strokeStyle = cLine;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    var small = points.length > 40;
    points.forEach(function (p, idx) {
      ctx.beginPath();
      ctx.arc(g.x(idx), g.y(p.value), small ? 2 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = cLine;
      ctx.fill();
    });

    if (c.active >= 0 && c.active < points.length) {
      var ax = g.x(c.active), ay = g.y(points[c.active].value);
      ctx.save();
      ctx.strokeStyle = cText;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(Math.round(ax) + 0.5, g.padT);
      ctx.lineTo(Math.round(ax) + 0.5, g.padT + g.plotH);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(ax, ay, 7, 0, Math.PI * 2);
      ctx.fillStyle = cSurface;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = cLine;
      ctx.stroke();
    }
  }

  function updateHint(canvas) {
    var c = canvas._chart;
    var hintEl = c.opts.hintEl;
    if (!hintEl) return;
    hintEl.textContent = '';
    if (c.active < 0 || !c.points[c.active]) return;
    var parts = c.opts.hintFormat(c.points[c.active], c.active === c.points.length - 1);
    hintEl.appendChild(document.createTextNode(parts[0]));
    hintEl.appendChild(el('b', null, parts[1]));
    hintEl.appendChild(document.createTextNode(parts[2]));
  }

  function wireChart(canvas) {
    canvas._wired = true;
    var dragging = false;
    function pick(e) {
      var c = canvas._chart;
      if (!c || !c.points.length) return;
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var g = chartGeometry(canvas);
      var best = 0, bestDist = Infinity;
      c.points.forEach(function (p, idx) {
        var d = Math.abs(g.x(idx) - x);
        if (d < bestDist) { bestDist = d; best = idx; }
      });
      if (best !== c.active) {
        c.active = best;
        haptic('tick');
        paintChart(canvas);
      }
    }
    canvas.addEventListener('pointerdown', function (e) { dragging = true; pick(e); });
    canvas.addEventListener('pointermove', function (e) { if (dragging || e.pointerType === 'mouse') pick(e); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      canvas.addEventListener(ev, function () { dragging = false; });
    });
  }

  // Diagramme bei Größenänderung neu zeichnen
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      ['detail-chart', 'stats-chart', 'stats-weekly'].forEach(function (id) {
        var cv = $(id);
        if (cv._chart && cv.offsetParent) paintChart(cv);
      });
    }, 150);
  });

  // Tageswechsel, Timer und Wake Lock beim Zurückkehren in die App
  var knownToday = todayISO();
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { WakeLock.update(); return; }
    updateDock();
    WakeLock.update();
    var t = todayISO();
    if (t === knownToday) return;
    if (ui.date === knownToday) { ui.date = t; ui.draft = null; ui.editing = null; }
    knownToday = t;
    render();
  });

  /* ================= Offline (Service Worker) ================= */

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(noop);
    });
  }

  /* ================= Start ================= */

  applyView('training');
  if (timer) { scheduleTimer(); WakeLock.update(); }
  updateDock();
  loadPhotos().then(function () { if (Object.keys(photos).length) render(); });
})();
