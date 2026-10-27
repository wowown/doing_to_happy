/*
 * logic.test.js — 跑法：
 *   node test/logic.test.js
 * 全绿说明「算得对」这件事有证据，不只是我说它对。
 * 这里故意不引任何测试框架：多一个依赖，就多一个哪天装不上的理由。
 */
var assert = require("node:assert");
var L = require("../logic.js");

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok   " + name);
  } catch (error) {
    failed++;
    console.log("  FAIL " + name);
    console.log("       " + error.message);
  }
}

console.log("\nnormalizeSet：脏数据必须被挡住");
test("合法的一组原样保留", function () {
  assert.deepStrictEqual(L.normalizeSet({ weight: 60, reps: 8 }), { weight: 60, reps: 8, unit: "kg" });
});
test("没写单位时默认 kg（兼容老数据）", function () {
  assert.strictEqual(L.normalizeSet({ weight: 60, reps: 8 }).unit, "kg");
});
test("写了 lb 就保留 lb", function () {
  assert.deepStrictEqual(L.normalizeSet({ weight: 111, reps: 8, unit: "lb" }), { weight: 111, reps: 8, unit: "lb" });
});
test("乱七八糟的单位按 kg 处理，不会变成 NaN", function () {
  assert.strictEqual(L.normalizeSet({ weight: 60, reps: 8, unit: "斤" }).unit, "kg");
});
test("重量 0 合法（自重动作）", function () {
  assert.deepStrictEqual(L.normalizeSet({ weight: 0, reps: 15 }), { weight: 0, reps: 15, unit: "kg" });
});
test("空重量返回 null", function () {
  assert.strictEqual(L.normalizeSet({ weight: "", reps: 8 }), null);
});
test("负重量返回 null", function () {
  assert.strictEqual(L.normalizeSet({ weight: -5, reps: 8 }), null);
});
test("小数次数返回 null", function () {
  assert.strictEqual(L.normalizeSet({ weight: 60, reps: 2.5 }), null);
});
test("0 次返回 null", function () {
  assert.strictEqual(L.normalizeSet({ weight: 60, reps: 0 }), null);
});

console.log("\n容量计算");
test("单组容量 = 重量 × 次数", function () {
  assert.strictEqual(L.entryVolume({ name: "x", sets: [{ weight: 60, reps: 8 }] }), 480);
});
test("多组容量累加", function () {
  var entry = { name: "x", sets: [{ weight: 60, reps: 8 }, { weight: 60, reps: 6 }] };
  assert.strictEqual(L.entryVolume(entry), 840);
});
test("整次训练容量跨动作累加", function () {
  var session = {
    date: "2026-02-10",
    entries: [
      { name: "卧推", sets: [{ weight: 60, reps: 8 }] },
      { name: "深蹲", sets: [{ weight: 80, reps: 5 }] },
    ],
  };
  assert.strictEqual(L.sessionVolume(session), 880);
});

console.log("\nbestSet：先比重量，再比次数");
test("挑最重的一组", function () {
  var entry = { name: "x", sets: [{ weight: 60, reps: 10 }, { weight: 70, reps: 5 }] };
  assert.strictEqual(L.bestSet(entry).weight, 70);
});
test("重量相同时挑次数多的", function () {
  var entry = { name: "x", sets: [{ weight: 60, reps: 5 }, { weight: 60, reps: 9 }] };
  assert.strictEqual(L.bestSet(entry).reps, 9);
});
test("空组返回 null", function () {
  assert.strictEqual(L.bestSet({ name: "x", sets: [] }), null);
});

