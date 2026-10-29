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
    cardio: [],
    // unit：当前默认重量单位（kg/lb）。只影响新加的组和展示，已有记录保留自己的原始单位。
    unit: "kg",
    // dayDate：下面「某一天」卡片正在看哪天。默认今天。
    dayDate: L.todayISO(),
    // exerciseFilter：动作搜索关键词，只影响下拉框里能看到哪些动作
    exerciseFilter: "",
    // cardioDate：有氧卡片正在记录的日期
    cardioDate: L.todayISO(),
    draft: { date: L.todayISO(), note: "", entries: [] },
    progressExercise: "",
    demoMode: false,
  };

  var el = {
    date: document.getElementById("date"),
    note: document.getElementById("note"),
    entries: document.getElementById("entries"),
    select: document.getElementById("exercise-select"),
    exerciseFilter: document.getElementById("exercise-filter"),
    custom: document.getElementById("custom-exercise"),
    save: document.getElementById("save"),
    unitSwitch: document.getElementById("unit-switch"),
    dayDate: document.getElementById("day-date"),
    dayPrev: document.getElementById("day-prev"),
    dayNext: document.getElementById("day-next"),
    dayToday: document.getElementById("day-today"),
    daySummary: document.getElementById("day-summary"),
    dayBody: document.getElementById("day-body"),
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
    cardioDate: document.getElementById("cardio-date"),
    cardioType: document.getElementById("cardio-type"),
    cardioMinutes: document.getElementById("cardio-minutes"),
    cardioIntensity: document.getElementById("cardio-intensity"),
    cardioDistance: document.getElementById("cardio-distance"),
    saveCardio: document.getElementById("save-cardio"),
    cardioList: document.getElementById("cardio-list"),
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

  /** 有氧记录：第三个独立存储键。 */
  function loadCardio() {
    try {
      var raw = localStorage.getItem(L.CARDIO_STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(L.normalizeCardioEntry).filter(Boolean);
    } catch (error) {
      console.warn("读取有氧记录失败，从空记录开始", error);
      return [];
    }
  }

  function persistCardio() {
    if (state.demoMode) return;
    try {
      localStorage.setItem(L.CARDIO_STORAGE_KEY, JSON.stringify(state.cardio));
    } catch (error) {
      alert("有氧保存失败：浏览器可能禁用了本地存储。\n" + error.message);
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
    // 力量按每次训练当天的体重算，有氧按有氧当天的体重算，最后加总
    var strengthCalories = state.sessions.reduce(function (sum, session) {
      return sum + L.caloriesForSession(session, bodyKgOn(session.date));
    }, 0);
    var cardioCalories = state.cardio.reduce(function (sum, entry) {
      return sum + L.caloriesForCardio(entry, bodyKgOn(entry.date));
    }, 0);
    el.statCalories.textContent = (strengthCalories + cardioCalories).toLocaleString("zh-CN");
    el.statCalories.title = "力量 ≈" + strengthCalories + " + 有氧 ≈" + cardioCalories +
      "（按 MET 估算，误差可能有 ±30%）";
    renderEntries();
    renderExerciseOptions();
    renderUnitSwitch();
    renderCardio();
    renderDay();
    renderDayList();
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
          refreshCal(); // 热量跟这组的重量有关，改重量就要跟着变
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
          refreshCal();
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

      // 这个动作当前的估算热量：填了几组就算几组，空组不算。
      // 逐组算，因为热量现在跟「这一组有多重」有关——20kg 和 60kg 不再是同一个数。
      // 单独抽成函数是为了在输入时只更新这一行，不整块重画（重画会掉光标）。
      var calLine = document.createElement("div");
      calLine.className = "hint";
      calLine.style.marginTop = "8px";
      calLine.title = "MET 按「单组重量 ÷ 体重」分档：<0.3 轻(3.5) · 0.3–0.6 中(5.0) · ≥0.6 强(6.0)";
      box.appendChild(calLine);

      function refreshCal() {
        var filledSets = entry.sets.filter(function (set) {
          var w = Number(set.weight);
          var r = Number(set.reps);
          return set.weight !== "" && set.reps !== "" && isFinite(w) && isFinite(r) && r > 0;
        });
        if (filledSets.length === 0) {
          calLine.style.display = "none";
          return;
        }
        calLine.style.display = "";
        var bodyKg = bodyKgOn(state.draft.date);
        var perSet = L.caloriesPerSet({ name: entry.name, sets: filledSets }, bodyKg);
        var kcal = perSet.reduce(function (sum, value) {
          return sum + value;
        }, 0);
        var sameEach = perSet.every(function (value) {
          return value === perSet[0];
        });
        var detail = sameEach ? "每组 ≈" + perSet[0] : "逐组 " + perSet.join(" / ");
        calLine.innerHTML = "本次 " + filledSets.length + " 组 ≈ <b>" + kcal + "</b> kcal（" + detail + "）· " +
          calorieBasisText(state.draft.date);
      }
      refreshCal();

      el.entries.appendChild(box);
    });
  }

  /**
   * 动作下拉框。搜索框有内容时只留下名字里包含关键词的选项（包含匹配，
   * 不是开头匹配——输「推」要能找到「史密斯上斜推胸」）。
   * 排序：练得最多的在前，然后默认动作库，最后是自定义动作。
   */
  function renderExerciseOptions() {
    var allNames = L.DEFAULT_EXERCISES.slice();
    var used = L.usedExercises(state.sessions);
    used.forEach(function (name) {
      if (allNames.indexOf(name) === -1) allNames.push(name);
    });
    // 自定义动作也要能继续练
    state.draft.entries.forEach(function (entry) {
      if (allNames.indexOf(entry.name) === -1) allNames.push(entry.name);
    });
    // 常用动作提到前面：常在练的不用滚
    allNames.sort(function (a, b) {
      var ia = used.indexOf(a);
      var ib = used.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return 0;
    });

    var keyword = (state.exerciseFilter || "").trim();
    var matched = keyword
      ? allNames.filter(function (name) {
          return name.indexOf(keyword) !== -1;
        })
      : allNames;

    var current = el.select.value;
    el.select.innerHTML = "";
    if (matched.length === 0) {
      // 没有匹配时给一条提示，而不是留个空下拉框让人以为坏了
      var none = document.createElement("option");
      none.value = "";
      none.textContent = "没有匹配的动作，用下面「没有的动作用这里」添加";
      none.disabled = true;
      none.selected = true;
      el.select.appendChild(none);
    } else {
      matched.forEach(function (name) {
        var option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        el.select.appendChild(option);
      });
      // 原来的选中项还在就保持，否则落到第一个匹配项，让「+ 加动作」和回车都能直接用
      el.select.value = current && matched.indexOf(current) !== -1 ? current : matched[0];
    }

    // 曲线选择器的选项要全（不受搜索影响），只在列表变化时重画
    var progressCurrent = state.progressExercise || allNames[0] || "";
    el.progressSelect.innerHTML = "";
    allNames.forEach(function (name) {
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

  /**
   * 有氧区：类型和强度下拉只建一次，下面列出所选日期已记的有氧（可删）。
   * 距离输入只对有距离意义的项目显示——跳绳填「距离」没有意义。
   */
  var cardioFormReady = false;
  function renderCardio() {
    el.cardioDate.value = state.cardioDate;
    if (!cardioFormReady) {
      el.cardioType.innerHTML = "";
      L.CARDIO_TYPES.forEach(function (info) {
        var option = document.createElement("option");
        option.value = info.name;
        option.textContent = info.name;
        el.cardioType.appendChild(option);
      });
      el.cardioIntensity.innerHTML = "";
      L.CARDIO_INTENSITY.forEach(function (item) {
        var option = document.createElement("option");
        option.value = item.key;
        option.textContent = item.key + "强度";
        el.cardioIntensity.appendChild(option);
      });
      el.cardioIntensity.value = "中";
      cardioFormReady = true;
    }

    var info = L.cardioTypeInfo(el.cardioType.value);
    el.cardioDistance.style.display = info && info.hasDistance ? "" : "none";

    var todays = L.cardioOn(state.cardio, state.cardioDate);
    var basis = bodyKgOn(state.cardioDate);
    el.cardioList.innerHTML = "";
    if (todays.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "这天还没有有氧记录。";
      el.cardioList.appendChild(empty);
      return;
    }

    todays.forEach(function (entry) {
      var row = document.createElement("div");
      row.className = "hist-top";
      var left = document.createElement("div");
      left.textContent = L.formatCardio(entry);
      var right = document.createElement("div");
      right.className = "row";
      var kcal = document.createElement("div");
      kcal.className = "hist-date";
      kcal.textContent = "≈" + L.caloriesForCardio(entry, basis) + " kcal";
      var del = document.createElement("button");
      del.className = "del";
      del.textContent = "✕";
      del.title = "删掉这条有氧";
      del.addEventListener("click", function () {
        // 按对象引用删，比用下标稳（列表随时可能重排）
        state.cardio = state.cardio.filter(function (item) {
          return item !== entry;
        });
        persistCardio();
        renderAll();
      });
      right.appendChild(kcal);
      right.appendChild(del);
      row.appendChild(left);
      row.appendChild(right);
      el.cardioList.appendChild(row);
    });
  }

  /** 「某一天」：选中的那天练了什么、消耗多少、体重多少，可以左右翻天。 */
  function renderDay() {
    var view = L.dayView(state.sessions, state.weights, state.dayDate, state.cardio);
    el.dayDate.value = state.dayDate;

    var parts = [];
    if (view.sessions.length > 0) {
      parts.push(view.sessions.length + " 次训练");
      parts.push("容量 " + view.volumeKg.toLocaleString("zh-CN") + " kg");
    }
    // 力量和分有氧分开列：合成一个总数会让人以为有氧白练了
    var calorieParts = [];
    if (view.strengthCalories > 0) calorieParts.push("力量 ≈" + view.strengthCalories);
    if (view.cardioCalories > 0) calorieParts.push("有氧 ≈" + view.cardioCalories);
    if (calorieParts.length > 0) parts.push(calorieParts.join(" + ") + " kcal");
    // 这天自己称了体重才算数；没称就是「未记录」，不拿别的日子顶替
    parts.push(view.bodyKg === null ? "体重未记录" : "体重 " + view.bodyKg + " kg");
    el.daySummary.textContent = parts.join(" · ");

    el.dayBody.innerHTML = "";
    if (!view.hasData) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "这天没有任何记录。";
      el.dayBody.appendChild(empty);
      return;
    }

    view.sessions.forEach(function (session, index) {
      var box = document.createElement("div");
      box.className = "entry";

      var head = document.createElement("div");
      head.className = "entry-head";
      var title = document.createElement("div");
      title.className = "entry-name";
      title.textContent = view.sessions.length > 1 ? "第 " + (index + 1) + " 次训练" : "训练";
      var remove = document.createElement("button");
      remove.className = "del";
      remove.textContent = "删除这次训练";
      remove.addEventListener("click", function () {
        if (!confirm("删掉 " + session.date + " 的这次训练？删了之后没法从界面上恢复。")) return;
        state.sessions = state.sessions.filter(function (item) {
          return item.id !== session.id;
        });
        persist();
        renderAll();
      });
      head.appendChild(title);
      head.appendChild(remove);
      box.appendChild(head);

      var body = document.createElement("div");
      body.className = "hist-body";
      body.textContent = L.summarizeSession(session);
      box.appendChild(body);

      var kcal = L.caloriesForSession(session, view.bodyKgUsed);
      var calNote = document.createElement("div");
      calNote.className = "hist-note";
      calNote.textContent = "≈ " + kcal + " kcal · " + calorieBasisText(session.date);
      box.appendChild(calNote);

      if (session.note) {
        var note = document.createElement("div");
        note.className = "hist-note";
        note.textContent = session.note;
        box.appendChild(note);
      }

      el.dayBody.appendChild(box);
    });

    // 有氧明细（查看用；要删去上面的「有氧」卡片，选同一天就能删）
    if (view.cardio.length > 0) {
      var cardioBox = document.createElement("div");
      cardioBox.className = "entry";
      var cardioHead = document.createElement("div");
      cardioHead.className = "entry-head";
      var cardioTitle = document.createElement("div");
      cardioTitle.className = "entry-name";
      cardioTitle.textContent = "有氧";
      var cardioKcal = document.createElement("div");
      cardioKcal.className = "hist-date";
      cardioKcal.textContent = "≈ " + view.cardioCalories + " kcal";
      cardioHead.appendChild(cardioTitle);
      cardioHead.appendChild(cardioKcal);
      cardioBox.appendChild(cardioHead);

      view.cardio.forEach(function (entry) {
        var line = document.createElement("div");
        line.className = "hist-body";
        line.textContent = L.formatCardio(entry) + " · ≈" + L.caloriesForCardio(entry, view.bodyKgUsed) + " kcal";
        cardioBox.appendChild(line);
      });
      el.dayBody.appendChild(cardioBox);
    }

    if (view.sessions.length === 0 && view.cardio.length === 0) {
      var onlyWeight = document.createElement("div");
      onlyWeight.className = "empty";
      onlyWeight.textContent = "这天只记了体重，没有训练也没有有氧。";
      el.dayBody.appendChild(onlyWeight);
    }
  }

  /** 历史：按天分组，一天一块。点某一天就跳到上面那天的详情。 */
  function renderDayList() {
    el.history.innerHTML = "";
    var dates = L.dayList(state.sessions, state.weights, state.cardio);
    if (dates.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "还没有记录。上面填一次，保存后就会出现在这里。";
      el.history.appendChild(empty);
      return;
    }

    dates.forEach(function (date) {
      var view = L.dayView(state.sessions, state.weights, date, state.cardio);

      var item = document.createElement("div");
      item.className = "hist-item";
      item.style.cursor = "pointer";
      item.title = "点一下看这天的详情";

      var top = document.createElement("div");
      top.className = "hist-top";
      var left = document.createElement("div");
      left.className = "hist-date";
      left.textContent = date;
      var right = document.createElement("div");
      right.className = "hist-date";
      var bits = [];
      bits.push(view.bodyKg === null ? "体重 —" : "体重 " + view.bodyKg + "kg");
      if (view.calories > 0) bits.push("≈" + view.calories + " kcal");
      right.textContent = bits.join(" · ");
      top.appendChild(left);
      top.appendChild(right);

      var body = document.createElement("div");
      body.className = "hist-body";
      var lines = view.sessions.map(L.summarizeSession);
      if (view.cardio.length > 0) {
        lines.push("有氧 " + view.cardio.reduce(function (sum, e) { return sum + e.minutes; }, 0) + " 分钟");
      }
      body.textContent = lines.length > 0 ? lines.join(" ｜ ") : "只记了体重";

      item.appendChild(top);
      item.appendChild(body);

      item.addEventListener("click", function () {
        state.dayDate = date;
        renderDay();
        document.getElementById("day-card").scrollIntoView({ behavior: "smooth", block: "start" });
      });

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
    // 加完就清掉搜索词：继续加下一个时应该看到完整列表，而不是还停在上次的关键词里
    state.exerciseFilter = "";
    if (el.exerciseFilter) el.exerciseFilter.value = "";
    renderEntries();
    renderExerciseOptions();
  }

  // 动作搜索：输入即筛选下拉框，回车直接加当前选中的那个
  el.exerciseFilter.addEventListener("input", function () {
    state.exerciseFilter = el.exerciseFilter.value;
    renderExerciseOptions();
  });
  el.exerciseFilter.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (el.select.value) addExercise(el.select.value);
  });

  el.date.addEventListener("change", function () {
    state.draft.date = el.date.value;
    renderEntries(); // 热量是按「当天体重」估的，日期变了要跟着重算
  });

  // 「某一天」的翻页与跳转
  el.dayDate.addEventListener("change", function () {
    if (!el.dayDate.value) return;
    state.dayDate = el.dayDate.value;
    renderDay();
  });
  el.dayPrev.addEventListener("click", function () {
    state.dayDate = L.addDays(state.dayDate, -1);
    renderDay();
  });
  el.dayNext.addEventListener("click", function () {
    state.dayDate = L.addDays(state.dayDate, 1);
    renderDay();
  });
  el.dayToday.addEventListener("click", function () {
    state.dayDate = L.todayISO();
    renderDay();
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
    // 存完把「某一天」跳到刚记的这天，省得自己再选一次
    state.dayDate = cleaned.date;
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

  // ---------- 有氧 ----------
  el.cardioDate.addEventListener("change", function () {
    if (!el.cardioDate.value) return;
    state.cardioDate = el.cardioDate.value;
    renderCardio();
  });
  el.cardioType.addEventListener("change", function () {
    renderCardio(); // 换项目要决定「距离」这一栏还不还在
  });
  el.saveCardio.addEventListener("click", function () {
    if (state.demoMode) {
      alert("示例模式不保存。用 index.html 正常打开再记。");
      return;
    }
    var entry = L.normalizeCardioEntry({
      date: el.cardioDate.value || L.todayISO(),
      type: el.cardioType.value,
      minutes: el.cardioMinutes.value,
      intensity: el.cardioIntensity.value,
      distanceKm: el.cardioDistance.value,
    });
    if (!entry) {
      alert("有氧存不了：类型要选对，时长填 1–600 之间的分钟数。");
      return;
    }
    state.cardio.push(entry);
    persistCardio();
    el.cardioMinutes.value = "";
    el.cardioDistance.value = "";
    // 记完跳到那天，跟训练记录一样的习惯
    state.dayDate = entry.date;
    renderAll();
  });

  el.exportBtn.addEventListener("click", function () {
    // 备份必须一次带走全部数据：漏掉哪一类，那一类就等于没有备份
    var payload = {
      app: "fitness-tracker",
      version: 3,
      exportedAt: new Date().toISOString(),
      sessions: state.sessions,
      weights: state.weights,
      cardio: state.cardio,
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

      // 三种格式都认：旧版纯训练数组、v2 的 {sessions, weights}、v3 加了 cardio
      var incomingSessions;
      var incomingWeights;
      var incomingCardio;
      if (Array.isArray(incoming)) {
        incomingSessions = incoming;
        incomingWeights = [];
        incomingCardio = [];
      } else if (incoming && Array.isArray(incoming.sessions)) {
        incomingSessions = incoming.sessions;
        incomingWeights = Array.isArray(incoming.weights) ? incoming.weights : [];
        incomingCardio = Array.isArray(incoming.cardio) ? incoming.cardio : [];
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

      // 有氧没有 id，按内容去重：同一天同类型同时长同强度视为同一条
      var cardioKeys = {};
      state.cardio.forEach(function (entry) {
        cardioKeys[entry.date + "|" + entry.type + "|" + entry.minutes + "|" + entry.intensity] = true;
      });
      var addedCardio = 0;
      incomingCardio.map(L.normalizeCardioEntry).filter(Boolean).forEach(function (entry) {
        var key = entry.date + "|" + entry.type + "|" + entry.minutes + "|" + entry.intensity;
        if (cardioKeys[key]) return;
        cardioKeys[key] = true;
        state.cardio.push(entry);
        addedCardio++;
      });

      persist();
      persistWeights();
      persistCardio();
      renderAll();
      alert(
        "导入完成：训练记录新增 " + addedSessions + " 条，体重新增 " + addedWeights +
        " 条，有氧新增 " + addedCardio + " 条。"
      );
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

    // 有氧示例：最后一次训练那天加了 30 分钟跑步，演示「力量 + 有氧」分开计
    state.cardio = [
      L.normalizeCardioEntry({ date: "2026-02-10", type: "跑步", minutes: 30, intensity: "中", distanceKm: 5.2 }),
      L.normalizeCardioEntry({ date: "2026-02-03", type: "跳绳", minutes: 10, intensity: "高", distanceKm: null }),
    ].filter(Boolean);
  }

  function init() {
    el.date.value = state.draft.date;
    el.weightDate.value = L.todayISO();
    el.cardioDate.value = state.cardioDate;
    state.unit = loadUnit();
    if (/[?&]demo=1/.test(window.location.search)) {
      seedDemo();
      // 示例模式下直接停在有数据的那天，否则一进来是空日子，看不出这功能
      state.dayDate = "2026-02-10";
      state.cardioDate = "2026-02-10";
    } else {
      state.sessions = load();
      state.weights = loadWeights();
      state.cardio = loadCardio();
      // 今天没记录时，默认停在最近有数据的那天，免得一打开是空屏
      if (!L.dayView(state.sessions, state.weights, state.dayDate, state.cardio).hasData) {
        var dates = L.dayList(state.sessions, state.weights, state.cardio);
        if (dates.length > 0) state.dayDate = dates[0];
      }
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
