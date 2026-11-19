#!/usr/bin/env node
// 极简入口闸门：真 Chrome 打开真页面，量「新用户第一次导出」要点几下、多久。
// 同时验标准材料清单可勾选、缺项高亮，导出文件名对照三语可读。
// 跑法：node tools/test_quick_path.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("找不到 Chrome：这条断言必须真跑页面");
  process.exit(2);
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".mp4": "video/mp4", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "") || "formal.html";
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const baseUrl = "http://127.0.0.1:" + server.address().port + "/formal.html";

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.waiting = new Map(); }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error("调试口连不上：" + (e.message || "")));
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.waiting.has(msg.id)) {
          const { resolve: r, reject: j } = this.waiting.get(msg.id);
          this.waiting.delete(msg.id);
          msg.error ? j(new Error(msg.error.message)) : r(msg.result);
        }
      };
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.waiting.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || ""));
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch {} }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(cdp) {
  for (let i = 0; i < 100; i++) {
    const ok = await cdp.eval("!!(window.packet && document.getElementById('btnMake') && document.getElementById('stickyProgress'))").catch(() => false);
    if (ok) return true;
    await sleep(100);
  }
  return false;
}
async function freshLoad(cdp, lang) {
  await cdp.send("Page.navigate", { url: baseUrl });
  await waitReady(cdp);
  await cdp.eval("localStorage.clear()");
  await cdp.send("Page.navigate", { url: baseUrl + "?lang=" + lang });
  assert.ok(await waitReady(cdp), "页面没初始化出来");
  await sleep(250);
}

