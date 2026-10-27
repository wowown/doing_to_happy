/*
 * app.js — 界面逻辑。只做三件事：把 state 画成 DOM、把点击变成 state 变化、存取 localStorage。
 * 所有「算数」都在 logic.js 里，这里不重复实现一遍。
 */
(function () {
  "use strict";

  var L = window.FitnessLogic;

  // ---------- state ----------
  // sessions：已保存的训练（数组，新的在后，展示时再排序）
  // draft   ：正在填的这一条。输入框里可以是空字符串，保存时才清洗。
  var state = {
    sessions: [],
    weights: [],
    // unit：当前默认重量单位（kg/lb）。只影响新加的组和展示，已有记录保留自己的原始单位。
    unit: "kg",
    draft: { date: L.todayISO(), note: "", entries: [] },
    progressExercise: "",
    demoMode: false,
  };

  var el = {
    date: document.getElementById("date"),
    note: document.getElementById("note"),
    entries: document.getElementById("entries"),
    select: document.getElementById("exercise-select"),
    custom: document.getElementById("custom-exercise"),
    save: document.getElementById("save"),
    unitSwitch: document.getElementById("unit-switch"),
    history: document.getElementById("history"),
    progressSelect: document.getElementById("progress-exercise"),
    chart: document.getElementById("chart"),
    pr: document.getElementById("pr"),
    weightDate: document.getElementById("weight-date"),
    weightKg: document.getElementById("weight-kg"),
    saveWeight: document.getElementById("save-weight"),
    weightStats: document.getElementById("weight-stats"),
    weightChart: document.getElementById("weight-chart"),
    weightList: document.getElementById("weight-list"),
    statSessions: document.getElementById("stat-sessions"),
    statVolume: document.getElementById("stat-volume"),
    statExercises: document.getElementById("stat-exercises"),
    statCalories: document.getElementById("stat-calories"),
    exportBtn: document.getElementById("export"),
    importBtn: document.getElementById("import-btn"),
    importFile: document.getElementById("import-file"),
    banner: document.getElementById("demo-banner"),
  };

  // ---------- 存储 ----------
  function load() {
    try {
      var raw = localStorage.getItem(L.STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // 存进去的东西也可能被手改坏，读出来统一清洗一遍
      return parsed.map(L.normalizeSession).filter(Boolean);
    } catch (error) {
      console.warn("读取本地数据失败，从空记录开始", error);
      return [];
    }
  }

  function persist() {
    if (state.demoMode) return; // 示例数据不落盘，免得污染真记录
    try {
      localStorage.setItem(L.STORAGE_KEY, JSON.stringify(state.sessions));
    } catch (error) {
      alert("保存失败：浏览器可能禁用了本地存储（无痕模式？）。\n" + error.message);
    }
  }

  /** 体重记录：独立存储键，和训练记录分开存。 */
  function loadWeights() {
    try {
      var raw = localStorage.getItem(L.WEIGHT_STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(L.normalizeWeightEntry).filter(Boolean);
    } catch (error) {
      console.warn("读取体重记录失败，从空记录开始", error);
      return [];
    }
  }

  function persistWeights() {
    if (state.demoMode) return;
    try {
      localStorage.setItem(L.WEIGHT_STORAGE_KEY, JSON.stringify(state.weights));
    } catch (error) {
      alert("体重保存失败：浏览器可能禁用了本地存储。\n" + error.message);
    }
  }

  /** 单位偏好：只记住「下次新组默认用哪个」，不影响已存记录。 */
  function loadUnit() {
    try {
      return localStorage.getItem(L.UNIT_STORAGE_KEY) === "lb" ? "lb" : "kg";
    } catch (error) {
      return "kg";
    }
  }

  function persistUnit() {
    try {
      localStorage.setItem(L.UNIT_STORAGE_KEY, state.unit);
    } catch (error) {
      /* 记不住偏好不影响记训练，静默放过 */
    }
  }

  // ---------- 渲染 ----------
  /** 某天的体重（当天或之前最近一次）。没有记录返回 null，交给 logic 兜底。 */
  function bodyKgOn(date) {
    return L.bodyKgOn(state.weights, date);
  }

  /** 「按 72.1kg 估」或「按 70kg 估（没有体重记录）」，让人知道数字怎么来的。 */
  function calorieBasisText(date) {
    var kg = bodyKgOn(date);
    if (kg === null) return "按 " + L.DEFAULT_BODY_KG + "kg 估（没有体重记录）";
    return "按 " + L.fmtNumber(kg) + "kg 估";
  }

  function renderAll() {
    var s = L.stats(state.sessions);
    el.statSessions.textContent = s.sessions;
    el.statVolume.textContent = Math.round(s.volume).toLocaleString("zh-CN");
    el.statExercises.textContent = s.exercises;
    // 每次训练用它自己那天的体重算，再加总
    var calories = state.sessions.reduce(function (sum, session) {
      return sum + L.caloriesForSession(session, bodyKgOn(session.date));
    }, 0);
    el.statCalories.textContent = calories.toLocaleString("zh-CN");
    el.statCalories.title = "按 MET 估算，每组 2 分钟，误差可能有 ±30%";
    renderEntries();
    renderExerciseOptions();
    renderUnitSwitch();
    renderHistory();
    renderWeight();
    renderProgress();
  }

  function renderEntries() {
    el.entries.innerHTML = "";
    if (state.draft.entries.length === 0) {
      var tip = document.createElement("div");
      tip.className = "empty";
      tip.textContent = "还没加动作。上面选一个动作，或者输入自定义名字。";
      el.entries.appendChild(tip);
      return;
    }

    state.draft.entries.forEach(function (entry, entryIndex) {
      var box = document.createElement("div");
      box.className = "entry";

      var head = document.createElement("div");
      head.className = "entry-head";
      var name = document.createElement("div");
      name.className = "entry-name";
      name.textContent = entry.name;
      var remove = document.createElement("button");
      remove.className = "del";
      remove.textContent = "删除动作";
      remove.addEventListener("click", function () {
        state.draft.entries.splice(entryIndex, 1);
        renderEntries();
      });
      head.appendChild(name);
      head.appendChild(remove);
      box.appendChild(head);

      // 上次成绩：这是「进步」的参照物，比任何图表都直接
      var last = L.lastForExercise(state.sessions, entry.name);
      var hint = document.createElement("div");
      hint.className = "hint";
      if (last) {
        hint.innerHTML =
          "上次 " + last.date.slice(5) + " <b>" + L.formatSet(last.best) + "</b> 次，容量 " +
          Math.round(L.entryVolume(last.entry)) + " kg";
      } else {
        hint.textContent = "没练过这个动作，今天是基线。";
      }
      box.appendChild(hint);

      var sets = document.createElement("div");
      sets.className = "sets";
      entry.sets.forEach(function (set, setIndex) {
        var row = document.createElement("div");
        row.className = "set-row";

        var idx = document.createElement("div");
        idx.className = "idx";
        idx.textContent = "第" + (setIndex + 1) + "组";
        row.appendChild(idx);

        var weight = document.createElement("input");
        weight.type = "number";
        weight.inputMode = "decimal";
        weight.min = "0";
        weight.step = set.unit === "lb" ? "1" : "0.5";
        weight.placeholder = set.unit;
        weight.value = set.weight;
        weight.addEventListener("input", function () {
          set.weight = weight.value; // 只改 state，不重画，否则输入会掉光标
          // 记住精确的 kg 值：单位来回切换时靠它复原，避免 111 → 50.3 → 110.9 这种漂移
          var n = Number(weight.value);
          set._kg = weight.value !== "" && isFinite(n) ? L.setToKg({ weight: n, unit: set.unit }) : null;
        });
        row.appendChild(weight);

        // 每组的单位按钮：点一下在这组自己的 kg/lb 之间切换，数字会跟着换算。
        // 组级单位是必需的——同一次训练里可能一台磅器械、一台 kg 器械。
        var unitBtn = document.createElement("button");
        unitBtn.className = "mini unit-btn";
        unitBtn.textContent = set.unit;
        unitBtn.title = "切换这一组的单位（数字会换算，重量不变）";
        unitBtn.addEventListener("click", function () {
          // 优先用精确值算，没有（比如空组）就按当前显示值算
          var kg = set._kg !== undefined && set._kg !== null ? set._kg : L.setToKg(set);
          var next = set.unit === "kg" ? "lb" : "kg";
          set.unit = next;
          if (set.weight !== "" && isFinite(kg)) {
            set.weight = Math.round(L.kgToUnit(kg, next) * 10) / 10;
            set._kg = kg; // 精确值跨切换保留，来回点不会累积误差
          }
          renderEntries();
        });
        row.appendChild(unitBtn);

        var times = document.createElement("div");
        times.className = "unit";
        times.textContent = "×";
        row.appendChild(times);

        var reps = document.createElement("input");
        reps.type = "number";
        reps.inputMode = "numeric";
        reps.min = "1";
        reps.step = "1";
        reps.placeholder = "次数";
        reps.value = set.reps;
        reps.addEventListener("input", function () {
          set.reps = reps.value;
        });
        row.appendChild(reps);

        var del = document.createElement("button");
        del.className = "del";
        del.textContent = "✕";
        del.title = "删掉这一组";
        del.addEventListener("click", function () {
          entry.sets.splice(setIndex, 1);
          renderEntries();
        });
        row.appendChild(del);

        sets.appendChild(row);
      });

      if (entry.sets.length === 0) {
        var none = document.createElement("div");
        none.className = "sets-empty";
        none.textContent = "还没有组，点下面「+ 一组」。";
        sets.appendChild(none);
      }
      box.appendChild(sets);

      var addSet = document.createElement("button");
      addSet.className = "mini ghost";
      addSet.style.marginTop = "8px";
      addSet.textContent = "+ 一组";
      addSet.addEventListener("click", function () {
        entry.sets.push(emptySet());
        renderEntries();
      });
      box.appendChild(addSet);

      // 这个动作当前的估算热量：填了几组就算几组，空组不算
      var filled = entry.sets.filter(function (set) {
        var w = Number(set.weight);
        var r = Number(set.reps);
        return set.weight !== "" && set.reps !== "" && isFinite(w) && isFinite(r) && r > 0;
      }).length;
      if (filled > 0) {
        var bodyKg = bodyKgOn(state.draft.date);
        var kcal = L.caloriesForEntry({ name: entry.name, sets: new Array(filled).fill(null) }, bodyKg);
        var perSet = L.caloriesForEntry({ name: entry.name, sets: [null] }, bodyKg);
        var calLine = document.createElement("div");
        calLine.className = "hint";
        calLine.style.marginTop = "8px";
        calLine.innerHTML = "本次 " + filled + " 组 ≈ <b>" + kcal + "</b> kcal（每组 ≈" + perSet + "）· " +
          calorieBasisText(state.draft.date);
        box.appendChild(calLine);
      }

      el.entries.appendChild(box);
    });
  }

  function renderExerciseOptions() {
    var names = L.DEFAULT_EXERCISES.slice();
    L.usedExercises(state.sessions).forEach(function (name) {
      if (names.indexOf(name) === -1) names.push(name);
    });
    // 自定义动作也要能继续练
    state.draft.entries.forEach(function (entry) {
      if (names.indexOf(entry.name) === -1) names.push(entry.name);
    });

    var current = el.select.value;
    el.select.innerHTML = "";
    names.forEach(function (name) {
      var option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      el.select.appendChild(option);
    });
    if (current && names.indexOf(current) !== -1) el.select.value = current;

    var progressCurrent = state.progressExercise || names[0] || "";
    el.progressSelect.innerHTML = "";
    names.forEach(function (name) {
      var option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      el.progressSelect.appendChild(option);
    });
    el.progressSelect.value = progressCurrent;
    state.progressExercise = progressCurrent;
  }

  /**
   * 单位切换控件：只改「默认单位」，新加的组会用它。
   * 已经填好的组保留自己的单位——那是当时器械的刻度，不能事后改。
   */
  function renderUnitSwitch() {
    if (!el.unitSwitch) return;
    el.unitSwitch.innerHTML = "";
    ["kg", "lb"].forEach(function (unit) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = unit;
      btn.className = state.unit === unit ? "on" : "";
      btn.title = "新加的组默认用 " + unit;
      btn.addEventListener("click", function () {
        state.unit = unit;
        persistUnit();
        renderUnitSwitch();
      });
      el.unitSwitch.appendChild(btn);
    });
  }

  function renderHistory() {
    el.history.innerHTML = "";
    var sessions = L.sortSessionsDesc(state.sessions);
    if (sessions.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "还没有记录。上面填一次，保存后就会出现在这里。";
      el.history.appendChild(empty);
      return;
    }

    sessions.forEach(function (session) {
      var item = document.createElement("div");
      item.className = "hist-item";

      var top = document.createElement("div");
      top.className = "hist-top";
      var date = document.createElement("div");
      date.className = "hist-date";
      date.textContent = session.date;
      var right = document.createElement("div");
      right.className = "hist-date";
      // 容量统一用 kg 展示，且取整：混着磅的记录换算后会出现 2245.5681735 这种数
      right.textContent = "容量 " + Math.round(L.sessionVolume(session)).toLocaleString("zh-CN") + " kg";
      top.appendChild(date);
      top.appendChild(right);

      var body = document.createElement("div");
      body.className = "hist-body";
      body.textContent = L.summarizeSession(session);

      item.appendChild(top);
      item.appendChild(body);

      // 热量按这次训练当天的体重估，并写明依据，避免让人以为是精确测出来的
      var kcal = L.caloriesForSession(session, bodyKgOn(session.date));
      var calNote = document.createElement("div");
      calNote.className = "hist-note";
      calNote.textContent = "≈ " + kcal + " kcal · " + calorieBasisText(session.date) + " · 每组按 2 分钟";
      item.appendChild(calNote);

      if (session.note) {
        var note = document.createElement("div");
        note.className = "hist-note";
        note.textContent = session.note;
        item.appendChild(note);
      }

      el.history.appendChild(item);
    });
  }

  function renderProgress() {
    var name = state.progressExercise;
    var points = name ? L.seriesForExercise(state.sessions, name) : [];
    var unit = state.unit;
    // 曲线用当前显示单位画：混着 kg 和 lb 的记录，靠 kg 换算值排在同一条尺子上
    drawSeries(
      el.chart,
      points.map(function (p) { return { date: p.date, value: L.kgToUnit(p.kg, unit) }; }),
      { color: "#4ade80", height: 150, unit: unit }
    );

    if (points.length === 0) {
      el.pr.textContent = name ? "「" + name + "」还没有记录。" : "";
      return;
    }
    var pr = L.prForExercise(state.sessions, name);
    var first = points[0];
    var latest = points[points.length - 1];
    var gainedKg = latest.kg - first.kg;
    var gainedInUnit = Math.round(L.kgToUnit(gainedKg, unit) * 10) / 10;
    // PR 显示他真正举的那个数（原始单位）；跟当前显示单位不同时补一个换算值，
    // 免得出现「最佳 60kg … 相对第一次 +22lb」这种一句话两种单位。
    var prText = "最佳 <b>" + L.fmtNumber(pr.weight) + pr.unit + " × " + pr.reps + "</b>";
    if (pr.unit !== unit) {
      prText += "（≈" + L.fmtNumber(Math.round(L.kgToUnit(pr.kg, unit) * 10) / 10) + unit + "）";
    }
    el.pr.innerHTML =
      prText + "（" + pr.date + "）· 共 " + points.length + " 次 · 相对第一次 " +
      (Math.abs(gainedKg) < 0.05 ? "持平" : (gainedKg > 0 ? "+" : "") + L.fmtNumber(gainedInUnit) + unit);
  }

  /** 体重区：统计文案 + 曲线 + 最近几条（可删）。 */
  function renderWeight() {
    var sorted = L.sortWeightsAsc(state.weights);
    var latest = L.latestWeight(state.weights);
    var change = L.weightChange(state.weights);

    if (!latest) {
      el.weightStats.textContent = "还没有体重记录。填个数字保存，就会开始画曲线。";
    } else {
      var text = "最近 <b>" + latest.kg + " kg</b>（" + latest.date + "）";
      if (change !== null) {
        text += " · 共 " + sorted.length + " 次 · 相对第一次 " +
          (change === 0 ? "持平" : (change > 0 ? "+" : "") + change.toFixed(1) + " kg");
      }
      el.weightStats.innerHTML = text;
    }

    drawSeries(
      el.weightChart,
      sorted.map(function (entry) { return { date: entry.date, value: entry.kg }; }),
      { color: "#60a5fa", height: 130 }
    );

    el.weightList.innerHTML = "";
    if (sorted.length === 0) return;
    // 只显示最近 8 条：翻旧记录不是这个应用的主要用途，占屏反而挡路
    sorted.slice(-8).reverse().forEach(function (entry) {
      var row = document.createElement("div");
      row.className = "hist-top";
      var left = document.createElement("div");
      left.className = "hist-date";
      left.textContent = entry.date;
      var right = document.createElement("div");
      right.className = "row";
      var value = document.createElement("div");
      value.textContent = entry.kg + " kg";
      var del = document.createElement("button");
      del.className = "del";
      del.textContent = "✕";
      del.title = "删掉这条体重";
      del.addEventListener("click", function () {
        state.weights = state.weights.filter(function (item) {
          return item.date !== entry.date;
        });
        persistWeights();
        renderWeight();
      });
      right.appendChild(value);
      right.appendChild(del);
      row.appendChild(left);
      row.appendChild(right);
      el.weightList.appendChild(row);
    });
  }

  /**
   * 通用折线图：点用 {date, value}。训练曲线和体重曲线共用一套画法，
   * 免得两份几乎一样的 canvas 代码各自长歪、只修好其中一份。
   */
  function drawSeries(canvas, points, options) {
    var opts = options || {};
    var color = opts.color || "#4ade80";
    var cssHeight = opts.height || 150;
    var unit = opts.unit || "";

    var dpr = window.devicePixelRatio || 1;
    var cssWidth = canvas.clientWidth || 520;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    var padLeft = 40;
    var padRight = 10;
    var padTop = 14;
    var padBottom = 22;
    var width = cssWidth - padLeft - padRight;
    var height = cssHeight - padTop - padBottom;

    if (points.length === 0) {
      ctx.fillStyle = "#8b93a7";
      ctx.font = "12px sans-serif";
      ctx.fillText("还没有数据", padLeft, padTop + height / 2);
      return;
    }

    var values = points.map(function (p) { return p.value; });
    var minValue = Math.min.apply(null, values);
    var maxValue = Math.max.apply(null, values);
    if (maxValue === minValue) { // 一直同一个数值时给上下空间，否则线贴在边上
      maxValue = minValue + 2;
      minValue = Math.max(0, minValue - 2);
    }

    function x(i) {
      return points.length === 1 ? padLeft + width / 2 : padLeft + (width * i) / (points.length - 1);
    }
    function y(value) {
      return padTop + height - (height * (value - minValue)) / (maxValue - minValue);
    }
    function formatLabel(value) {
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
    }

    // 网格 + y 轴刻度
    ctx.strokeStyle = "#262b36";
    ctx.lineWidth = 1;
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#8b93a7";
    [minValue, (minValue + maxValue) / 2, maxValue].forEach(function (value) {
      var py = y(value);
      ctx.beginPath();
      ctx.moveTo(padLeft, py);
      ctx.lineTo(cssWidth - padRight, py);
      ctx.stroke();
      ctx.fillText(formatLabel(value), 4, py + 4);
    });

    // 折线
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(x(i), y(p.value));
      else ctx.lineTo(x(i), y(p.value));
    });
    ctx.stroke();

    // 数据点
    ctx.fillStyle = color;
    points.forEach(function (p, i) {
      ctx.beginPath();
      ctx.arc(x(i), y(p.value), 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // x 轴首尾日期
    ctx.fillStyle = "#8b93a7";
    ctx.font = "11px sans-serif";
    ctx.fillText(points[0].date.slice(5), padLeft, cssHeight - 6);
    if (points.length > 1) {
      var label = points[points.length - 1].date.slice(5);
      var textWidth = ctx.measureText(label).width;
      ctx.fillText(label, cssWidth - padRight - textWidth, cssHeight - 6);
    }

    // 单位标在右上角，免得看曲线时还要猜是 kg 还是 lb
    if (unit) {
      var unitWidth = ctx.measureText(unit).width;
      ctx.fillText(unit, cssWidth - padRight - unitWidth, padTop - 4);
    }
  }

  // ---------- 交互 ----------
  /** 新加的空组用当前默认单位。已有组的单位不动。 */
  function emptySet() {
    return { weight: "", reps: "", unit: state.unit };
  }

  function addExercise(name) {
    var trimmed = (name || "").trim();
    if (!trimmed) return;
    var existing = null;
    state.draft.entries.forEach(function (entry) {
      if (entry.name === trimmed) existing = entry;
    });
    if (existing) {
      existing.sets.push(emptySet());
    } else {
      state.draft.entries.push({ name: trimmed, sets: [emptySet()] });
    }
    renderEntries();
    renderExerciseOptions();
  }

  el.date.addEventListener("change", function () {
    state.draft.date = el.date.value;
    renderEntries(); // 热量是按「当天体重」估的，日期变了要跟着重算
  });
  el.note.addEventListener("input", function () {
    state.draft.note = el.note.value;
  });
  el.select.addEventListener("change", function () {
    state.progressExercise = el.progressSelect.value;
  });

  document.getElementById("add-exercise").addEventListener("click", function () {
    addExercise(el.select.value);
  });
  document.getElementById("add-custom").addEventListener("click", function () {
    addExercise(el.custom.value);
    el.custom.value = "";
  });
  el.custom.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    addExercise(el.custom.value);
    el.custom.value = "";
  });

  el.save.addEventListener("click", function () {
    if (state.demoMode) {
      alert("示例模式不保存。用 index.html 正常打开再记。");
      return;
    }
    var cleaned = L.normalizeSession({
      date: el.date.value || state.draft.date,
      note: state.draft.note,
      entries: state.draft.entries,
    });
    if (!cleaned) {
      alert("这次训练还存不了：至少要有 1 个动作，且每个动作至少有 1 组填了「重量」和「次数」。");
      return;
    }
    // id 用时间戳，导入合并时靠它去重
    cleaned.id = "s-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
    state.sessions.push(cleaned);
    persist();
    state.draft = { date: cleaned.date, note: "", entries: [] };
    el.note.value = "";
    renderAll();
  });

  el.progressSelect.addEventListener("change", function () {
    state.progressExercise = el.progressSelect.value;
    renderProgress();
  });

  // 存体重：同一天覆盖。体重和训练是两件事，不要求你同时记。
  el.saveWeight.addEventListener("click", function () {
    if (state.demoMode) {
      alert("示例模式不保存。用 index.html 正常打开再记。");
      return;
    }
    var entry = L.normalizeWeightEntry({
      date: el.weightDate.value || L.todayISO(),
      kg: el.weightKg.value,
    });
    if (!entry) {
      alert("体重存不了：请填一个 0–500 之间的数字（kg），日期也要有效。");
      return;
    }
    state.weights = L.upsertWeight(state.weights, entry);
    persistWeights();
    el.weightKg.value = "";
    renderWeight();
  });

  el.weightKg.addEventListener("keydown", function (event) {
    if (event.key === "Enter") el.saveWeight.click();
  });

  el.exportBtn.addEventListener("click", function () {
    // 备份必须一次带走全部数据：只导出训练记录的话，体重就漏在外面了。
    var payload = {
      app: "fitness-tracker",
      version: 2,
      exportedAt: new Date().toISOString(),
      sessions: state.sessions,
      weights: state.weights,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "training-" + L.todayISO() + ".json";
    a.click();
    URL.revokeObjectURL(url);
  });

  el.importBtn.addEventListener("click", function () {
    el.importFile.click();
  });

  el.importFile.addEventListener("change", function () {
    var file = el.importFile.files && el.importFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var incoming;
      try {
        incoming = JSON.parse(String(reader.result));
      } catch (error) {
        alert("这个文件不是合法 JSON。");
        return;
      }

      // 两种格式都认：旧版直接是训练记录数组，新版是 {sessions, weights} 对象
      var incomingSessions;
      var incomingWeights;
      if (Array.isArray(incoming)) {
        incomingSessions = incoming;
        incomingWeights = [];
      } else if (incoming && Array.isArray(incoming.sessions)) {
        incomingSessions = incoming.sessions;
        incomingWeights = Array.isArray(incoming.weights) ? incoming.weights : [];
      } else {
        alert("文件格式不对：既不是训练记录数组，也不是带 sessions 的对象。");
        return;
      }

      var known = {};
      state.sessions.forEach(function (session) { known[session.id] = true; });
      var addedSessions = 0;
      incomingSessions.map(L.normalizeSession).filter(Boolean).forEach(function (session) {
        if (known[session.id]) return;
        known[session.id] = true;
        state.sessions.push(session);
        addedSessions++;
      });

      var addedWeights = 0;
      incomingWeights.map(L.normalizeWeightEntry).filter(Boolean).forEach(function (entry) {
        var before = state.weights.length;
        var latestSameDay = state.weights.filter(function (item) { return item.date === entry.date; })[0];
        // 已有的同日体重不覆盖（本地记录优先），只补新日期
        if (latestSameDay) return;
        state.weights = L.upsertWeight(state.weights, entry);
        if (state.weights.length > before) addedWeights++;
      });

      persist();
      persistWeights();
      renderAll();
      alert("导入完成：训练记录新增 " + addedSessions + " 条，体重新增 " + addedWeights + " 条。");
      el.importFile.value = "";
    };
    reader.readAsText(file);
  });

  // ---------- 启动 ----------
  function seedDemo() {
    // 示例数据：让看图的人立刻看到曲线长什么样。只在 ?demo=1 时用，不写 localStorage。
    state.demoMode = true;
    el.banner.hidden = false;
    var plan = [
      { date: "2026-01-06", weight: 50, reps: 10 },
      { date: "2026-01-13", weight: 52.5, reps: 10 },
      { date: "2026-01-20", weight: 55, reps: 8 },
      { date: "2026-01-27", weight: 57.5, reps: 8 },
      { date: "2026-02-03", weight: 60, reps: 8 },
      { date: "2026-02-10", weight: 60, reps: 10 },
    ];
    state.sessions = plan.map(function (row, i) {
      return L.normalizeSession({
        id: "demo-" + i,
        date: row.date,
        note: i === 5 ? "最后一组感觉还有余力" : "",
        entries: [
          { name: "卧推", sets: [{ weight: row.weight, reps: row.reps }, { weight: row.weight, reps: row.reps - 2 }] },
          { name: "深蹲", sets: [{ weight: 80 + i * 2.5, reps: 5 }] },
          // 一个用磅记录的器械，用来演示同一份记录里混着两种单位
          { name: "坐姿划船", sets: [{ weight: 100 + i * 11, reps: 10, unit: "lb" }] },
        ],
      });
    });

    // 体重示例：和训练同步下降，让人看得出曲线之间有关系
    state.weights = plan.map(function (row, i) {
      return L.normalizeWeightEntry({ date: row.date, kg: 78 - i * 0.6 });
    });
  }

  function init() {
    el.date.value = state.draft.date;
    el.weightDate.value = L.todayISO();
    state.unit = loadUnit();
    if (/[?&]demo=1/.test(window.location.search)) {
      seedDemo();
    } else {
      state.sessions = load();
      state.weights = loadWeights();
    }
    state.progressExercise = "卧推";
    renderAll();
  }

  window.addEventListener("resize", function () {
    renderProgress();
    renderWeight();
  });

  init();
})();