console.log("\nnormalizeSession：清洗与合并");
test("没有有效组返回 null", function () {
  assert.strictEqual(L.normalizeSession({ date: "2026-02-10", entries: [] }), null);
});
test("日期格式不对返回 null", function () {
  assert.strictEqual(
    L.normalizeSession({ date: "2月10日", entries: [{ name: "卧推", sets: [{ weight: 60, reps: 8 }] }] }),
    null
  );
});
test("同名动作自动合并成一条", function () {
  var cleaned = L.normalizeSession({
    date: "2026-02-10",
    entries: [
      { name: "卧推", sets: [{ weight: 60, reps: 8 }] },
      { name: "卧推", sets: [{ weight: 65, reps: 5 }] },
    ],
  });
  assert.strictEqual(cleaned.entries.length, 1);
  assert.strictEqual(cleaned.entries[0].sets.length, 2);
});
test("坏组被丢掉，好组保留", function () {
  var cleaned = L.normalizeSession({
    date: "2026-02-10",
    entries: [{ name: "卧推", sets: [{ weight: 60, reps: 8 }, { weight: "", reps: 5 }] }],
  });
  assert.strictEqual(cleaned.entries[0].sets.length, 1);
});

console.log("\n历史查询");
var sessions = [
  { date: "2026-02-01", entries: [{ name: "卧推", sets: [{ weight: 50, reps: 10 }] }] },
  { date: "2026-02-08", entries: [{ name: "卧推", sets: [{ weight: 60, reps: 8 }] }] },
  { date: "2026-02-05", entries: [{ name: "深蹲", sets: [{ weight: 80, reps: 5 }] }] },
];
test("上次成绩取日期最新的那次，与数组顺序无关", function () {
  assert.strictEqual(L.lastForExercise(sessions, "卧推").date, "2026-02-08");
});
test("没练过的动作返回 null", function () {
  assert.strictEqual(L.lastForExercise(sessions, "硬拉"), null);
});
test("曲线按日期正序给点", function () {
  var series = L.seriesForExercise(sessions, "卧推");
  assert.deepStrictEqual(
    series.map(function (p) { return p.date; }),
    ["2026-02-01", "2026-02-08"]
  );
});
test("PR 取历史最大重量", function () {
  assert.strictEqual(L.prForExercise(sessions, "卧推").weight, 60);
});
test("PR 重量相同时取次数更多的那次（回归：曾退回较早的 60×8）", function () {
  var tie = [
    { date: "2026-02-03", entries: [{ name: "卧推", sets: [{ weight: 60, reps: 8 }] }] },
    { date: "2026-02-10", entries: [{ name: "卧推", sets: [{ weight: 60, reps: 10 }] }] },
  ];
  var pr = L.prForExercise(tie, "卧推");
  assert.strictEqual(pr.reps, 10);
  assert.strictEqual(pr.date, "2026-02-10");
});
test("统计总次数与总容量", function () {
  var s = L.stats(sessions);
  assert.strictEqual(s.sessions, 3);
  assert.strictEqual(s.volume, 50 * 10 + 60 * 8 + 80 * 5);
});