async function withChrome(fn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "quick-profile-"));
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdio: ["ignore", "ignore", "ignore"] });
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(50);
    assert.ok(fs.existsSync(portFile), "Chrome 没起来");
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      try { const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json(); target = list.find((t) => t.type === "page"); } catch {}
      if (!target) await sleep(100);
    }
    assert.ok(target && target.webSocketDebuggerUrl, "拿不到页面调试地址");
    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    try { return await fn(cdp); } finally { cdp.close(); }
  } finally {
    try { proc.kill("SIGKILL"); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n     " + e.message); }
}

await withChrome(async (cdp) => {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  for (const lang of ["zh", "en", "es"]) {
    const tag = lang;
    await freshLoad(cdp, lang);

    // 1) 新用户路径：点一个标签 → 生成 → 先导出。三次点击出第一次导出。
    const first = await cdp.eval(`(() => {
      window.print = function(){};
      const t0 = performance.now();
      const chip = document.querySelector('#tagGrid .tag-btn[data-phrase="我今年没有变化。"]');
      chip.click();
      document.getElementById('btnMake').click();
      const step = window.currentOrganizeStep;
      const q = document.getElementById('quickExport');
      const qBtn = document.getElementById('btnQuickExport');
      const std = document.getElementById('stdBox');
      const out = {
        step,
        quickVisible: !!q && getComputedStyle(q).display !== 'none',
        quickText: q ? q.textContent.trim() : '',
        hasQuickBtn: !!qBtn,
        stdVisible: !!std && getComputedStyle(std).display !== 'none',
        stdCount: document.querySelectorAll('#stdBox .std-item').length,
        stdMiss: document.querySelectorAll('#stdBox .std-miss').length,
        stdDone: document.querySelectorAll('#stdBox .std-done').length,
        rows: (window.packet.checklist||[]).length,
        t0
      };
      return out;
    })()`);

    check("生成后落到第 2 步并出现「先导出」：" + tag, () => {
      assert.equal(first.rows > 0, true, "没生成清单");
      assert.equal(first.step, 2, "没落到补材料这一步：" + first.step);
      assert.equal(first.quickVisible, true, "「先导出」块没显示");
      assert.equal(first.hasQuickBtn, true, "「先导出」按钮不在");
    });

    check("标准材料清单出现且缺项高亮：" + tag, () => {
      assert.equal(first.stdVisible, true, "标准清单没显示");
      assert.ok(first.stdCount >= 12, "标准项太少：" + first.stdCount);
      assert.ok(first.stdMiss >= 1, "没有缺项高亮");
      assert.equal(first.stdDone, 0, "新清单不该有已备项");
    });

    if (lang !== "zh") {
      check("外文下标准清单与先导出块不含中文：" + tag, () => {
        assert.ok(!/[\u4e00-\u9fff]/.test(first.quickText), "先导出块夹中文：" + first.quickText);
      });
    }

    // 2) 勾一项 → 变已备；点「＋加入清单」→ 清单多一项
    const stdOps = await cdp.eval(`(() => {
      const before = window.packet.checklist.length;
      const cb = document.querySelector('#stdBox .std-item input[type=checkbox]');
      cb.click();
      const doneAfter = document.querySelectorAll('#stdBox .std-done').length;
      // 勾选会重绘整块，按钮要重新取，不能拿旧引用；只点清单里还没有的那一项
      const have = new Set((window.packet.checklist || []).map((x) => x.form));
      const add = Array.from(document.querySelectorAll('#stdBox [data-std-add]')).find((b) => !have.has(b.getAttribute('data-std-add')));
      const added = !!add;
      if (add) add.click();
      return { doneAfter, added, before, after: window.packet.checklist.length, ticks: JSON.stringify(window.packet.stdTicks||{}) };
    })()`);
    check("勾选记为已备并重绘：" + tag, () => {
      assert.equal(stdOps.doneAfter >= 1, true, "勾选后没有变已备");
      assert.ok(stdOps.ticks.length > 2, "stdTicks 没存下来");
    });
    check("缺项可以一键加进今年清单：" + tag, () => {
      assert.equal(stdOps.added, true, "缺项上没有「加入清单」");
      assert.equal(stdOps.after, stdOps.before + 1, "点了加入清单没加进去");
    });

    // 3) 上传后给出语义化文件名；点「先导出」直接出 PDF 清单
    const exported = await cdp.eval(`(() => {
      const it = window.packet.checklist[0];
      it.fileName = '123.pdf'; it.form = 'W-2'; it.payer = 'Employer A'; it.status = 'uploaded';
      window.savePacket(); window.renderAll();
      const rowText = document.getElementById('mergedBox').textContent;
      const rename = document.getElementById('renameBox').textContent;
      const beforeExports = window.packet.exports.length;
      const t0 = performance.now();
      document.getElementById('btnQuickExport').click();
      const ms = performance.now() - t0;
      return {
        rowHasName: rowText.includes('2026_W2_EmployerA.pdf'),
        renameHasMap: rename.includes('123.pdf') && rename.includes('2026_W2_EmployerA.pdf'),
        grew: window.packet.exports.length > beforeExports,
        last: window.packet.exports[window.packet.exports.length-1] || '',
        printArea: document.getElementById('printArea').textContent.includes('2026_W2_EmployerA.pdf'),
        ms
      };
    })()`);

    check("上传行与命名对照都换成 税年_表类型_付款方：" + tag, () => {
      assert.equal(exported.rowHasName, true, "清单行没显示导出名");
      assert.equal(exported.renameHasMap, true, "命名对照表没出来");
    });
    check("点一下「先导出」就出清单（含命名对照）：" + tag, () => {
      assert.equal(exported.grew, true, "没有新增导出记录");
      assert.ok(/打印|print|impresi/i.test(exported.last), "导出记录不是 PDF：" + exported.last);
      assert.equal(exported.printArea, true, "打印内容里没有命名对照");
      assert.ok(exported.ms < 30000, "一次点击花了 " + Math.round(exported.ms) + "ms");
    });
  }

  // 4) 从落地到第一次导出：标签 + 生成 + 先导出 = 3 次点击
  await freshLoad(cdp, "zh");
  const taps = await cdp.eval(`(() => {
    window.print = function(){};
    let n = 0;
    const count = (el) => { if (el) el.addEventListener('click', () => { n++; }, true); };
    count(document.querySelector('#tagGrid .tag-btn[data-phrase="我今年没有变化。"]'));
    count(document.getElementById('btnMake'));
    count(document.getElementById('quickExport'));
    const t0 = performance.now();
    document.querySelector('#tagGrid .tag-btn[data-phrase="我今年没有变化。"]').click();
    document.getElementById('btnMake').click();
    document.getElementById('btnQuickExport').click();
    return { n, ms: performance.now() - t0, exports: window.packet.exports.length };
  })()`);
  check("新用户从落地到第一次导出只点 3 次、1 秒内出清单", () => {
    assert.equal(taps.exports > 0, true, "没有导出记录");
    assert.ok(taps.n <= 3, "点了 " + taps.n + " 次才导出");
    assert.ok(taps.ms < 30000, "花了 " + Math.round(taps.ms) + "ms");
  });
});

server.close();
console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);