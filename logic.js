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
    "三头肌绳索下拉"
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
   * MET 取值参考《体力活动纲要》(Compendium of Physical Activities) 的抗阻训练条目：
   * 轻中强度约 3.5，高强度约 6.0。按动作分三档是工程上的近似，不是生理学精确值：
   *   - 大肌群复合动作（卧推/深蹲/硬拉/划船）6.0
   *   - 半复合或器械主导（推举/腿举/高位下拉）4.0–5.0
   *   - 孤立小肌群（弯举/臂屈伸）3.5
   * 真实误差常在 ±30% 以上，所以界面上一律标「约」。
   *
   * 时长按每组 2 分钟（含组间休息）。这个假设写死是有意的：
   * 让用户每组填时长，记录成本会翻倍，而 D11 明确说了不追求精准。
   */
  var MET_TABLE = {
    卧推: 6.0,
    深蹲: 6.0,
    硬拉: 6.0,
    杠铃划船: 6.0,
    站姿推举: 5.0,
    腿举: 5.0,
    高位下拉: 4.0,
    二头弯举: 3.5,
    三头肌绳索下拉: 3.5,
  };
  var DEFAULT_MET = 5.0;
  var SECONDS_PER_SET = 120;
  /** 没有体重记录时的兜底体重。用它算出来的数要看得出是估的。 */
  var DEFAULT_BODY_KG = 70;

  /** 动作对应的 MET，没收录的按 5.0（中等强度）算。 */
  function metForExercise(name) {
    return Object.prototype.hasOwnProperty.call(MET_TABLE, name) ? MET_TABLE[name] : DEFAULT_MET;
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

  /** 一个动作的热量估算（kcal，取整）。bodyKg 缺省时按 70kg 兜底。 */
  function caloriesForEntry(entry, bodyKg) {
    if (!entry || !Array.isArray(entry.sets) || entry.sets.length === 0) return 0;
    var kg = bodyKg === null || bodyKg === undefined ? DEFAULT_BODY_KG : bodyKg;
    var met = metForExercise(entry.name);
    var kcal = met * kg * (SECONDS_PER_SET / 3600) * entry.sets.length;
    return Math.round(kcal);
  }

  /** 整次训练的热量估算（kcal）。 */
  function caloriesForSession(session, bodyKg) {
    if (!session || !Array.isArray(session.entries)) return 0;
    return session.entries.reduce(function (sum, entry) {
      return sum + caloriesForEntry(entry, bodyKg);
    }, 0);
  }

  return {
    DEFAULT_EXERCISES: DEFAULT_EXERCISES,
    STORAGE_KEY: STORAGE_KEY,
    WEIGHT_STORAGE_KEY: WEIGHT_STORAGE_KEY,
    UNIT_STORAGE_KEY: UNIT_STORAGE_KEY,
    KG_PER_LB: KG_PER_LB,
    setToKg: setToKg,
    kgToUnit: kgToUnit,
    fmtNumber: fmtNumber,
    formatSet: formatSet,
    MET_TABLE: MET_TABLE,
    DEFAULT_MET: DEFAULT_MET,
    SECONDS_PER_SET: SECONDS_PER_SET,
    DEFAULT_BODY_KG: DEFAULT_BODY_KG,
    metForExercise: metForExercise,
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