console.log("\n单位换算（磅 / kg）");
test("111 lb 换算成 kg ≈ 50.35", function () {
  assert.strictEqual(Math.round(L.setToKg({ weight: 111, reps: 8, unit: "lb" }) * 100) / 100, 50.35);
});
test("kg 组换算后不变", function () {
  assert.strictEqual(L.setToKg({ weight: 60, reps: 8, unit: "kg" }), 60);
});
test("kg 转 lb 再转回来基本回到原值", function () {
  var lb = L.kgToUnit(60, "lb");
  assert.strictEqual(Math.round(lb * 100) / 100, 132.28);
  assert.strictEqual(Math.round((lb * L.KG_PER_LB) * 1000) / 1000, 60);
});
test("混合单位的容量按 kg 累加", function () {
  var entry = {
    name: "卧推",
    sets: [
      { weight: 60, reps: 8, unit: "kg" },   // 480
      { weight: 111, reps: 8, unit: "lb" },  // 50.35 × 8 ≈ 402.79
    ],
  };
  assert.strictEqual(Math.round(L.entryVolume(entry) * 10) / 10, 882.8);
});
test("跨单位比大小要换算：50kg 胜过 111lb", function () {
  var entry = {
    name: "卧推",
    sets: [
      { weight: 50, reps: 5, unit: "kg" },
      { weight: 111, reps: 5, unit: "lb" }, // 50.35kg，其实比 50kg 重
    ],
  };
  // 111lb = 50.35kg > 50kg，所以最好一组应该是磅那组
  assert.strictEqual(L.bestSet(entry).unit, "lb");
});
test("不能直接比较数字：111lb 不该被当成 111kg", function () {
  var entry = {
    name: "卧推",
    sets: [
      { weight: 60, reps: 5, unit: "kg" },
      { weight: 111, reps: 5, unit: "lb" }, // 50.35kg < 60kg
    ],
  };
  assert.strictEqual(L.bestSet(entry).weight, 60);
});
test("PR 跨单位比较也换算", function () {
  var mixed = [
    { date: "2026-02-01", entries: [{ name: "卧推", sets: [{ weight: 50, reps: 5, unit: "kg" }] }] },
    { date: "2026-02-08", entries: [{ name: "卧推", sets: [{ weight: 111, reps: 5, unit: "lb" }] }] },
  ];
  // 50kg = 110.2lb，111lb = 50.35kg，后者更大
  assert.strictEqual(L.prForExercise(mixed, "卧推").date, "2026-02-08");
});
test("数字格式化不吐出一长串小数", function () {
  assert.strictEqual(L.fmtNumber(60), "60");
  assert.strictEqual(L.fmtNumber(50.3495367), "50.3");
});
test("一组的展示文案带单位", function () {
  assert.strictEqual(L.formatSet({ weight: 111, reps: 8, unit: "lb" }), "111lb × 8");
});

console.log("\n摘要文案");
test("摘要格式正确，且带单位", function () {
  var text = L.summarizeSession({
    date: "2026-02-10",
    entries: [
      { name: "卧推", sets: [{ weight: 60, reps: 8 }, { weight: 60, reps: 6 }] },
      { name: "深蹲", sets: [{ weight: 80, reps: 5 }] },
    ],
  });
  assert.strictEqual(text, "卧推 60kg×8×2 · 深蹲 80kg×5×1");
});
test("摘要里磅的动作显示 lb 而不是 kg（回归：曾漏出 undefined）", function () {
  var text = L.summarizeSession({
    date: "2026-02-10",
    entries: [{ name: "坐姿划船", sets: [{ weight: 111, reps: 8, unit: "lb" }] }],
  });
  assert.strictEqual(text, "坐姿划船 111lb×8×1");
});

console.log("\n体重记录");
test("合法体重原样保留", function () {
  assert.deepStrictEqual(L.normalizeWeightEntry({ date: "2026-02-10", kg: 72.5 }), { date: "2026-02-10", kg: 72.5 });
});
test("体重保留一位小数", function () {
  assert.strictEqual(L.normalizeWeightEntry({ date: "2026-02-10", kg: 72.46 }).kg, 72.5);
});
test("0 或负体重返回 null", function () {
  assert.strictEqual(L.normalizeWeightEntry({ date: "2026-02-10", kg: 0 }), null);
  assert.strictEqual(L.normalizeWeightEntry({ date: "2026-02-10", kg: -3 }), null);
});
test("离谱体重大于 500kg 返回 null", function () {
  assert.strictEqual(L.normalizeWeightEntry({ date: "2026-02-10", kg: 800 }), null);
});
test("日期格式不对返回 null", function () {
  assert.strictEqual(L.normalizeWeightEntry({ date: "2/10", kg: 72 }), null);
});
test("同一天再存会覆盖，不会多出一条", function () {
  var entries = L.upsertWeight([], { date: "2026-02-10", kg: 72.5 });
  entries = L.upsertWeight(entries, { date: "2026-02-10", kg: 71.8 });
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].kg, 71.8);
});
test("写入后按日期正序排列，与写入顺序无关", function () {
  var entries = L.upsertWeight([], { date: "2026-02-10", kg: 72 });
  entries = L.upsertWeight(entries, { date: "2026-02-01", kg: 74 });
  assert.deepStrictEqual(entries.map(function (e) { return e.date; }), ["2026-02-01", "2026-02-10"]);
});
test("最近体重取日期最新的那条", function () {
  var entries = [
    { date: "2026-02-01", kg: 74 },
    { date: "2026-02-10", kg: 72 },
  ];
  assert.strictEqual(L.latestWeight(entries).kg, 72);
});
test("没有体重记录时最近体重为 null", function () {
  assert.strictEqual(L.latestWeight([]), null);
});
test("体重变化 = 最新减最初，只有一条时为 null", function () {
  assert.strictEqual(L.weightChange([{ date: "2026-02-01", kg: 74 }]), null);
  assert.strictEqual(
    L.weightChange([{ date: "2026-02-01", kg: 74 }, { date: "2026-02-10", kg: 72.4 }]),
    -1.6
  );
});
test("坏数据进 upsertWeight 时原样返回旧数组，不污染数据", function () {
  var entries = [{ date: "2026-02-01", kg: 74 }];
  assert.strictEqual(L.upsertWeight(entries, { date: "bad", kg: 70 }).length, 1);
});

