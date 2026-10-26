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
  assert.deepStrictEqual(L.normalizeSet({ weight: 60, reps: 8 }), { weight: 60, reps: 8 });
});
test("重量 0 合法（自重动作）", function () {
  assert.deepStrictEqual(L.normalizeSet({ weight: 0, reps: 15 }), { weight: 0, reps: 15 });
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

console.log("\n摘要文案");
test("摘要格式正确", function () {
  var text = L.summarizeSession({
    date: "2026-02-10",
    entries: [
      { name: "卧推", sets: [{ weight: 60, reps: 8 }, { weight: 60, reps: 6 }] },
      { name: "深蹲", sets: [{ weight: 80, reps: 5 }] },
    ],
  });
  assert.strictEqual(text, "卧推 60×8×2 · 深蹲 80×5×1");
});

console.log("\n" + passed + " 条通过, " + failed + " 条失败\n");
if (failed > 0) process.exit(1);
