/*
 * browser-check.mjs — 在真浏览器里把应用点一遍并截图。
 *
 * 为什么需要它：单元测试只能证明「算得对」，证明不了「点得动」。
 * 这个脚本干四件事：
 *   1. 起一个静态服务器（不依赖 python / npm）
 *   2. 用 Chrome 无头模式打开页面
 *   3. 用 DevTools 协议模拟真人操作：选动作 → 填重量次数 → 保存 → 刷新看数据还在不在
 *   4. 截图存到 shot/，供人眼复核
 *
 * 跑法：node test/browser-check.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HTTP_PORT = 8766;
const DEBUG_PORT = 9333;
const OUT_DIR = path.join(APP_DIR, "shot");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function startServer() {
  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const filePath = path.join(APP_DIR, urlPath === "/" ? "index.html" : urlPath);
    if (!filePath.startsWith(APP_DIR)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(HTTP_PORT, "127.0.0.1", () => resolve(server)));
}

async function waitFor(url, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("等待超时: " + url);
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    ws.addEventListener("open", () =>
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { res, rej }));
        },
        close() { ws.close(); },
      })
    );
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      }
    });
    ws.addEventListener("error", reject);
  });
}

/** 在页面里执行的脚本：模拟真人点一遍。 */
const INTERACTION = `
(async () => {
  const wait = () => new Promise(r => setTimeout(r, 60));
  const errors = [];
  window.addEventListener('error', e => errors.push(String(e.message)));

  document.querySelector('#entries'); // 断言容器存在

  // 1. 选动作「卧推」并加进来
  const select = document.getElementById('exercise-select');
  select.value = '卧推';
  document.getElementById('add-exercise').click();
  await wait();

  // 2. 填第一组：60kg × 8
  const rows = document.querySelectorAll('#entries .set-row');
  const firstRow = rows[0];
  const inputs = firstRow.querySelectorAll('input');
  if (inputs.length < 2) throw new Error('没找到重量/次数输入框');
  inputs[0].value = '60';
  inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  inputs[1].value = '8';
  inputs[1].dispatchEvent(new Event('input', { bubbles: true }));

  // 3. 再加两组，验证「同名动作合并 + 多组累加」
  //    注意选 .ghost：单位按钮也是 .mini，用 .mini 会点到它而不是「+ 一组」
  document.querySelector('#entries .entry button.ghost').click();
  await wait();
  document.querySelector('#entries .entry button.ghost').click();
  await wait();
  const allRows = document.querySelectorAll('#entries .set-row');
  [[1, '60', '6'], [2, '60', '5']].forEach(([i, w, r]) => {
    const ins = allRows[i].querySelectorAll('input');
    ins[0].value = w; ins[0].dispatchEvent(new Event('input', { bubbles: true }));
    ins[1].value = r; ins[1].dispatchEvent(new Event('input', { bubbles: true }));
  });

  // 4. 再练一个动作「深蹲」，验证跨动作
  select.value = '深蹲';
  document.getElementById('add-exercise').click();
  await wait();
  const squatRow = document.querySelectorAll('#entries .entry')[1].querySelector('.set-row');
  const squatInputs = squatRow.querySelectorAll('input');
  squatInputs[0].value = '80'; squatInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  squatInputs[1].value = '5'; squatInputs[1].dispatchEvent(new Event('input', { bubbles: true }));

  // 5. 保存
  document.getElementById('save').click();
  await wait();

  // 6. 记体重，同一天连续存两次，验证「覆盖而不是堆两条」
  document.getElementById('weight-date').value = '2026-02-11';
  const wKg = document.getElementById('weight-kg');
  wKg.value = '72.4';
  wKg.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('save-weight').click();
  await wait();
  wKg.value = '72.1';
  wKg.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('save-weight').click();
  await wait();

  // 7. 切到磅，用磅记一台器械（111 lb），验证「原样保存、不被改写成 kg」
  document.querySelectorAll('#unit-switch button')[1].click(); // lb
  await wait();
  const custom = document.getElementById('custom-exercise');
  custom.value = '坐姿划船';
  document.getElementById('add-custom').click();
  await wait();
  const lastEntry = [...document.querySelectorAll('#entries .entry')].pop();
  const rowInputs = lastEntry.querySelector('.set-row').querySelectorAll('input');
  rowInputs[0].value = '111'; rowInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  rowInputs[1].value = '10'; rowInputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  const rowUnitLabel = lastEntry.querySelector('.unit-btn').textContent;

  // 8. 单组单位按钮：点一下应从 lb 换成 kg，数字跟着换算（111 lb → 50.3）
  lastEntry.querySelector('.unit-btn').click();
  await wait();
  const afterToggleUnit = document.querySelector('#entries .entry:last-child .unit-btn').textContent;
  const afterToggleWeight = document.querySelector('#entries .entry:last-child .set-row input').value;

  // 再切回磅，保证存进去的是磅；同时记录数值，验证来回切换不漂移
  document.querySelector('#entries .entry:last-child .unit-btn').click();
  await wait();
  const weightAfterToggleBack = document.querySelector('#entries .entry:last-child .set-row input').value;
  document.getElementById('save').click();
  await wait();

  const stored = JSON.parse(localStorage.getItem('fitness-tracker-v1') || '[]');
  const storedWeights = JSON.parse(localStorage.getItem('fitness-tracker-weight-v1') || '[]');
  const lbSession = stored.find(s => s.entries.some(e => e.name === '坐姿划船'));
  const lbSet = lbSession ? lbSession.entries.find(e => e.name === '坐姿划船').sets[0] : null;

  return {
    errors,
    blockedDialog: null,
    statSessions: document.getElementById('stat-sessions').textContent,
    statVolume: document.getElementById('stat-volume').textContent,
    statExercises: document.getElementById('stat-exercises').textContent,
    historyItems: document.querySelectorAll('#history .hist-item').length,
    historyText: document.querySelector('#history .hist-body')?.textContent || '',
    storedCount: stored.length,
    storedVolume: stored[0] ? stored[0].entries.reduce((s, e) => s + e.sets.reduce((a, st) => a + st.weight * st.reps, 0), 0) : 0,
    lastHint: document.querySelector('#entries .hint')?.textContent.trim() || '',
    weightStats: document.getElementById('weight-stats').textContent.trim(),
    weightRows: document.querySelectorAll('#weight-list .hist-top').length,
    storedWeightCount: storedWeights.length,
    storedWeightKg: storedWeights[0] ? storedWeights[0].kg : null,
    weightInputCleared: document.getElementById('weight-kg').value === '',
    rowUnitLabel,
    afterToggleUnit,
    afterToggleWeight,
    weightAfterToggleBack,
    lbStored: lbSet ? { weight: lbSet.weight, unit: lbSet.unit } : null,
    lbHistoryText: lbSession ? [...document.querySelectorAll('#history .hist-body')].map(n => n.textContent).find(t => t.includes('坐姿划船')) : null,
    unitPrefPersisted: localStorage.getItem('fitness-tracker-unit-v1'),
    statCalories: document.getElementById('stat-calories').textContent,
    firstSessionKcalNote: document.querySelector('#history .hist-item:last-child .hist-note')?.textContent || '',
  };
})()
`;

