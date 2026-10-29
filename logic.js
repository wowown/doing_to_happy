/*
 * logic.js — 纯逻辑，不碰界面。
 *
 * 为什么单独拆出来：这部分是「算得对不对」的地方（容量、PR、历史取值），
 * 拆出来就能用 node 直接跑测试，不用开浏览器点。界面再怎么改都不会碰坏它。
 *
 * 这个文件同时被两种环境使用：
 *   - 浏览器：<script src="logic.js"> 引入后得到全局变量 FitnessLogic
 *   - node  ：require('./logic.js') 拿到同一个对象（见文件末尾的导出）
 */
var FitnessLogic = (function () {
  "use strict";

  /** 默认动作库：健身房常见动作。用户可随时添加自定义动作。 */
  var DEFAULT_EXERCISES = [
    "卧推",
    "深蹲",
    "硬拉",
    "杠铃划船",
    "站姿推举",
    "高位下拉",
    "腿举",
    "二头弯举",
    "三头肌绳索下拉",
    "夹胸",
    "史密斯上斜推胸",
    "坐姿推胸",
    "哑铃推肩",
    "三头臂屈伸",
    "哑铃前平举",
    "哑铃侧平举",
    "蝴蝶机后肩后束",
    "胯内夹",
  ];

  var STORAGE_KEY = "fitness-tracker-v1";

  /** 体重记录单独一个键，和训练记录互不影响。 */
  var WEIGHT_STORAGE_KEY = "fitness-tracker-weight-v1";

  /** 单位偏好（kg / lb）单独存，换设备时不影响数据本身。 */
  var UNIT_STORAGE_KEY = "fitness-tracker-unit-v1";

  /**
   * 1 磅 = 0.45359237 kg（国际码磅的定义值，不是近似）。
   * 注意：磅和 kg 不能无损互换 —— 111 lb = 50.35 kg，55 kg = 121.25 lb。
   * 所以记录里保存「用户输入的数字 + 原始单位」，只在需要比较时才换算。
   */
  var KG_PER_LB = 0.45359237;

  /** 把一组换算成 kg，用于容量和 PR 的跨单位比较。 */
  function setToKg(set) {
    if (set.unit === "lb") return set.weight * KG_PER_LB;
    return set.weight;
  }

  /** 把 kg 换算成指定单位，用于展示。 */
  function kgToUnit(kg, unit) {
    if (unit === "lb") return kg / KG_PER_LB;
    return kg;
  }

  /** 数字格式：整数原样，小数留一位，避免出现 110.2311310924387 这种。 */
  function fmtNumber(n) {
    if (!isFinite(n)) return "0";
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  }

  /** 一条记录的展示文案，例如「111lb × 8」。单位缺失时按 kg，绝不让 undefined 漏到界面。 */
  function formatSet(set) {
    return fmtNumber(set.weight) + (set.unit === "lb" ? "lb" : "kg") + " × " + set.reps;
  }

  /** 今天的日期，格式 YYYY-MM-DD（本地时区，不用 UTC，避免早上变成昨天）。 */
  function todayISO(now) {
    var d = now ? new Date(now) : new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  /** 转成有限正数，否则返回 null。空输入、负重量、NaN 都在这里被挡掉。 */
  function toNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    var n = Number(value);
    if (!isFinite(n) || n < 0) return null;
    return n;
  }

  /**
   * 一组 = 重量 × 次数 × 单位。次数必须是正整数，重量可以为 0（自重动作）。
   * 单位缺省按 kg：老数据里没有 unit 字段，读进来必须还能用。
   */
  function normalizeSet(raw) {
    var weight = toNumber(raw && raw.weight);
    var reps = toNumber(raw && raw.reps);
    if (weight === null || reps === null) return null;
    if (!Number.isInteger(reps) || reps <= 0) return null;
    var unit = raw && raw.unit === "lb" ? "lb" : "kg";
    return { weight: weight, reps: reps, unit: unit };
  }

  /** 一个动作的训练量 = 所有组换算成 kg 后的 重量×次数 之和。 */
  function entryVolume(entry) {
    if (!entry || !Array.isArray(entry.sets)) return 0;
    return entry.sets.reduce(function (sum, set) {
      return sum + setToKg(set) * set.reps;
    }, 0);
  }

  /** 整次训练的总容量（kg），用来粗看「今天练了多重」。 */
  function sessionVolume(session) {
    if (!session || !Array.isArray(session.entries)) return 0;
    return session.entries.reduce(function (sum, entry) {
      return sum + entryVolume(entry);
    }, 0);
  }

  /**
   * 一个动作的「最好一组」：先比换算后的 kg，再比次数。
   * 必须换成 kg 再比，否则「111 lb」会被当成 111 而错误地压过「60 kg」。
   * 返回的是原始那组（带自己的单位），显示时不会被改写。
   */
  function bestSet(entry) {
    if (!entry || !Array.isArray(entry.sets) || entry.sets.length === 0) return null;
    return entry.sets.reduce(function (best, set) {
      var bestKg = setToKg(best);
      var setKg = setToKg(set);
      if (setKg > bestKg) return set;
      if (setKg === bestKg && set.reps > best.reps) return set;
      return best;
    });
  }

  /**
   * 清洗一条原始记录，返回 null 表示这条不合法。
   * 顺便把同名动作合并成一个（同一次训练里重复点「加动作」不会变成两条）。
   */
  function normalizeSession(raw) {
    if (!raw) return null;
    var date = typeof raw.date === "string" ? raw.date.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (!Array.isArray(raw.entries)) return null;

    var merged = [];
    var index = {};
    raw.entries.forEach(function (entry) {
      var name = typeof entry.name === "string" ? entry.name.trim() : "";
      if (!name) return;
      var sets = (Array.isArray(entry.sets) ? entry.sets : [])
        .map(normalizeSet)
        .filter(Boolean);
      if (sets.length === 0) return;
      if (index[name] === undefined) {
        index[name] = merged.length;
        merged.push({ name: name, sets: sets });
      } else {
        merged[index[name]].sets = merged[index[name]].sets.concat(sets);
      }
    });

    if (merged.length === 0) return null;
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : date + "-" + merged.length,
      date: date,
      note: typeof raw.note === "string" ? raw.note.trim() : "",
      entries: merged,
    };
  }

  /** 按日期倒序（新的在前）。同一天按入库顺序倒序，最新记的排最前。 */
  function sortSessionsDesc(sessions) {
    return sessions.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return 0;
    });
  }

  /**
   * 某个动作上一次练是什么成绩。
   * sessions 传未排序的也可以，内部会先排序，返回 null 表示没练过。
   */
  function lastForExercise(sessions, name) {
    var sorted = sortSessionsDesc(sessions);
    for (var i = 0; i < sorted.length; i++) {
      var entry = findEntry(sorted[i], name);
      if (entry) {
        return { date: sorted[i].date, entry: entry, best: bestSet(entry) };
      }
    }
    return null;
  }

  function findEntry(session, name) {
    if (!session || !Array.isArray(session.entries)) return null;
    for (var i = 0; i < session.entries.length; i++) {
      if (session.entries[i].name === name) return session.entries[i];
    }
    return null;
  }

  /**
   * 某个动作的历史曲线，按日期正序（老的在前），给折线图用。
   * 每个点：当天最好一组的重量、次数、以及当天该动作的总容量。
   */
  function seriesForExercise(sessions, name) {
    var points = [];
    sessions.forEach(function (session) {
      var entry = findEntry(session, name);
      if (!entry) return;
      var best = bestSet(entry);
      if (!best) return;
      points.push({
        date: session.date,
        // weight/unit 保留当天最好一组的原始刻度，kg 是换算值，供曲线和比较使用
        weight: best.weight,
        unit: best.unit,
        kg: setToKg(best),
        reps: best.reps,
        volume: entryVolume(entry),
      });
    });
    return points.sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
  }

  /**
   * 某个动作的 PR，没练过返回 null。
   * 比的是换算后的 kg（磅器械不能直接跟 kg 比大小）；
   * kg 相同再比次数：60kg×10 比 60kg×8 强，不能因为重量相同就取先出现的那次。
   */
  function prForExercise(sessions, name) {
    var points = seriesForExercise(sessions, name);
    if (points.length === 0) return null;
    return points.reduce(function (best, p) {
      if (p.kg > best.kg) return p;
      if (p.kg === best.kg && p.reps > best.reps) return p;
      return best;
    });
  }

  /** 列出练过的所有动作名，按出现频次倒序，给下拉框排序用。 */
  function usedExercises(sessions) {
    var count = {};
    sessions.forEach(function (session) {
      session.entries.forEach(function (entry) {
        count[entry.name] = (count[entry.name] || 0) + 1;
      });
    });
    return Object.keys(count).sort(function (a, b) {
      return count[b] - count[a];
    });
  }

  /** 一行摘要，例如「卧推 60kg×8×3 · 深蹲 80kg×5×1」。带单位，免得看历史时猜。 */
  function summarizeSession(session) {
    return session.entries
      .map(function (entry) {
        var best = bestSet(entry);
        var unit = best.unit === "lb" ? "lb" : "kg";
        return entry.name + " " + fmtNumber(best.weight) + unit + "×" + best.reps + "×" + entry.sets.length;
      })
      .join(" · ");
  }

  /** 整体统计，展示在历史区顶部。 */
  function stats(sessions) {
    var volume = sessions.reduce(function (sum, s) {
      return sum + sessionVolume(s);
    }, 0);
    return {
      sessions: sessions.length,
      volume: volume,
      exercises: usedExercises(sessions).length,
    };
  }

  // ---------- 体重记录 ----------
  // 独立一个存储键，和训练记录分开：两者写入频率和数据形状都不同，混在一起改起来互相牵连。
  // 内部一律存 kg（数字）。将来加磅的显示切换时只是换算，不用迁移数据。

  /** 清洗一条体重记录，返回 null 表示不合法。 */
  function normalizeWeightEntry(raw) {
    if (!raw) return null;
    var date = typeof raw.date === "string" ? raw.date.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    var kg = toNumber(raw.kg);
    if (kg === null || kg <= 0 || kg > 500) return null;
    return { date: date, kg: Math.round(kg * 10) / 10 };
  }

  /** 按日期正序（老的在前），给折线图用。 */
  function sortWeightsAsc(entries) {
    return entries.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
  }

  /**
   * 写入一条体重：同一天只保留一条，后存的覆盖前面的。
   * 一天称两次是噪音不是进步，堆两条会让曲线出现假波动。
   */
  function upsertWeight(entries, entry) {
    var cleaned = normalizeWeightEntry(entry);
    if (!cleaned) return entries;
    var kept = entries.filter(function (item) {
      return item.date !== cleaned.date;
    });
    kept.push(cleaned);
    return sortWeightsAsc(kept);
  }

  /** 最近一次体重，没有返回 null。 */
  function latestWeight(entries) {
    var sorted = sortWeightsAsc(entries);
    return sorted.length === 0 ? null : sorted[sorted.length - 1];
  }

  /** 从第一条到最新一条的变化（kg），少于两条返回 null。 */
  function weightChange(entries) {
    var sorted = sortWeightsAsc(entries);
    if (sorted.length < 2) return null;
    var delta = sorted[sorted.length - 1].kg - sorted[0].kg;
    return Math.round(delta * 10) / 10;
  }

  // ---------- 热量估算 ----------
  /*
   * 用 MET（代谢当量）估算，公式：kcal = MET × 体重(kg) × 时长(小时)。
   *
   * MET 怎么取：按「单组重量 ÷ 体重」这一相对负荷分档。
   * 《体力活动纲要》把抗阻训练分成轻 3.5 / 中 5.0 / 强 6.0 三档，
   * 实践里判断轻中强看的就是这一组的重量相对自身体重有多重：
   *
   *   相对负荷 < 0.3        → 3.5（轻）
   *   0.3 ≤ 相对负荷 < 0.6  → 5.0（中）
   *   相对负荷 ≥ 0.6        → 6.0（强）
   *
   * 为什么不直接算「把杠铃举起来做了多少功」：那个物理量小得离谱。
   * 卧推 60kg×12 的机械功约 0.9 kcal，而一组的总消耗约 14 kcal，
   * 真正「举铁」只占 5% 左右，用机械功当指标会让重量几乎不影响结果。
   * 相对负荷分档不是精确物理，但它是有依据的强度判断，且能反映重量差异。
   *
   * 自重动作（重量 0）没法用相对负荷，退回到按动作类型给的固定 MET：
   * 复合 8.0（纲要里「自重高强度」一档）、半复合 5.0、孤立 3.5。
   *
   * 时长按每组 2 分钟（含组间休息）。写死是有意的：让用户每组填时长，
   * 记录成本会翻倍，而 D11 明确说了不追求精准。误差常在 ±30%，界面一律标「≈」。
   */

  /** 动作类型：复合（多关节大肌群）/ 半复合（器械主导）/ 孤立（单关节）。 */
  var EXERCISE_TYPE = {
    卧推: "compound",
    深蹲: "compound",
    硬拉: "compound",
    杠铃划船: "compound",
    史密斯上斜推胸: "compound",
    坐姿推胸: "compound",
    站姿推举: "half",
    腿举: "half",
    高位下拉: "half",
    哑铃推肩: "half",
    二头弯举: "isolation",
    三头肌绳索下拉: "isolation",
    夹胸: "isolation",
    三头臂屈伸: "isolation",
    哑铃前平举: "isolation",
    哑铃侧平举: "isolation",
    蝴蝶机后肩后束: "isolation",
    胯内夹: "isolation",
  };
  /** 各类型的名义 MET（不吃重量时用，也用来在界面上说明「这动作算几档」）。 */
  var TYPE_MET = { compound: 6.0, half: 5.0, isolation: 3.5 };
  /** 自重动作按类型取 MET：复合动作自重强度明显更高。 */
  var BODYWEIGHT_MET = { compound: 8.0, half: 5.0, isolation: 3.5 };
  /** 相对负荷分档（单组重量 ÷ 体重）。 */
  var LOAD_TIERS = [
    { limit: 0.3, met: 3.5, label: "轻" },
    { limit: 0.6, met: 5.0, label: "中" },
    { limit: Infinity, met: 6.0, label: "强" },
  ];
  var DEFAULT_MET = 5.0;
  var SECONDS_PER_SET = 120;
  /** 没有体重记录时的兜底体重。用它算出来的数要看得出是估的。 */
  var DEFAULT_BODY_KG = 70;
  var DEFAULT_BODYWEIGHT_MET = 5.0;

  /** 动作类型，没收录的按「半复合」处理（中等强度，不夸大也不贬低）。 */
  function exerciseType(name) {
    return Object.prototype.hasOwnProperty.call(EXERCISE_TYPE, name) ? EXERCISE_TYPE[name] : "half";
  }

  /** 动作的名义 MET（不看重量），用于展示和说明。 */
  function metForExercise(name) {
    var type = exerciseType(name);
    return Object.prototype.hasOwnProperty.call(TYPE_MET, type) ? TYPE_MET[type] : DEFAULT_MET;
  }

  /** 单组的相对负荷 = 这组换算成 kg 的重量 ÷ 体重。体重无效时返回 null。 */
  function relativeLoad(set, bodyKg) {
    if (!bodyKg || bodyKg <= 0) return null;
    return setToKg(set) / bodyKg;
  }

  /** 单组落在哪一档：{ met, label }。 */
  function loadTier(set, bodyKg) {
    var ratio = relativeLoad(set, bodyKg);
    if (ratio === null) return { met: DEFAULT_MET, label: "中" };
    for (var i = 0; i < LOAD_TIERS.length; i++) {
      if (ratio < LOAD_TIERS[i].limit) return { met: LOAD_TIERS[i].met, label: LOAD_TIERS[i].label };
    }
    return { met: DEFAULT_MET, label: "中" };
  }

  /**
   * 单组的 MET。重量为 0（自重动作）或体重信息不可用时，
   * 退回按动作类型给的固定值——否则自重的引体向上会被判成「轻」。
   */
  function metForSet(set, bodyKg, name) {
    if (setToKg(set) === 0 || relativeLoad(set, bodyKg) === null) {
      var type = exerciseType(name);
      return Object.prototype.hasOwnProperty.call(BODYWEIGHT_MET, type) ? BODYWEIGHT_MET[type] : DEFAULT_BODYWEIGHT_MET;
    }
    return loadTier(set, bodyKg).met;
  }

  /**
   * 训练当天（或之前最近一次）的体重，用来算热量。
   * 三个月前 78kg 时练的，不该按今天的 75kg 算。
   * 全都晚于训练日期时退让用最早的一条；一条都没有返回 null。
   */
  function bodyKgOn(weights, date) {
    if (!weights || weights.length === 0) return null;
    var sorted = sortWeightsAsc(weights);
    var candidate = null;
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].date <= date) candidate = sorted[i];
    }
    if (!candidate) candidate = sorted[0];
    return candidate.kg;
  }

  /** 逐组的估算热量（kcal，取整），顺序与 sets 一致。 */
  function caloriesPerSet(entry, bodyKg) {
    if (!entry || !Array.isArray(entry.sets)) return [];
    var kg = bodyKg === null || bodyKg === undefined ? DEFAULT_BODY_KG : bodyKg;
    return entry.sets.map(function (set) {
      var met = metForSet(set, kg, entry.name);
      return Math.round(met * kg * (SECONDS_PER_SET / 3600));
    });
  }

  /** 一个动作的热量估算（kcal）：逐组相加，所以放 20kg 和 60kg 会算出不同的数。 */
  function caloriesForEntry(entry, bodyKg) {
    return caloriesPerSet(entry, bodyKg).reduce(function (sum, kcal) {
      return sum + kcal;
    }, 0);
  }

  /** 整次训练的热量估算（kcal）。 */
  function caloriesForSession(session, bodyKg) {
    if (!session || !Array.isArray(session.entries)) return 0;
    return session.entries.reduce(function (sum, entry) {
      return sum + caloriesForEntry(entry, bodyKg);
    }, 0);
  }

  // ---------- 按天汇总 ----------

  /**
   * 日期加减天数，返回 YYYY-MM-DD。
   * 用本地时间构造，不用 new Date("YYYY-MM-DD")：那会被当成 UTC，东八区的晚上会退回前一天。
   */
  function addDays(date, delta) {
    var parts = String(date).split("-");
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + delta);
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  /** 某一天的训练记录（可能有多条：上午练胸、晚上练背）。 */
  function sessionsOn(sessions, date) {
    return sessions.filter(function (session) {
      return session.date === date;
    });
  }

  // ---------- 有氧记录 ----------
  /*
   * 有氧和力量训练是两套数据结构，故意分开存（第三个独立存储键）：
   * 有氧没有「组 × 重量 × 次数」，只有「类型 + 时长 + 强度（+ 距离）」。
   * 硬塞进训练记录里，等于让每次读写都要先判断这条记录属于哪种，越用越脏。
   *
   * 热量同样用 MET：kcal = MET × 强度系数 × 体重kg × 时长(小时)。
   * MET 取《体力活动纲要》里对应项目的常见值（见 CARDIO_TYPES 的注释）。
   * 强度只是对 MET 的粗调（0.8 / 1.0 / 1.25），因为纲要本身就是按速度/强度分档的。
   */

  /** 有氧项目。met 是「中等强度」的基准值，hasDistance 决定界面上要不要露出距离输入。 */
  var CARDIO_TYPES = [
    { name: "跑步", met: 8.3, hasDistance: true },   // 纲要：8 km/h 跑步 8.3
    { name: "快走", met: 4.3, hasDistance: true },   // 5.6 km/h 快走 4.3
    { name: "骑车", met: 6.8, hasDistance: true },   // 中速 16–19 km/h 6.8
    { name: "游泳", met: 5.8, hasDistance: true },   // 自由泳中等 5.8
    { name: "划船机", met: 7.0, hasDistance: true }, // 中等阻力 7.0
    { name: "椭圆机", met: 5.0, hasDistance: false },
    { name: "跳绳", met: 11.8, hasDistance: false }, // 中等速度 11.8
  ];

  /** 强度系数：对 MET 的粗调，不精确。 */
  var CARDIO_INTENSITY = [
    { key: "低", factor: 0.8 },
    { key: "中", factor: 1.0 },
    { key: "高", factor: 1.25 },
  ];

  var CARDIO_STORAGE_KEY = "fitness-tracker-cardio-v1";

  function cardioTypeInfo(name) {
    for (var i = 0; i < CARDIO_TYPES.length; i++) {
      if (CARDIO_TYPES[i].name === name) return CARDIO_TYPES[i];
    }
    return null;
  }

  function cardioIntensityFactor(key) {
    for (var i = 0; i < CARDIO_INTENSITY.length; i++) {
      if (CARDIO_INTENSITY[i].key === key) return CARDIO_INTENSITY[i].factor;
    }
    return 1.0;
  }

  /** 清洗一条有氧记录，返回 null 表示不合法。 */
  function normalizeCardioEntry(raw) {
    if (!raw) return null;
    var date = typeof raw.date === "string" ? raw.date.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (!cardioTypeInfo(raw.type)) return null;
    var minutes = toNumber(raw.minutes);
    if (minutes === null || minutes <= 0 || minutes > 600) return null;
    var intensity = "中";
    for (var i = 0; i < CARDIO_INTENSITY.length; i++) {
      if (CARDIO_INTENSITY[i].key === raw.intensity) intensity = raw.intensity;
    }
    var distanceKm = toNumber(raw.distanceKm);
    if (distanceKm !== null && (distanceKm <= 0 || distanceKm > 500)) distanceKm = null;
    return {
      date: date,
      type: raw.type,
      minutes: Math.round(minutes),
      intensity: intensity,
      distanceKm: distanceKm,
    };
  }

  /** 一条有氧的热量估算（kcal）。bodyKg 缺省按 70kg 兜底。 */
  function caloriesForCardio(entry, bodyKg) {
    if (!entry) return 0;
    var info = cardioTypeInfo(entry.type);
    if (!info) return 0;
    var kg = bodyKg === null || bodyKg === undefined ? DEFAULT_BODY_KG : bodyKg;
    var met = info.met * cardioIntensityFactor(entry.intensity);
    return Math.round(met * kg * (entry.minutes / 60));
  }

  /** 某一天的有氧记录。 */
  function cardioOn(cardio, date) {
    return (cardio || []).filter(function (item) {
      return item.date === date;
    });
  }

  /** 某一天有氧的总热量。 */
  function cardioCaloriesOn(cardio, weights, date) {
    var bodyKg = bodyKgOn(weights, date);
    return cardioOn(cardio, date).reduce(function (sum, entry) {
      return sum + caloriesForCardio(entry, bodyKg);
    }, 0);
  }

  /** 有氧记录的展示文案，例如「跑步 30 分钟（中）· 5.2km」。 */
  function formatCardio(entry) {
    var text = entry.type + " " + entry.minutes + " 分钟（" + entry.intensity + "）";
    if (entry.distanceKm) text += "· " + fmtNumber(entry.distanceKm) + "km";
    return text;
  }

  /**
   * 一天的完整快照：练了什么、多少容量、多少热量、当天体重、有氧做了什么。
   *
   * bodyKg 和 bodyKgUsed 必须分开：
   *   - bodyKg     = 这一天自己记的体重；没记就是 null（界面显示「未记录」）
   *   - bodyKgUsed = 算热量实际用的体重（这一天或之前最近一次），可能来自更早的日期
   * 混用这两个，会让「这天没称体重」被悄悄填上一个别的日子的数字。
   *
   * 热量分三项返回：力量、有氧、合计。合成一个总数会让人以为有氧白练了。
   */
  function dayView(sessions, weights, date, cardio) {
    var todays = sessionsOn(sessions, date);
    var weightEntries = (weights || []).filter(function (item) {
      return item.date === date;
    });
    var bodyKg = weightEntries.length > 0 ? weightEntries[0].kg : null;
    var bodyKgUsed = bodyKgOn(weights, date);
    var todaysCardio = cardioOn(cardio, date);

    var exercises = [];
    todays.forEach(function (session) {
      session.entries.forEach(function (entry) {
        exercises.push({
          name: entry.name,
          sets: entry.sets,
          kcal: caloriesForEntry(entry, bodyKgUsed),
          sessionId: session.id,
        });
      });
    });

    var strengthCalories = todays.reduce(function (sum, session) {
      return sum + caloriesForSession(session, bodyKgUsed);
    }, 0);
    var cardioCalories = todaysCardio.reduce(function (sum, entry) {
      return sum + caloriesForCardio(entry, bodyKgUsed);
    }, 0);

    return {
      date: date,
      sessions: todays,
      exercises: exercises,
      cardio: todaysCardio,
      volumeKg: Math.round(
        todays.reduce(function (sum, session) {
          return sum + sessionVolume(session);
        }, 0)
      ),
      strengthCalories: strengthCalories,
      cardioCalories: cardioCalories,
      calories: strengthCalories + cardioCalories,
      bodyKg: bodyKg,
      bodyKgUsed: bodyKgUsed,
      hasData: todays.length > 0 || weightEntries.length > 0 || todaysCardio.length > 0,
    };
  }

  /** 有数据的所有日期，倒序（新的在前）。只有体重或有氧的日期也算。 */
  function dayList(sessions, weights, cardio) {
    var seen = {};
    sessions.forEach(function (session) {
      seen[session.date] = true;
    });
    (weights || []).forEach(function (item) {
      seen[item.date] = true;
    });
    (cardio || []).forEach(function (item) {
      seen[item.date] = true;
    });
    return Object.keys(seen).sort().reverse();
  }

  return {
    DEFAULT_EXERCISES: DEFAULT_EXERCISES,
    addDays: addDays,
    sessionsOn: sessionsOn,
    dayView: dayView,
    dayList: dayList,
    CARDIO_TYPES: CARDIO_TYPES,
    CARDIO_INTENSITY: CARDIO_INTENSITY,
    CARDIO_STORAGE_KEY: CARDIO_STORAGE_KEY,
    cardioTypeInfo: cardioTypeInfo,
    cardioIntensityFactor: cardioIntensityFactor,
    normalizeCardioEntry: normalizeCardioEntry,
    caloriesForCardio: caloriesForCardio,
    cardioOn: cardioOn,
    cardioCaloriesOn: cardioCaloriesOn,
    formatCardio: formatCardio,
    STORAGE_KEY: STORAGE_KEY,
    WEIGHT_STORAGE_KEY: WEIGHT_STORAGE_KEY,
    UNIT_STORAGE_KEY: UNIT_STORAGE_KEY,
    KG_PER_LB: KG_PER_LB,
    setToKg: setToKg,
    kgToUnit: kgToUnit,
    fmtNumber: fmtNumber,
    formatSet: formatSet,
    MET_TABLE: TYPE_MET,
    MET_TABLE_BY_TYPE: TYPE_MET,
    BODYWEIGHT_MET: BODYWEIGHT_MET,
    DEFAULT_MET: DEFAULT_MET,
    SECONDS_PER_SET: SECONDS_PER_SET,
    DEFAULT_BODY_KG: DEFAULT_BODY_KG,
    metForExercise: metForExercise,
    exerciseType: exerciseType,
    relativeLoad: relativeLoad,
    loadTier: loadTier,
    metForSet: metForSet,
    LOAD_TIERS: LOAD_TIERS,
    EXERCISE_TYPE: EXERCISE_TYPE,
    caloriesPerSet: caloriesPerSet,
    bodyKgOn: bodyKgOn,
    caloriesForEntry: caloriesForEntry,
    caloriesForSession: caloriesForSession,
    normalizeWeightEntry: normalizeWeightEntry,
    sortWeightsAsc: sortWeightsAsc,
    upsertWeight: upsertWeight,
    latestWeight: latestWeight,
    weightChange: weightChange,
    todayISO: todayISO,
    normalizeSet: normalizeSet,
    normalizeSession: normalizeSession,
    entryVolume: entryVolume,
    sessionVolume: sessionVolume,
    bestSet: bestSet,
    findEntry: findEntry,
    sortSessionsDesc: sortSessionsDesc,
    lastForExercise: lastForExercise,
    seriesForExercise: seriesForExercise,
    prForExercise: prForExercise,
    usedExercises: usedExercises,
    summarizeSession: summarizeSession,
    stats: stats,
  };
})();

// node 环境下导出，供测试文件 require 使用；浏览器里没有 module，这一行会被跳过。
if (typeof module !== "undefined" && module.exports) {
  module.exports = FitnessLogic;
}