console.log("\n热量估算（MET）");
test("复合动作 MET 是 6.0", function () {
  assert.strictEqual(L.metForExercise("卧推"), 6.0);
});
test("孤立动作 MET 更低", function () {
  assert.strictEqual(L.metForExercise("二头弯举"), 3.5);
});
test("没收录的动作按 5.0 兜底", function () {
  assert.strictEqual(L.metForExercise("某个没听说过的动作"), 5.0);
});
test("热量 = MET × 体重 × 时长 × 组数", function () {
  // 卧推 6.0 × 70kg × (120/3600)h × 3 组 = 42
  var entry = { name: "卧推", sets: [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }, { weight: 60, reps: 8 }] };
  assert.strictEqual(L.caloriesForEntry(entry, 70), 42);
});
test("体重越大估算越高", function () {
  var entry = { name: "卧推", sets: [{ weight: 60, reps: 8 }] };
  assert.ok(L.caloriesForEntry(entry, 90) > L.caloriesForEntry(entry, 70));
});
test("没有体重时按 70kg 兜底，不会算成 0", function () {
  var entry = { name: "卧推", sets: [{ weight: 60, reps: 8 }] };
  assert.strictEqual(L.caloriesForEntry(entry, null), 14);
});
test("空动作算 0 卡", function () {
  assert.strictEqual(L.caloriesForEntry({ name: "卧推", sets: [] }, 70), 0);
});
test("整次训练热量跨动作累加", function () {
  var session = {
    date: "2026-02-10",
    entries: [
      { name: "卧推", sets: [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }] }, // 6.0×70×2min×2 = 28
      { name: "二头弯举", sets: [{ weight: 15, reps: 10 }] },                    // 3.5×70×2min×1 ≈ 8
    ],
  };
  assert.strictEqual(L.caloriesForSession(session, 70), 36);
});
test("取训练当天或之前最近的体重，不是最新的体重", function () {
  var weights = [
    { date: "2026-01-01", kg: 80 },
    { date: "2026-02-01", kg: 78 },
    { date: "2026-03-01", kg: 75 },
  ];
  assert.strictEqual(L.bodyKgOn(weights, "2026-02-15"), 78);
});
test("训练日期早于所有体重记录时用最早那条", function () {
  var weights = [{ date: "2026-03-01", kg: 75 }];
  assert.strictEqual(L.bodyKgOn(weights, "2026-01-01"), 75);
});
test("没有体重记录时返回 null，由调用方兜底", function () {
  assert.strictEqual(L.bodyKgOn([], "2026-02-15"), null);
});

console.log("\n" + passed + " 条通过, " + failed + " 条失败\n");
if (failed > 0) process.exit(1);