/** 刷新后检查数据是否还在（localStorage 持久化）。 */
const RELOAD_CHECK = `
(() => {
  const stored = JSON.parse(localStorage.getItem('fitness-tracker-v1') || '[]');
  const storedWeights = JSON.parse(localStorage.getItem('fitness-tracker-weight-v1') || '[]');
  return {
    storedCount: stored.length,
    storedWeightCount: storedWeights.length,
    historyItems: document.querySelectorAll('#history .hist-item').length,
    statSessions: document.getElementById('stat-sessions').textContent,
    prText: document.getElementById('pr').textContent.trim(),
    weightStats: document.getElementById('weight-stats').textContent.trim(),
    lbSurvived: JSON.stringify(stored).includes('"unit":"lb"'),
    unitPrefSurvived: localStorage.getItem('fitness-tracker-unit-v1'),
    statCalories: document.getElementById('stat-calories').textContent,
    chartPixels: (() => {
      const c = document.getElementById('chart');
      const g = c.getContext('2d');
      const data = g.getImageData(0, 0, c.width, c.height).data;
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
      return painted; // 0 说明曲线没画出来
    })(),
    weightChartPixels: (() => {
      const c = document.getElementById('weight-chart');
      const g = c.getContext('2d');
      const data = g.getImageData(0, 0, c.width, c.height).data;
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
      return painted;
    })(),
  };
})()
`;

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const server = await startServer();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-check-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--user-data-dir=" + profile,
    "--remote-debugging-port=" + DEBUG_PORT,
    "--window-size=430,1600",
    "about:blank",
  ], { stdio: "ignore" });

  const report = { steps: [], screenshots: [] };
  try {
    await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    report.steps.push("浏览器启动成功，DevTools 可用");

    const target = await (await fetch(
      `http://127.0.0.1:${DEBUG_PORT}/json/new?http://127.0.0.1:${HTTP_PORT}/index.html`,
      { method: "PUT" }
    )).json();

    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 430, height: 1600, deviceScaleFactor: 2, mobile: true,
    });
    await new Promise((r) => setTimeout(r, 700));

    const boot = await cdp.send("Runtime.evaluate", {
      expression: "({ready: document.readyState, hasLogic: !!window.FitnessLogic, hasSelect: document.getElementById('exercise-select').options.length})",
      returnByValue: true,
    });
    report.steps.push("页面加载: " + JSON.stringify(boot.result.value));

    // 从干净状态开始
    await cdp.send("Runtime.evaluate", { expression: "localStorage.clear()" });
    await cdp.send("Page.reload");
    await new Promise((r) => setTimeout(r, 700));

    // 真点一遍
    const interaction = await cdp.send("Runtime.evaluate", {
      expression: INTERACTION, awaitPromise: true, returnByValue: true,
    });
    if (interaction.exceptionDetails) throw new Error("操作脚本报错: " + JSON.stringify(interaction.exceptionDetails));
    report.interaction = interaction.result.value;
    report.steps.push("模拟操作完成：选动作→填3组→加第2个动作→保存");

    const shot1 = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await fs.writeFile(path.join(OUT_DIR, "after-record.png"), Buffer.from(shot1.data, "base64"));
    report.screenshots.push("shot/after-record.png");

    // 刷新，验证数据还在
    await cdp.send("Page.reload");
    await new Promise((r) => setTimeout(r, 900));
    const reload = await cdp.send("Runtime.evaluate", { expression: RELOAD_CHECK, returnByValue: true });
    report.afterReload = reload.result.value;
    report.steps.push("刷新后数据检查完成");

    // 截图：正在填写的一组，混用 kg 和 lb（这是单位功能最该被看见的样子）
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/index.html` });
    await new Promise((r) => setTimeout(r, 900));
    const draft = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const wait = () => new Promise(r => setTimeout(r, 80));
        document.querySelectorAll('#unit-switch button')[1].click(); // 默认 lb
        await wait();
        document.getElementById('exercise-select').value = '卧推';
        document.getElementById('add-exercise').click();
        await wait();
        document.querySelector('#entries .entry button.ghost').click(); // 第二组
        await wait();
        const rows = [...document.querySelectorAll('#entries .set-row')];
        [['111', '10'], ['111', '8']].forEach(([w, r], i) => {
          const ins = rows[i].querySelectorAll('input');
          ins[0].value = w; ins[0].dispatchEvent(new Event('input', { bubbles: true }));
          ins[1].value = r; ins[1].dispatchEvent(new Event('input', { bubbles: true }));
        });
        rows[1].querySelector('.unit-btn').click(); // 第二组切回 kg，演示混用
        await wait();
        return {
          units: [...document.querySelectorAll('#entries .unit-btn')].map(b => b.textContent),
          weights: [...document.querySelectorAll('#entries .set-row')].map(r => r.querySelectorAll('input')[0].value),
          setCount: document.querySelectorAll('#entries .set-row').length,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    report.draftMixedUnits = draft.result.value;
    report.steps.push("混合单位填写状态检查完成");
    const shot3 = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await fs.writeFile(path.join(OUT_DIR, "draft-units.png"), Buffer.from(shot3.data, "base64"));
    report.screenshots.push("shot/draft-units.png");

    // 示例模式截图（看曲线长什么样）
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/index.html?demo=1` });
    await new Promise((r) => setTimeout(r, 1200));
    const shot2 = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await fs.writeFile(path.join(OUT_DIR, "demo.png"), Buffer.from(shot2.data, "base64"));
    report.screenshots.push("shot/demo.png");

    const demoCheck = await cdp.send("Runtime.evaluate", {
      expression: "({banner: !document.getElementById('demo-banner').hidden, history: document.querySelectorAll('#history .hist-item').length, pr: document.getElementById('pr').textContent.trim()})",
      returnByValue: true,
    });
    report.demoMode = demoCheck.result.value;

    cdp.close();
  } finally {
    chrome.kill();
    server.close();
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("检查失败:", error.message);
  process.exit(1);
});
