/* Gym Tracker – Plain-JS Fitness-Fortschritts-App
   Daten liegen ausschließlich in localStorage. */
(function () {
  'use strict';

  var STORAGE_KEY = 'gym-tracker-v1';

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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

  /* ================= Datum ================= */

  function toISO(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function todayISO() { return toISO(new Date()); }

  function shiftISO(iso, days) {
    var p = iso.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + days);
    return toISO(d);
  }

  var WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  function formatISO(iso, withYear) {
    var p = iso.split('-');
    var s = p[2] + '.' + p[1] + '.';
    return withYear ? s + p[0] : s;
  }

  function formatISOLong(iso) {
    var p = iso.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return WEEKDAYS[d.getDay()] + ', ' + formatISO(iso, true);
  }

  /* ================= Metriken ================= */

  var METRICS = [
    { key: 'top',    label: 'Top-Gewicht', unit: 'kg' },
    { key: 'e1rm',   label: '1RM (gesch.)', unit: 'kg' },
    { key: 'volume', label: 'Volumen',     unit: 'kg' }
  ];

  function epley(weight, reps) {
    return reps <= 1 ? weight : weight * (1 + reps / 30);
  }

  /* Tagesmetrik aus einer Set-Liste [{weight, reps}] */
  function dayMetric(sets, metric) {
    if (!sets || !sets.length) return null;
    var i, v;
    if (metric === 'volume') {
      v = 0;
      for (i = 0; i < sets.length; i++) v += sets[i].weight * sets[i].reps;
      return v;
    }
    if (metric === 'e1rm') {
      v = 0;
      for (i = 0; i < sets.length; i++) v = Math.max(v, epley(sets[i].weight, sets[i].reps));
      return v;
    }
    v = 0; // top
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
    var dates = Object.keys(dateSet).sort();
    var out = [];
    dates.forEach(function (date) {
      var sum = 0, n = 0;
      perEx.forEach(function (series) {
        var baseline = series[0].value;
        if (series[0].date > date || baseline <= 0) return; // Übung noch nicht gestartet
        var last = null;
        for (var i = 0; i < series.length && series[i].date <= date; i++) last = series[i].value;
        if (last !== null) { sum += (last / baseline) * 100; n++; }
      });
      if (n) out.push({ date: date, value: sum / n });
    });
    return out;
  }

  function formatNum(v, decimals) {
    var d = decimals === undefined ? (v >= 100 || v === Math.round(v) ? 0 : 1) : decimals;
    return v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /* ================= UI-State ================= */

  var ui = {
    view: 'training',          // training | exercises | exerciseDetail | stats
    date: todayISO(),
    detailId: null,
    detailMetric: 'top',
    statsMetric: 'top',
    editing: null              // {exId, date, index}
  };

  /* ================= DOM-Kurzhelfer ================= */

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ================= Navigation ================= */

  var VIEW_TITLES = { training: 'Training', exercises: 'Übungen', exerciseDetail: 'Übung', stats: 'Statistik' };

  function show(view) {
    ui.view = view;
    $('view-training').hidden = view !== 'training';
    $('view-exercises').hidden = view !== 'exercises';
    $('view-exercise-detail').hidden = view !== 'exerciseDetail';
    $('view-stats').hidden = view !== 'stats';
    $('view-title').textContent = view === 'exerciseDetail'
      ? ((getExercise(ui.detailId) || {}).name || 'Übung')
      : VIEW_TITLES[view];
    var tabView = view === 'exerciseDetail' ? 'exercises' : view;
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.view === tabView);
    });
    render();
    window.scrollTo(0, 0);
  }

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { show(t.dataset.view); });
  });

  function render() {
    if (ui.view === 'training') renderTraining();
    else if (ui.view === 'exercises') renderExercises();
    else if (ui.view === 'exerciseDetail') renderDetail();
    else renderStats();
  }

  /* ================= View: Training ================= */

  $('date-prev').addEventListener('click', function () { ui.date = shiftISO(ui.date, -1); ui.editing = null; renderTraining(); });
  $('date-next').addEventListener('click', function () { ui.date = shiftISO(ui.date, 1); ui.editing = null; renderTraining(); });
  $('date-today').addEventListener('click', function () { ui.date = todayISO(); ui.editing = null; renderTraining(); });

  function renderTraining() {
    var isToday = ui.date === todayISO();
    $('date-label').textContent = isToday ? 'Heute' : (ui.date === shiftISO(todayISO(), -1) ? 'Gestern' : formatISO(ui.date, true));
    $('date-value').textContent = formatISOLong(ui.date);
    $('date-today').hidden = isToday;

    var list = $('training-list');
    list.textContent = '';

    if (!data.exercises.length) {
      var hint = el('div', 'empty-hint');
      hint.appendChild(el('span', 'big', '🏋️'));
      hint.appendChild(document.createTextNode('Noch keine Übungen angelegt.'));
      hint.appendChild(document.createElement('br'));
      hint.appendChild(document.createTextNode('Lege im Tab „Übungen“ deine erste Übung an.'));
      list.appendChild(hint);
      return;
    }

    data.exercises.forEach(function (ex) {
      list.appendChild(buildExerciseCard(ex));
    });
  }

  function buildExerciseCard(ex) {
    var log = data.logs[ex.id] || {};
    var sets = log[ui.date] || [];

    var card = el('div', 'card ex-card');
    var head = el('div', 'ex-card-head');
    head.appendChild(el('h3', null, ex.name));
    if (sets.length) {
      var top = dayMetric(sets, 'top');
      var vol = dayMetric(sets, 'volume');
      head.appendChild(el('div', 'ex-card-summary',
        sets.length + (sets.length === 1 ? ' Satz' : ' Sätze') +
        ' · Top ' + formatNum(top) + ' kg · Vol. ' + formatNum(vol, 0) + ' kg'));
    }
    card.appendChild(head);

    if (sets.length) {
      var setList = el('div', 'set-list');
      sets.forEach(function (s, idx) {
        setList.appendChild(buildSetRow(ex.id, idx, s));
      });
      card.appendChild(setList);
    }

    card.appendChild(buildAddForm(ex));
    return card;
  }

  function buildSetRow(exId, idx, s) {
    var row = el('div', 'set-row');
    var editing = ui.editing && ui.editing.exId === exId && ui.editing.date === ui.date && ui.editing.index === idx;

    row.appendChild(el('span', 'set-no', 'Satz ' + (idx + 1)));

    if (editing) {
      var form = el('form', 'set-edit-form');
      var wIn = numberInput('kg', s.weight, 0.25);
      var rIn = numberInput('Wdh.', s.reps, 1);
      var ok = el('button', 'icon-btn', '✓');
      ok.type = 'submit';
      form.appendChild(wIn); form.appendChild(rIn); form.appendChild(ok);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var w = parseFloat(wIn.value), r = parseInt(rIn.value, 10);
        if (!isValidSet(w, r)) return;
        data.logs[exId][ui.date][idx] = { weight: w, reps: r };
        ui.editing = null;
        saveData();
        renderTraining();
      });
      row.appendChild(form);
      var cancel = el('button', 'icon-btn', '✕');
      cancel.addEventListener('click', function () { ui.editing = null; renderTraining(); });
      row.appendChild(cancel);
    } else {
      var val = el('button', 'set-val', formatNum(s.weight) + ' kg × ' + s.reps);
      val.title = 'Antippen zum Bearbeiten';
      val.addEventListener('click', function () {
        ui.editing = { exId: exId, date: ui.date, index: idx };
        renderTraining();
      });
      row.appendChild(val);
      var del = el('button', 'icon-btn danger', '✕');
      del.setAttribute('aria-label', 'Satz löschen');
      del.addEventListener('click', function () {
        data.logs[exId][ui.date].splice(idx, 1);
        if (!data.logs[exId][ui.date].length) delete data.logs[exId][ui.date];
        saveData();
        renderTraining();
      });
      row.appendChild(del);
    }
    return row;
  }

  function buildAddForm(ex) {
    var form = el('form', 'set-add-form');
    var pre = lastSetValues(ex.id);
    var wIn = numberInput('kg', pre && pre.weight, 0.25);
    var rIn = numberInput('Wdh.', pre && pre.reps, 1);
    var btn = el('button', 'btn-primary', '+ Set');
    btn.type = 'submit';
    form.appendChild(wIn); form.appendChild(rIn); form.appendChild(btn);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var w = parseFloat(wIn.value), r = parseInt(rIn.value, 10);
      if (!isValidSet(w, r)) return;
      if (!data.logs[ex.id]) data.logs[ex.id] = {};
      if (!data.logs[ex.id][ui.date]) data.logs[ex.id][ui.date] = [];
      data.logs[ex.id][ui.date].push({ weight: w, reps: r });
      saveData();
      renderTraining();
    });
    return form;
  }

  function numberInput(placeholder, value, step) {
    var input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.placeholder = placeholder;
    input.step = String(step);
    input.min = '0';
    if (value !== undefined && value !== null && value !== false) input.value = value;
    return input;
  }

  function isValidSet(w, r) {
    return isFinite(w) && w > 0 && isFinite(r) && r > 0;
  }

  /* Letzter erfasster Set einer Übung (heutiger Tag bevorzugt, sonst letzter Trainingstag) */
  function lastSetValues(exId) {
    var log = data.logs[exId] || {};
    var todaySets = log[ui.date];
    if (todaySets && todaySets.length) return todaySets[todaySets.length - 1];
    var dates = Object.keys(log).sort();
    for (var i = dates.length - 1; i >= 0; i--) {
      var sets = log[dates[i]];
      if (sets && sets.length) return sets[sets.length - 1];
    }
    return null;
  }

  /* ================= View: Übungen ================= */

  $('exercise-add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('exercise-add-name');
    var name = input.value.trim();
    if (!name) return;
    data.exercises.push({ id: uid(), name: name, createdAt: todayISO() });
    input.value = '';
    saveData();
    renderExercises();
  });

  function renderExercises() {
    var list = $('exercise-list');
    list.textContent = '';
    if (!data.exercises.length) {
      var hint = el('div', 'empty-hint');
      hint.appendChild(el('span', 'big', '📋'));
      hint.appendChild(document.createTextNode('Noch keine Übungen. Lege oben deine erste an!'));
      list.appendChild(hint);
      return;
    }
    data.exercises.forEach(function (ex) {
      var item = el('button', 'exercise-item');
      var left = el('div');
      left.appendChild(el('div', 'name', ex.name));
      var days = Object.keys(data.logs[ex.id] || {}).length;
      left.appendChild(el('div', 'meta', days ? days + (days === 1 ? ' Trainingstag' : ' Trainingstage') : 'Noch kein Training'));
      item.appendChild(left);
      item.appendChild(el('span', 'chev', '›'));
      item.addEventListener('click', function () {
        ui.detailId = ex.id;
        show('exerciseDetail');
      });
      list.appendChild(item);
    });
  }

  /* ================= View: Übungsdetail ================= */

  $('detail-back').addEventListener('click', function () { show('exercises'); });

  $('detail-rename').addEventListener('click', function () {
    var ex = getExercise(ui.detailId);
    if (!ex) return;
    var name = prompt('Übung umbenennen:', ex.name);
    if (name && name.trim()) {
      ex.name = name.trim();
      saveData();
      show('exerciseDetail');
    }
  });

  $('detail-delete').addEventListener('click', function () {
    var ex = getExercise(ui.detailId);
    if (!ex) return;
    if (!confirm('„' + ex.name + '“ inklusive aller Trainingsdaten löschen?')) return;
    data.exercises = data.exercises.filter(function (e) { return e.id !== ex.id; });
    delete data.logs[ex.id];
    saveData();
    show('exercises');
  });

  function renderDetail() {
    var ex = getExercise(ui.detailId);
    if (!ex) { show('exercises'); return; }
    $('detail-name').textContent = ex.name;

    buildMetricToggle($('detail-metric-toggle'), ui.detailMetric, function (key) {
      ui.detailMetric = key;
      renderDetail();
    });

    var metric = ui.detailMetric;
    var series = exerciseSeries(ex.id, metric);
    $('detail-chart-empty').hidden = series.length > 0;
    $('detail-chart-hint').textContent = '';
    drawChart($('detail-chart'), series, {
      unit: 'kg',
      hintEl: $('detail-chart-hint'),
      hintFormat: function (pt) {
        return formatISO(pt.date, true) + ' – ' + formatNum(pt.value) + ' kg (' + metricLabel(metric) + ')';
      }
    });

    var hist = $('detail-history');
    hist.textContent = '';
    var log = data.logs[ex.id] || {};
    var dates = Object.keys(log).sort().reverse();
    if (!dates.length) {
      hist.appendChild(el('div', 'empty-hint', 'Noch keine Trainingstage.'));
    }
    dates.slice(0, 30).forEach(function (date) {
      var item = el('div', 'card history-item');
      item.appendChild(el('div', 'history-date', formatISOLong(date)));
      var setsTxt = log[date].map(function (s) {
        return formatNum(s.weight) + '×' + s.reps;
      }).join('  ·  ');
      var vol = dayMetric(log[date], 'volume');
      item.appendChild(el('div', 'history-sets', setsTxt + '  (Vol. ' + formatNum(vol, 0) + ' kg)'));
      hist.appendChild(item);
    });
  }

  function metricLabel(key) {
    for (var i = 0; i < METRICS.length; i++) if (METRICS[i].key === key) return METRICS[i].label;
    return key;
  }

  function buildMetricToggle(container, active, onChange) {
    container.textContent = '';
    METRICS.forEach(function (m) {
      var b = el('button', m.key === active ? 'active' : '', m.label);
      b.addEventListener('click', function () { onChange(m.key); });
      container.appendChild(b);
    });
  }

  /* ================= View: Statistik ================= */

  function renderStats() {
    buildMetricToggle($('stats-metric-toggle'), ui.statsMetric, function (key) {
      ui.statsMetric = key;
      renderStats();
    });

    var series = globalSeries(ui.statsMetric);
    $('stats-chart-empty').hidden = series.length > 0;
    $('stats-chart-hint').textContent = '';
    drawChart($('stats-chart'), series, {
      unit: '%',
      baseline: 100,
      hintEl: $('stats-chart-hint'),
      hintFormat: function (pt) {
        var diff = pt.value - 100;
        return formatISO(pt.date, true) + ' – ' + formatNum(pt.value, 1) + ' % (' +
          (diff >= 0 ? '+' : '') + formatNum(diff, 1) + ' % seit Start)';
      }
    });

    // Kennzahlen
    var allDates = {};
    var totalVolume = 0;
    Object.keys(data.logs).forEach(function (exId) {
      Object.keys(data.logs[exId]).forEach(function (date) {
        allDates[date] = true;
        totalVolume += dayMetric(data.logs[exId][date], 'volume') || 0;
      });
    });
    var grid = $('stats-numbers');
    grid.textContent = '';
    grid.appendChild(statBox(String(Object.keys(allDates).length), 'Trainingstage'));
    grid.appendChild(statBox(formatNum(totalVolume, 0), 'Gesamtvolumen (kg)'));
    grid.appendChild(statBox(String(data.exercises.length), 'Übungen'));
  }

  function statBox(val, lbl) {
    var box = el('div', 'stat-box');
    box.appendChild(el('div', 'val', val));
    box.appendChild(el('div', 'lbl', lbl));
    return box;
  }

  /* ================= Export / Import ================= */

  $('data-export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gym-tracker-backup-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  });

  $('data-import').addEventListener('click', function () { $('data-import-file').click(); });

  $('data-import-file').addEventListener('change', function () {
    var file = this.files[0];
    this.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.exercises) || typeof parsed.logs !== 'object') {
          throw new Error('bad format');
        }
        if (!confirm('Backup importieren? Die aktuellen Daten werden ersetzt.')) return;
        data = { exercises: parsed.exercises, logs: parsed.logs || {} };
        saveData();
        render();
        alert('Backup importiert.');
      } catch (e) {
        alert('Datei konnte nicht gelesen werden (kein gültiges Backup).');
      }
    };
    reader.readAsText(file);
  });

  /* ================= Chart (Canvas) ================= */

  /* Zeichnet ein Linienchart. points: [{date, value}] aufsteigend.
     opts: {unit, baseline?, hintEl?, hintFormat?} */
  function drawChart(canvas, points, opts) {
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || canvas.parentNode.clientWidth || 300;
    var cssH = canvas.clientHeight || 220;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    canvas.onclick = null;
    if (!points.length) return;

    var css = getComputedStyle(document.documentElement);
    var cAccent = css.getPropertyValue('--accent').trim() || '#4ade80';
    var cGrid = css.getPropertyValue('--border').trim() || '#2d3742';
    var cText = css.getPropertyValue('--text-dim').trim() || '#8fa0b0';

    var padL = 42, padR = 12, padT = 12, padB = 26;
    var plotW = cssW - padL - padR;
    var plotH = cssH - padT - padB;

    var min = Infinity, max = -Infinity;
    points.forEach(function (p) { min = Math.min(min, p.value); max = Math.max(max, p.value); });
    if (opts.baseline !== undefined) {
      min = Math.min(min, opts.baseline);
      max = Math.max(max, opts.baseline);
    }
    if (min === max) { min -= 1; max += 1; }
    var range = max - min;
    min -= range * 0.08;
    max += range * 0.08;

    function yPos(v) { return padT + plotH - ((v - min) / (max - min)) * plotH; }
    function xPos(i) {
      return points.length === 1 ? padL + plotW / 2 : padL + (i / (points.length - 1)) * plotW;
    }

    // Y-Gitter + Beschriftung
    ctx.font = '10px sans-serif';
    ctx.fillStyle = cText;
    ctx.strokeStyle = cGrid;
    ctx.lineWidth = 1;
    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var v = min + ((max - min) / ticks) * t;
      var y = yPos(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(cssW - padR, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(formatNum(v, range < 8 ? 1 : 0), padL - 6, y);
    }

    // Baseline (100 %) gestrichelt
    if (opts.baseline !== undefined) {
      ctx.save();
      ctx.strokeStyle = cText;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, yPos(opts.baseline));
      ctx.lineTo(cssW - padR, yPos(opts.baseline));
      ctx.stroke();
      ctx.restore();
    }

    // X-Beschriftung (max. ~5 Labels)
    ctx.textBaseline = 'top';
    var step = Math.max(1, Math.ceil(points.length / 5));
    for (var i = 0; i < points.length; i += step) {
      ctx.textAlign = i === 0 ? 'left' : 'center';
      ctx.fillText(formatISO(points[i].date), xPos(i), padT + plotH + 8);
    }

    // Fläche unter der Linie
    if (points.length > 1) {
      var grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, 'rgba(74, 222, 128, 0.22)');
      grad.addColorStop(1, 'rgba(74, 222, 128, 0)');
      ctx.beginPath();
      points.forEach(function (p, idx) {
        idx === 0 ? ctx.moveTo(xPos(idx), yPos(p.value)) : ctx.lineTo(xPos(idx), yPos(p.value));
      });
      ctx.lineTo(xPos(points.length - 1), padT + plotH);
      ctx.lineTo(xPos(0), padT + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Linie
      ctx.beginPath();
      points.forEach(function (p, idx) {
        idx === 0 ? ctx.moveTo(xPos(idx), yPos(p.value)) : ctx.lineTo(xPos(idx), yPos(p.value));
      });
      ctx.strokeStyle = cAccent;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // Punkte
    points.forEach(function (p, idx) {
      ctx.beginPath();
      ctx.arc(xPos(idx), yPos(p.value), points.length > 40 ? 2 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = cAccent;
      ctx.fill();
    });

    // Tap: nächstgelegenen Punkt im Hinweis anzeigen
    if (opts.hintEl && opts.hintFormat) {
      canvas.onclick = function (e) {
        var rect = canvas.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var best = 0, bestDist = Infinity;
        points.forEach(function (p, idx) {
          var d = Math.abs(xPos(idx) - x);
          if (d < bestDist) { bestDist = d; best = idx; }
        });
        opts.hintEl.textContent = opts.hintFormat(points[best]);
      };
    }
  }

  // Charts bei Größenänderung neu zeichnen
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (ui.view === 'exerciseDetail') renderDetail();
      else if (ui.view === 'stats') renderStats();
    }, 150);
  });

  /* ================= Start ================= */

  show('training');
})();
