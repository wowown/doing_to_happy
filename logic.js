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

  /** 一组 = 重量 × 次数。次数必须是正整数，重量可以为 0（自重动作）。 */
  function normalizeSet(raw) {
    var weight = toNumber(raw && raw.weight);
    var reps = toNumber(raw && raw.reps);
    if (weight === null || reps === null) return null;
    if (!Number.isInteger(reps) || reps <= 0) return null;
    return { weight: weight, reps: reps };
  }

  /** 一个动作的训练量 = 所有组 重量×次数 之和。 */
  function entryVolume(entry) {
    if (!entry || !Array.isArray(entry.sets)) return 0;
    return entry.sets.reduce(function (sum, set) {
      return sum + set.weight * set.reps;
    }, 0);
  }

  /** 整次训练的总容量，用来粗看「今天练了多重」。 */
  function sessionVolume(session) {
    if (!session || !Array.isArray(session.entries)) return 0;
    return session.entries.reduce(function (sum, entry) {
      return sum + entryVolume(entry);
    }, 0);
  }

  /**
   * 一个动作的「最好一组」：先比重量，重量相同再比次数。
   * 这是判断进步的主指标——只记最重一组会丢掉次数带来的进步。
   */
  function bestSet(entry) {
    if (!entry || !Array.isArray(entry.sets) || entry.sets.length === 0) return null;
    return entry.sets.reduce(function (best, set) {
      if (set.weight > best.weight) return set;
      if (set.weight === best.weight && set.reps > best.reps) return set;
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
        weight: best.weight,
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
   * 和 bestSet 一样先比重量再比次数：60kg×10 比 60kg×8 强，不能因为重量相同就取先出现的那次。
   */
  function prForExercise(sessions, name) {
    var points = seriesForExercise(sessions, name);
    if (points.length === 0) return null;
    return points.reduce(function (best, p) {
      if (p.weight > best.weight) return p;
      if (p.weight === best.weight && p.reps > best.reps) return p;
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

  /** 一行摘要，例如「卧推 60×8×3 · 深蹲 80×5×3」。 */
  function summarizeSession(session) {
    return session.entries
      .map(function (entry) {
        var best = bestSet(entry);
        return entry.name + " " + best.weight + "×" + best.reps + "×" + entry.sets.length;
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

  return {
    DEFAULT_EXERCISES: DEFAULT_EXERCISES,
    STORAGE_KEY: STORAGE_KEY,
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
