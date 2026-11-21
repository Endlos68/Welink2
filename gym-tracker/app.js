/* Gym Tracker: Plain-JS Fitness-Fortschritts-App
   Trainingsdaten in localStorage, Gerätefotos in IndexedDB. */
(function () {
  'use strict';

  var STORAGE_KEY = 'gym-tracker-v1';
  var UI_KEY = 'gym-tracker-ui';

  function noop() {}

  /* ================= Kategorien ================= */

  var CATEGORIES = [
    { key: 'brust', label: 'Brust' },
    { key: 'arme', label: 'Arme' },
    { key: 'ruecken', label: 'Rücken' },
    { key: 'beine', label: 'Beine' },
    { key: 'bauch', label: 'Bauch' }
  ];
  var NONE = 'none';

  function isCategory(key) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].key === key) return true;
    return false;
  }
  function catOf(ex) { return isCategory(ex.category) ? ex.category : NONE; }
  function catLabel(key) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].key === key) return CATEGORIES[i].label;
    return 'Ohne Kategorie';
  }

  /* ================= Daten ================= */

  var data = loadData();

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.exercises) && typeof parsed.logs === 'object') {
          return { exercises: parsed.exercises, logs: parsed.logs || {} };
        }
      }
    } catch (e) { /* korrupte Daten -> frisch starten */ }
    return { exercises: [], logs: {} };
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      toast('Speichern fehlgeschlagen. Ist der Gerätespeicher voll?');
    }
  }

  function uid() {
    return 'ex-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
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
    try { localStorage.setItem(UI_KEY, JSON.stringify({ filter: ui.filter })); } catch (e) { /* egal */ }
  }

  /* ================= Datum ================= */

  var WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

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
  function daysAgo(iso) {
    return Math.round((parseISO(todayISO()) - parseISO(iso)) / 86400000);
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

  /* Zeitreihe einer Übung: [{date, value}], aufsteigend sortiert */
  function exerciseSeries(exId, metric) {
    var log = data.logs[exId] || {};
    var out = [];
    Object.keys(log).sort().forEach(function (date) {
      var v = dayMetric(log[date], metric);
      if (v !== null && v > 0) out.push({ date: date, value: v });
    });
    return out;
  }

  /* Globale Serie: pro Übung relativ zum Startwert (100 %), letzter bekannter
     Wert wird fortgeschrieben, dann Durchschnitt über alle gestarteten Übungen. */
  function globalSeries(metric) {
    var perEx = [];
    var dateSet = {};
    data.exercises.forEach(function (ex) {
      var s = exerciseSeries(ex.id, metric);
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

  /* Bestwerte: ein Satz, dessen geschätztes 1RM alle früheren Sätze übertrifft.
     Erst ab dem zweiten Trainingstag, damit der Start nicht voller Rekorde ist.
     Ergebnis: { 'YYYY-MM-DD': { setIndex: true } } */
  function computePRs(exId) {
    var log = data.logs[exId] || {};
    var out = {};
    var best = 0, hasPrior = false;
    Object.keys(log).sort().forEach(function (date) {
      var sets = log[date] || [];
      var running = best;
      sets.forEach(function (s, i) {
        var e = epley(s.weight, s.reps);
        if (hasPrior && e > running + 1e-9) (out[date] = out[date] || {})[i] = true;
        if (e > running) running = e;
      });
      if (sets.length) { best = running; hasPrior = true; }
    });
    return out;
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

  function formatNum(v, decimals) {
    var d = decimals === undefined ? (v >= 100 || v === Math.round(v) ? 0 : 1) : decimals;
    return v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function formatWeight(v) {
    return v.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  }
  function setText(s) { return formatWeight(s.weight) + ' kg × ' + s.reps; }

  /* ================= UI-State ================= */

  var prefs = loadPrefs();
  var ui = {
    view: 'training',          // training | exercises | exerciseDetail | stats
    date: todayISO(),
    filter: (prefs.filter === NONE || isCategory(prefs.filter)) ? prefs.filter : 'all',
    openId: null,              // aufgeklappte Übung im Training
    draft: null,               // {exId, date, weight, reps}
    editing: null,             // {exId, date, index}
    flash: null,               // frisch eingetragener Satz {exId, date, index}
    detailId: null,
    detailMetric: 'top',
    statsMetric: 'top',
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

  /* kind: Art des Wechsels für das CSS (nav | push | pop), sonst Überblenden */
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

  function haptic(kind) {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(kind === 'success' ? [16, 60, 24] : kind === 'tap' ? 10 : 6);
        return;
      }
      if (!coarsePointer.matches) return;
      var prev = document.activeElement;
      hapticLabel.click();
      if (prev && prev !== document.activeElement && prev.focus) prev.focus({ preventScroll: true });
    } catch (e) { /* ohne Haptik weiter */ }
  }

  /* ================= Hinweis-Leiste (Toast) ================= */

  var toastTimer = null;

  function toast(text, actionLabel, onAction) {
    var t = $('toast');
    var action = $('toast-action');
    clearTimeout(toastTimer);
    t.classList.add('show');
    $('toast-text').textContent = text;
    action.hidden = !actionLabel;
    action.textContent = actionLabel || '';
    action.onclick = function () {
      hideToast();
      if (onAction) onAction();
    };
    toastTimer = setTimeout(hideToast, actionLabel ? 6000 : 2800);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    $('toast').classList.remove('show');
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
    } else {
      main.appendChild(el('h1', 'title', 'Statistik'));
    }

    var showFilter = (ui.view === 'training' || ui.view === 'exercises') && data.exercises.length > 0;
    $('filter-bar').hidden = !showFilter;
    if (showFilter) renderFilterBar();
  }

  function categoryCounts() {
    var counts = { all: data.exercises.length };
    counts[NONE] = 0;
    CATEGORIES.forEach(function (c) { counts[c.key] = 0; });
    data.exercises.forEach(function (ex) { counts[catOf(ex)]++; });
    return counts;
  }

  function renderFilterBar() {
    var bar = $('filter-bar');
    bar.textContent = '';
    var seg = el('div', 'seg-cats');
    bar.appendChild(seg);
    var counts = categoryCounts();
    if (ui.filter === NONE && !counts[NONE]) ui.filter = 'all';

    var items = [{ key: 'all', label: 'Alle' }].concat(CATEGORIES);
    if (counts[NONE]) items.push({ key: NONE, label: 'Ohne' });

    items.forEach(function (it) {
      var chip = btn('chip');
      if (it.key !== 'all') chip.dataset.cat = it.key;
      chip.appendChild(el('span', 'chip-dot' + (it.key === 'all' ? ' all' : '')));
      chip.appendChild(el('span', 'chip-label', it.label));
      chip.setAttribute('aria-label', it.label + ', ' + (counts[it.key] || 0) + (counts[it.key] === 1 ? ' Übung' : ' Übungen'));
      chip.setAttribute('aria-pressed', String(ui.filter === it.key));
      chip.addEventListener('click', function () {
        if (ui.filter === it.key) return;
        haptic('tick');
        setFilter(it.key);
      });
      seg.appendChild(chip);
    });
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
    var groups = CATEGORIES.map(function (c) { return { key: c.key, label: c.label, items: [] }; });
    groups.push({ key: NONE, label: 'Ohne Kategorie', items: [] });
    var byKey = {};
    groups.forEach(function (g) { byKey[g.key] = g; });
    list.forEach(function (ex) { byKey[catOf(ex)].items.push(ex); });
    return groups.filter(function (g) { return g.items.length; });
  }

  function groupHead(g) {
    var h = el('h2', 'group-head');
    h.dataset.cat = g.key;
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

  var VIEW_IDS = { training: 'view-training', exercises: 'view-exercises', exerciseDetail: 'view-exercise-detail', stats: 'view-stats' };

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
    else renderStats();
  }

  function render() {
    renderHeader();
    renderView();
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

  function trainingMeta(ex, sets) {
    var meta = el('span', 'ex-meta');
    if (sets.length) {
      var top = topSet(sets);
      meta.textContent = sets.length + (sets.length === 1 ? ' Satz' : ' Sätze') + ' · Top ' + formatWeight(top.weight) + ' kg';
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
    item.dataset.cat = catOf(ex);
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
      pill.setAttribute('aria-label', sets.length + (sets.length === 1 ? ' Satz' : ' Sätze') + ' erledigt');
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

  function buildLogPanel(ex, sets) {
    var form = el('form', 'log');
    form.noValidate = true;
    var editing = ui.editing && ui.editing.exId === ex.id && ui.editing.date === ui.date ? ui.editing : null;
    var prs = computePRs(ex.id)[ui.date] || {};

    // Referenz: was beim letzten Mal lief
    var last = lastSession(ex.id, ui.date);
    if (last) {
      var ref = el('p', 'log-ref');
      ref.appendChild(el('b', null, 'Letztes Mal'));
      ref.appendChild(document.createTextNode(' (' + relativeDay(last.date, true) + '): ' +
        last.sets.map(function (s) { return formatWeight(s.weight) + ' × ' + s.reps; }).join(' · ')));
      form.appendChild(ref);
    } else if (!sets.length) {
      form.appendChild(el('p', 'log-ref', 'Erster Satz für diese Übung. Gewicht und Wiederholungen einstellen, dann eintragen.'));
    }

    if (sets.length) {
      var ol = el('ol', 'sets');
      ol.setAttribute('aria-label', 'Sätze heute');
      sets.forEach(function (s, idx) {
        ol.appendChild(buildSetRow(ex, s, idx, !!prs[idx], editing && editing.index === idx));
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

  function buildSetRow(ex, s, idx, isPR, isEditing) {
    var li = el('li', 'set' + (isEditing ? ' is-editing' : ''));
    var f = ui.flash;
    if (f && f.exId === ex.id && f.date === ui.date && f.index === idx) li.classList.add('is-new');

    var main = el('button', 'set-main');
    main.type = 'button';
    main.setAttribute('aria-label', 'Satz ' + (idx + 1) + ': ' + setText(s) + (isPR ? ', Bestwert' : '') + '. Bearbeiten');
    main.appendChild(el('span', 'set-no', String(idx + 1)));
    var val = el('span', 'set-val');
    val.appendChild(document.createTextNode(formatWeight(s.weight)));
    val.appendChild(el('span', 'u', ' kg'));
    val.appendChild(el('span', 'x', '×'));
    val.appendChild(document.createTextNode(String(s.reps)));
    main.appendChild(val);
    if (isPR) {
      var badge = el('span', 'badge-pr');
      badge.appendChild(icon('trend'));
      badge.appendChild(document.createTextNode('Bestwert'));
      badge.title = 'Neuer Bestwert (geschätztes 1RM)';
      main.appendChild(badge);
    }
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

    function fmt(v) { return opts.decimal ? formatWeight(v) : String(v); }
    function show() {
      input.value = fmt(draft[f]);
      input.style.width = Math.max(1, input.value.length) + 0.3 + 'ch';
      minus.disabled = draft[f] <= 0;
    }
    function clean(v) {
      v = Math.max(0, Math.min(999, v));
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
      var v = parseFloat(input.value.replace(',', '.'));
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
    show();
    return wrap;
  }

  function holdRepeat(button, fn) {
    var timer = null;
    var delay = 0;
    function stop() {
      clearTimeout(timer);
      timer = null;
      button.classList.remove('is-pressed');
    }
    function loop() {
      if (!fn()) { stop(); return; }
      haptic('tick');
      delay = Math.max(40, delay * 0.8);
      timer = setTimeout(loop, delay);
    }
    button.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || button.disabled) return;
      e.preventDefault();
      button.classList.add('is-pressed');
      if (fn()) haptic('tick');
      delay = 160;
      timer = setTimeout(loop, 420);
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
    if (!data.logs[ex.id]) data.logs[ex.id] = {};
    var day = data.logs[ex.id][ui.date] || (data.logs[ex.id][ui.date] = []);
    day.push({ weight: draft.weight, reps: draft.reps });
    saveData();
    var idx = day.length - 1;
    var isPR = !!(computePRs(ex.id)[ui.date] || {})[idx];
    haptic(isPR ? 'success' : 'tap');
    transition(function () {
      ui.flash = { exId: ex.id, date: ui.date, index: idx };
      renderTraining();
    }, function () {
      ui.flash = null;
      var card = document.querySelector('.ex[data-id="' + ex.id + '"]');
      if (card) card.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    });
  }

  function saveEdit(ex, editing, draft) {
    var day = (data.logs[ex.id] || {})[editing.date];
    if (!day || !day[editing.index]) return;
    day[editing.index] = { weight: draft.weight, reps: draft.reps };
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

  /* ================= View: Übungen ================= */

  function renderAddPicker() {
    var picker = $('add-cats');
    picker.textContent = '';
    var selected = ui.newCategory || (isCategory(ui.filter) ? ui.filter : null);
    CATEGORIES.forEach(function (c) {
      var opt = btn('cat-option');
      opt.dataset.cat = c.key;
      opt.setAttribute('role', 'radio');
      opt.setAttribute('aria-checked', String(selected === c.key));
      opt.appendChild(el('span', 'chip-dot'));
      opt.appendChild(el('span', 'chip-label', c.label));
      opt.addEventListener('click', function () {
        haptic('tick');
        ui.newCategory = c.key;
        $('add-hint').textContent = '';
        renderAddPicker();
      });
      picker.appendChild(opt);
    });
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
    var ex = { id: uid(), name: name, category: cat, createdAt: todayISO() };
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
    row.dataset.cat = catOf(ex);
    row.dataset.id = ex.id;
    row.style.viewTransitionName = vtName('ls', ex.id);

    var thumb = buildThumb(ex.id);
    row.appendChild(thumb);

    var text = el('span', 'ex-text');
    text.appendChild(el('span', 'ex-name', ex.name));
    var days = Object.keys(data.logs[ex.id] || {}).length;
    var last = lastTrainedDate(ex.id);
    var meta = el('span', 'ex-meta');
    meta.textContent = days
      ? days + (days === 1 ? ' Trainingstag' : ' Trainingstage') + ' · zuletzt ' + relativeDay(last, true)
      : 'Noch nicht trainiert';
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
    var picker = $('detail-cats');
    picker.textContent = '';
    CATEGORIES.forEach(function (c) {
      var opt = btn('cat-option');
      opt.dataset.cat = c.key;
      opt.setAttribute('role', 'radio');
      opt.setAttribute('aria-checked', String(catOf(ex) === c.key));
      opt.appendChild(el('span', 'chip-dot'));
      opt.appendChild(el('span', 'chip-label', c.label));
      opt.addEventListener('click', function () {
        if (catOf(ex) === c.key) return;
        ex.category = c.key;
        saveData();
        haptic('tick');
        renderDetailCats(ex);
      });
      picker.appendChild(opt);
    });
  }

  function renderDetailPhoto(ex) {
    var box = $('detail-photo');
    box.textContent = '';
    var has = !!photos[ex.id];

    if (has) {
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
    var cam = btn('btn-secondary', has ? 'Neues Foto' : 'Foto aufnehmen', 'camera');
    cam.addEventListener('click', function () { pickPhoto(ex.id, true); });
    var gal = btn('btn-secondary', 'Aus Galerie', 'image');
    gal.addEventListener('click', function () { pickPhoto(ex.id, false); });
    actions.appendChild(cam);
    actions.appendChild(gal);
    if (has) {
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
    var best = 0, top = 0;
    days.forEach(function (d) {
      best = Math.max(best, dayMetric(log[d], 'e1rm'));
      top = Math.max(top, dayMetric(log[d], 'top'));
    });
    dl.appendChild(fact('Bestwert 1RM', formatNum(best, best >= 100 ? 0 : 1), 'kg'));
    dl.appendChild(fact('Top-Gewicht', formatWeight(top), 'kg'));
    dl.appendChild(fact('Trainingstage', String(days.length)));
  }

  function fact(label, value, unit) {
    var box = el('div', 'fact');
    box.appendChild(el('dt', null, label));
    var dd = el('dd', null, value);
    if (unit) dd.appendChild(el('small', null, unit));
    box.appendChild(dd);
    return box;
  }

  function renderDetail() {
    var ex = getExercise(ui.detailId);
    if (!ex) { applyView('exercises'); return; }
    renderDetailHead(ex);
    renderDetailCats(ex);
    renderDetailPhoto(ex);
    renderDetailFacts(ex);

    buildSegmented($('detail-metric-toggle'), ui.detailMetric, function (key) {
      ui.detailMetric = key;
      transition(renderDetailChart);
    });
    renderDetailChart();

    var hist = $('detail-history');
    hist.textContent = '';
    var log = data.logs[ex.id] || {};
    var prs = computePRs(ex.id);
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
        var isPR = prs[date] && prs[date][i];
        var chip = el('span', 'h-set' + (isPR ? ' pr' : ''), formatWeight(s.weight) + ' × ' + s.reps);
        if (isPR) chip.title = 'Bestwert';
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
    $('detail-metric-toggle').querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.key === metric));
    });
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

  function buildSegmented(container, active, onChange) {
    container.textContent = '';
    METRICS.forEach(function (m) {
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

  /* ================= View: Statistik ================= */

  function renderStats() {
    // Kennzahlen
    var allDates = {};
    var totalVolume = 0;
    var totalSets = 0;
    Object.keys(data.logs).forEach(function (exId) {
      Object.keys(data.logs[exId]).forEach(function (date) {
        var sets = data.logs[exId][date] || [];
        if (!sets.length) return;
        allDates[date] = true;
        totalSets += sets.length;
        totalVolume += dayMetric(sets, 'volume') || 0;
      });
    });
    var grid = $('stats-numbers');
    grid.textContent = '';
    grid.appendChild(fact('Trainingstage', String(Object.keys(allDates).length)));
    grid.appendChild(fact('Sätze', formatNum(totalSets, 0)));
    grid.appendChild(fact('Volumen', totalVolume >= 10000 ? formatNum(totalVolume / 1000, 1) : formatNum(totalVolume, 0), totalVolume >= 10000 ? 't' : 'kg'));

    buildSegmented($('stats-metric-toggle'), ui.statsMetric, function (key) {
      ui.statsMetric = key;
      transition(renderStatsChart);
    });
    renderStatsChart();
    renderCategoryBars();
  }

  function renderStatsChart() {
    var series = globalSeries(ui.statsMetric);
    $('stats-chart-empty').hidden = series.length > 0;
    $('stats-metric-toggle').querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.key === ui.statsMetric));
    });
    drawChart($('stats-chart'), series, {
      baseline: 100,
      hintEl: $('stats-chart-hint'),
      hintFormat: function (pt, isLast) {
        var diff = pt.value - 100;
        return [(isLast ? 'Zuletzt ' : '') + formatISO(pt.date, true) + ': ', formatNum(pt.value, 1) + ' %',
          ' (' + (diff >= 0 ? '+' : '') + formatNum(diff, 1) + ' % seit Start)'];
      }
    });
  }

  function renderCategoryBars() {
    var box = $('stats-cats');
    box.textContent = '';
    var since = shiftISO(todayISO(), -27);
    var counts = {};
    CATEGORIES.forEach(function (c) { counts[c.key] = 0; });
    counts[NONE] = 0;
    data.exercises.forEach(function (ex) {
      var log = data.logs[ex.id] || {};
      Object.keys(log).forEach(function (date) {
        if (date >= since && date <= todayISO()) counts[catOf(ex)] += (log[date] || []).length;
      });
    });
    var keys = CATEGORIES.map(function (c) { return c.key; });
    if (counts[NONE]) keys.push(NONE);
    var max = 0;
    keys.forEach(function (k) { max = Math.max(max, counts[k]); });
    if (!max) {
      box.appendChild(el('p', 'empty-line', 'In den letzten 4 Wochen noch keine Sätze eingetragen.'));
      return;
    }
    keys.forEach(function (k) {
      var row = el('div', 'cat-bar');
      row.dataset.cat = k;
      var label = el('span', 'cat-bar-label');
      label.appendChild(el('span', 'chip-dot'));
      label.appendChild(document.createTextNode(k === NONE ? 'Ohne' : catLabel(k)));
      var track = el('span', 'cat-bar-track');
      var fill = el('span', 'cat-bar-fill');
      fill.style.width = (counts[k] / max * 100) + '%';
      fill.style.display = 'block';
      track.appendChild(fill);
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(el('span', 'cat-bar-val', String(counts[k])));
      row.setAttribute('aria-label', catLabel(k) + ': ' + counts[k] + ' Sätze');
      box.appendChild(row);
    });
  }

  /* ================= Export / Import ================= */

  $('data-export').addEventListener('click', function () {
    var backup = { exercises: data.exercises, logs: data.logs, photos: photos };
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
        if (!parsed || !Array.isArray(parsed.exercises) || typeof parsed.logs !== 'object') throw new Error('bad format');
      } catch (e) {
        alert('Datei konnte nicht gelesen werden (kein gültiges Backup).');
        return;
      }
      if (!confirm('Backup laden? Die aktuellen Daten auf diesem Gerät werden ersetzt.')) return;
      data = { exercises: parsed.exercises, logs: parsed.logs || {} };
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
      render();
      toast('Backup geladen: ' + data.exercises.length + ' Übungen');
    };
    reader.readAsText(file);
  });

  /* ================= Diagramm (Canvas) =================
     Linie mit Fläche; Finger oder Maus über das Diagramm ziehen zeigt
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
    if (min === max) { min -= 1; max += 1; }
    var range = max - min;
    var step = niceStep((range * 1.2) / 4);
    min = Math.floor((min - range * 0.08) / step) * step;
    max = Math.ceil((max + range * 0.08) / step) * step;
    var ticks = [];
    for (var v = min; v <= max + step / 2; v += step) ticks.push(v);
    var n = c.points.length;
    return {
      cssW: cssW, cssH: cssH, padL: padL, padR: padR, padT: padT, padB: padB, plotW: plotW, plotH: plotH,
      min: min, max: max, ticks: ticks, decimals: step % 1 === 0 ? 0 : (step * 10) % 1 === 0 ? 1 : 2,
      x: function (i) { return n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW; },
      y: function (v) { return padT + plotH - ((v - min) / (max - min)) * plotH; }
    };
  }

  function paintChart(canvas) {
    var c = canvas._chart;
    var points = c.points;
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
    var cGrid = css.getPropertyValue('--chart-grid').trim() || '#313935';
    var cText = css.getPropertyValue('--chart-text').trim() || '#919b96';
    var cSurface = css.getPropertyValue('--chart-surface').trim() || '#181d1b';

    var g = chartGeometry(canvas);

    // Y-Gitter + Beschriftung
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
      ctx.fillText(formatNum(v, g.decimals), g.padL - 8, y);
    });

    // Referenzlinie (100 %)
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
      ctx.textAlign = points.length === 1 ? 'center' : i === 0 ? 'left' : 'center';
      ctx.fillText(formatISO(points[i].date), g.x(i), g.padT + g.plotH + 9);
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

    // Punkte
    var small = points.length > 40;
    points.forEach(function (p, idx) {
      ctx.beginPath();
      ctx.arc(g.x(idx), g.y(p.value), small ? 2 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = cLine;
      ctx.fill();
    });

    // Auswahl: Hilfslinie + hervorgehobener Punkt
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
      if (ui.view === 'exerciseDetail' && $('detail-chart')._chart) paintChart($('detail-chart'));
      else if (ui.view === 'stats' && $('stats-chart')._chart) paintChart($('stats-chart'));
    }, 150);
  });

  // Tageswechsel, während die App offen bleibt
  var knownToday = todayISO();
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    var t = todayISO();
    if (t === knownToday) return;
    if (ui.date === knownToday) { ui.date = t; ui.draft = null; ui.editing = null; }
    knownToday = t;
    render();
  });

  /* ================= Start ================= */

  applyView('training');
  loadPhotos().then(function () { if (Object.keys(photos).length) render(); });
})();
