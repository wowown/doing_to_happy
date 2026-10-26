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
    history: document.getElementById("history"),
    progressSelect: document.getElementById("progress-exercise"),
    chart: document.getElementById("chart"),
    pr: document.getElementById("pr"),
    statSessions: document.getElementById("stat-sessions"),
    statVolume: document.getElementById("stat-volume"),
    statExercises: document.getElementById("stat-exercises"),
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

  // ---------- 渲染 ----------
  function renderAll() {
    var s = L.stats(state.sessions);
    el.statSessions.textContent = s.sessions;
    el.statVolume.textContent = Math.round(s.volume).toLocaleString("zh-CN");
    el.statExercises.textContent = s.exercises;
    renderEntries();
    renderExerciseOptions();
    renderHistory();
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
          "上次 " + last.date.slice(5) + " " + last.best.weight + "kg × " + last.best.reps + " 次，容量 <b>" +
          L.entryVolume(last.entry) + "</b>";
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
        weight.step = "0.5";
        weight.placeholder = "kg";
        weight.value = set.weight;
        weight.addEventListener("input", function () {
          set.weight = weight.value; // 只改 state，不重画，否则输入会掉光标
        });
        row.appendChild(weight);

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
        entry.sets.push({ weight: "", reps: "" });
        renderEntries();
      });
      box.appendChild(addSet);

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
      right.textContent = "容量 " + L.sessionVolume(session);
      top.appendChild(date);
      top.appendChild(right);

      var body = document.createElement("div");
      body.className = "hist-body";
      body.textContent = L.summarizeSession(session);

      item.appendChild(top);
      item.appendChild(body);

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
    drawChart(points);

    if (points.length === 0) {
      el.pr.textContent = name ? "「" + name + "」还没有记录。" : "";
      return;
    }
    var pr = L.prForExercise(state.sessions, name);
    var first = points[0];
    var latest = points[points.length - 1];
    var gained = latest.weight - first.weight;
    var sign = gained > 0 ? "+" : "";
    el.pr.innerHTML =
      "最佳 <b>" + pr.weight + "kg × " + pr.reps + "</b>（" + pr.date + "）· 共 " + points.length +
      " 次 · 相对第一次 " + (gained === 0 ? "持平" : sign + gained + "kg");
  }

  /** 折线图：手画 canvas，不引图表库。只有一两个点时也能看出意思。 */
  function drawChart(points) {
    var canvas = el.chart;
    var dpr = window.devicePixelRatio || 1;
    var cssWidth = canvas.clientWidth || 520;
    var cssHeight = 150;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    var padLeft = 34;
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

    var weights = points.map(function (p) { return p.weight; });
    var minW = Math.min.apply(null, weights);
    var maxW = Math.max.apply(null, weights);
    if (maxW === minW) { // 一直同一个重量时给个上下空间，否则线贴在边上
      maxW = minW + 5;
      minW = Math.max(0, minW - 5);
    }

    function x(i) {
      return points.length === 1 ? padLeft + width / 2 : padLeft + (width * i) / (points.length - 1);
    }
    function y(w) {
      return padTop + height - (height * (w - minW)) / (maxW - minW);
    }

    // 网格 + y 轴刻度
    ctx.strokeStyle = "#262b36";
    ctx.lineWidth = 1;
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#8b93a7";
    [minW, (minW + maxW) / 2, maxW].forEach(function (value) {
      var py = y(value);
      ctx.beginPath();
      ctx.moveTo(padLeft, py);
      ctx.lineTo(cssWidth - padRight, py);
      ctx.stroke();
      ctx.fillText(Math.round(value) + "", 4, py + 4);
    });

    // 折线
    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(x(i), y(p.weight));
      else ctx.lineTo(x(i), y(p.weight));
    });
    ctx.stroke();

    // 数据点
    ctx.fillStyle = "#4ade80";
    points.forEach(function (p, i) {
      ctx.beginPath();
      ctx.arc(x(i), y(p.weight), 3, 0, Math.PI * 2);
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
  }

  // ---------- 交互 ----------
  function addExercise(name) {
    var trimmed = (name || "").trim();
    if (!trimmed) return;
    var existing = null;
    state.draft.entries.forEach(function (entry) {
      if (entry.name === trimmed) existing = entry;
    });
    if (existing) {
      existing.sets.push({ weight: "", reps: "" });
    } else {
      state.draft.entries.push({ name: trimmed, sets: [{ weight: "", reps: "" }] });
    }
    renderEntries();
    renderExerciseOptions();
  }

  el.date.addEventListener("change", function () {
    state.draft.date = el.date.value;
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

  el.exportBtn.addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(state.sessions, null, 2)], { type: "application/json" });
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
      if (!Array.isArray(incoming)) {
        alert("文件格式不对：应该是训练记录数组。");
        return;
      }
      var known = {};
      state.sessions.forEach(function (session) { known[session.id] = true; });
      var added = 0;
      incoming.map(L.normalizeSession).filter(Boolean).forEach(function (session) {
        if (known[session.id]) return;
        known[session.id] = true;
        state.sessions.push(session);
        added++;
      });
      persist();
      renderAll();
      alert("导入完成，新增 " + added + " 条。");
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
        ],
      });
    });
  }

  function init() {
    el.date.value = state.draft.date;
    if (/[?&]demo=1/.test(window.location.search)) seedDemo();
    else state.sessions = load();
    state.progressExercise = "卧推";
    if (el.progressSelect.options.length === 0) renderAll();
    renderAll();
  }

  window.addEventListener("resize", function () {
    renderProgress();
  });

  init();
})();
