#!/usr/bin/env node
// A/B 真浏览器闸门（11/17 批次）：
//   A 首屏「样例家庭最容易漏的 3 项」：三行、每行 项目 · 锁死日 · 后果、按日期升序、样例前提一行
//   B 缺项表两栏：按锁死日切分，过期行进「今年已经晚了」，未过期行进「还来得及改」，金额列留空
// 跑法：node tools/test_miss_due.mjs
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
  console.error("找不到 Chrome：布局断言必须真跑，不接受只断言字符串");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function withChrome(fn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sublayout-"));
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let i = 0; i < 120 && !fs.existsSync(portFile); i++) await sleep(50);
    assert.ok(fs.existsSync(portFile), "Chrome 没起来");
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
    let target = null;
    for (let i = 0; i < 80 && !target; i++) {
      try {
        const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
        target = list.find((t) => t.type === "page");
      } catch {}
      if (!target) await sleep(100);
    }
    assert.ok(target && target.webSocketDebuggerUrl, "拿不到页面调试地址");
    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    try { return await fn(cdp); } finally { cdp.close(); }
  } finally {
    try { proc.kill("SIGKILL"); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}


let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log("ok   " + name); pass++; }
  catch (e) { console.log("FAIL " + name + " — " + (e && e.message ? e.message : e)); fail++; }
}

const SETUP = `(() => {
  packet = newPacket();
  packet.lastYear = [{ form: "W-2", payer: "Acme" }];
  packet.checklist = [
    { form: "W-2", title: "今年 W-2（按去年每个雇主）", payer: "Acme", status: "uploaded" },
    { form: "1099-INT", title: "今年 1099-INT（按去年每个付款方）", payer: "Bank", status: "pending" }
  ];
  savePacket();
  renderAll();
  return true;
})()`;

const MEASURE = `(() => {
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const li = [...document.querySelectorAll("#missList li")].map((x) => clean(x.innerText));
  const pre = document.querySelector("#missCard .ms-pre");
  const cols = [...document.querySelectorAll("#dueCols .due-col")].map((c) => ({
    head: clean(c.querySelector("h5") ? c.querySelector("h5").innerText : ""),
    rows: [...c.querySelectorAll("tr")].slice(1).map((r) => [...r.children].map((td) => clean(td.innerText)))
  }));
  const card = document.getElementById("missCard");
  const rect = (id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY) }; };
  return JSON.stringify({
    li, pre: pre ? clean(pre.innerText) : null, cols,
    vh: innerHeight, miss: rect("missCard"), hero: rect("heroText"), make: rect("btnMake"),
    authHidden: (() => { const a = document.getElementById("authView"); return a ? getComputedStyle(a).display === "none" : null; })(),
    runHref: (() => { const a = document.querySelector(".head-cta a"); return a ? a.getAttribute("href") : null; })(),
    missVisible: card ? getComputedStyle(card).display !== "none" : false,
  });
})()`;

const got = await withChrome(async (cdp) => {
  const MIME = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "formal.html";
    const p = path.join(root, rel);
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end("nope"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(fs.readFileSync(p));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  await cdp.send("Page.enable");
  try {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await cdp.send("Page.navigate", { url: base + "/formal.html?lang=zh" });
    // 首访：不碰 packet，只等规则库到达。A 必须在这时就已经在首屏。
    await sleep(1800);
    const bootRaw = await cdp.send("Runtime.evaluate", { returnByValue: true, expression: MEASURE });
    const boot = JSON.parse(bootRaw.result.value);
    // 基线：把新块藏掉，同一屏再量一次按钮位置，用来判断这块是不是把按钮挤下去的
    const baseRaw = await cdp.send("Runtime.evaluate", { returnByValue: true, expression: `(() => {
      const c = document.getElementById("missCard"); if (c) c.style.display = "none";
      const e = document.getElementById("btnMake"); const r = e.getBoundingClientRect();
      const m = document.getElementById("missCard").getBoundingClientRect();
      return JSON.stringify({ makeTop: Math.round(r.top + scrollY), missH: Math.round(m.height), heroTop: Math.round(document.getElementById("heroText").getBoundingClientRect().top + scrollY), vh: innerHeight });
    })()` });
    boot.baseline = JSON.parse(baseRaw.result.value);
    await cdp.send("Runtime.evaluate", { expression: `(() => { const c = document.getElementById("missCard"); if (c) c.style.display = ""; })()` });
    const layRaw = await cdp.send("Runtime.evaluate", { returnByValue: true, expression: `(() => {
      const ids = ["startCard","posCard","missCard","heroBox","demoCard","btnMake","btnHeroGo"];
      const out = { body: document.body.className, vh: innerHeight, scroll: scrollY, items: {} };
      for (const id of ids) { const e = document.getElementById(id); if (!e) { out.items[id] = null; continue; }
        const r = e.getBoundingClientRect(); const st = getComputedStyle(e);
        out.items[id] = { top: Math.round(r.top + scrollY), h: Math.round(r.height), display: st.display, vis: st.visibility }; }
      return JSON.stringify(out);
    })()` });
    boot.layout = JSON.parse(layRaw.result.value);

    await cdp.send("Runtime.evaluate", { expression: SETUP });
    await sleep(400);
    const r = await cdp.send("Runtime.evaluate", { returnByValue: true, expression: MEASURE });
    return { boot, got: JSON.parse(r.result.value) };
  } finally {
    await new Promise((r) => server.close(r));
  }
});

const today = new Date().toISOString().slice(0, 10);
const A = got.boot, B = got.got;

check("A 三行都在，卡片可见", () => {
  assert.equal(A.missVisible, true, "missCard 是 hidden");
  assert.equal(A.li.length, 3, "不是三行：" + JSON.stringify(A.li));
});
check("A 每行是「身份 · 锁死日 · 后果」，三类身份齐、日期都未过期", () => {
  const want = ["在读", "自雇", "搬"];
  A.li.forEach((row, i) => {
    assert.ok(/\d{4}-\d{2}-\d{2}/.test(row), "这一行没有锁死日：" + row);
    assert.equal(row.split(" · ").length, 3, "不是三段：" + row);
    assert.ok(row.includes(want[i]), "第 " + (i + 1) + " 行不是「" + want[i] + "」那一类：" + row);
    const d = row.match(/\d{4}-\d{2}-\d{2}/)[0];
    assert.ok(d > today, "锁死日已经过期：" + d);
  });
});
check("A 末行是不判资格的声明，且三行里没有任何金额", () => {
  assert.ok(A.pre && A.pre.length <= 40, "声明行不对：" + A.pre);
  assert.match(A.pre, /不是资格认定/, "没有「不是资格认定」");
  for (const row of A.li) assert.ok(!/\$\d/.test(row), "三行里出现了金额：" + row);
});
check("A 三行紧跟输入卡之后（不再夹在图和输入框之间），且首屏主按钮在屏内", () => {
  // 2026-11-16 换序：812px 一屏放不下「问句＋三行＋位置图＋输入框」四块，
  // 按「下一步要够得着」把输入框提到关系图下面，三行后果顺到输入卡之后一行。
  const it = A.layout.items;
  assert.ok(it.missCard && it.missCard.h > 0, "块没渲染出高度");
  assert.ok(it.missCard.top >= it.heroBox.top + it.heroBox.h, "三行没接在输入卡后面：" + it.missCard.top + " < " + (it.heroBox.top + it.heroBox.h));
  assert.ok(it.missCard.top >= it.posCard.top + it.posCard.h, "三行压到了关系图");
  assert.ok(it.missCard.top <= it.heroBox.top + it.heroBox.h + 24, "三行离输入卡太远（>24px 空隙）");
  assert.ok(it.missCard.h <= 300, "块太高，" + it.missCard.h + "px（上限 300）");
  const mk = A.layout.items.btnMake;
  assert.ok(mk && mk.top + mk.h <= A.layout.vh, "首屏的「生成我的清单」被挤出一屏：bottom=" + (mk && mk.top + mk.h) + " vh=" + A.layout.vh);
});
check("首访不弹账号表单；陪跑链接带 ref=referral", () => {
  assert.equal(A.authHidden, true, "首访就把注册表单摊出来了");
  assert.match(A.runHref || "", /signup\.html\?ref=referral/, "陪跑链接没带 ref：" + A.runHref);
});
check("B 两栏，标题字面量固定", () => {
  assert.equal(B.cols.length, 2, "不是两栏");
  assert.match(B.cols[0].head, /还来得及改/);
  assert.match(B.cols[1].head, /今年已经晚了/);
});
check("B 过期进「今年已经晚了」、未过期进「还来得及改」", () => {
  const late = B.cols[1].rows.map((r) => r[4]).join(" ");
  const soon = B.cols[0].rows.map((r) => r[4]).join(" ");
  assert.ok(/\d{4}-\d{2}-\d{2}/.test(late), "已过期那栏没有带日期的行");
  for (const d of late.match(/\d{4}-\d{2}-\d{2}/g) || []) assert.ok(d < today, "这栏里混进了未过期的日期：" + d);
  for (const d of soon.match(/\d{4}-\d{2}-\d{2}/g) || []) assert.ok(d >= today, "这栏里混进了已过期的日期：" + d);
});
check("B 每行六列，金额列留空（不写金额）", () => {
  const rows = B.cols.flatMap((c) => c.rows);
  assert.ok(rows.length >= 5, "行数太少：" + rows.length);
  for (const r of rows) {
    assert.equal(r.length, 6, "不是六列：" + JSON.stringify(r));
    assert.equal(r[2], "—", "金额列不该有值：" + JSON.stringify(r));
  }
});
check("B 清单行也在表里（W-2 / 1099-INT）", () => {
  const all = B.cols.flatMap((c) => c.rows).map((r) => r[0]).join(" | ");
  assert.match(all, /W-2/);
  assert.match(all, /1099-INT/);
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
