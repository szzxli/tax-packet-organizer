#!/usr/bin/env node
// 验收：en / es 渲染后可见文本里不许有中文。
// 判的是真 Chrome 里的 document.body.innerText（不含 script/style/display:none），
// 不按源码 grep——源码里的中文是 zh 底稿，允许存在。
// 唯一允许保留中文的是语言切换按钮「中文」，每语言恰好 1 处。
// 跑法：node tools/test_i18n_visible.mjs          闸门，非 0 就 exit 1
//       node tools/test_i18n_visible.mjs --dump   打印「行号 + 原文」清单（做逐行对照用）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DUMP = process.argv.includes("--dump");

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("找不到 Chrome：这道闸门必须真渲染，不接受只断言字符串");
  process.exit(2);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json", ".pdf": "application/pdf",
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withChrome(fn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-profile-"));
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let i = 0; i < 120 && !fs.existsSync(portFile); i++) await sleep(50);
    assert.ok(fs.existsSync(portFile), "Chrome 没起来（没有 DevToolsActivePort）");
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

// 可见文本按行取：在真实页面上把语言切换那组按钮藏掉（唯一允许的「中文」就在里面），
// 直接读 document.body.innerText——不用克隆，否则隐藏分区与样式都会跟着变。
const EXTRACT = `(() => {
  const docLang = document.documentElement.lang;
  const st = document.createElement("style");
  st.textContent = ".lang-switch{display:none !important}";
  document.head.appendChild(st);
  const text = document.body.innerText || "";
  st.remove();
  const lines = text.split("\\n").map((s) => s.trim()).filter(Boolean);
  return JSON.stringify({ docLang, lines });
})()`;

async function readPage(cdp, lang) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Page.enable");
  await cdp.send("Page.navigate", { url: base + "/formal.html?lang=" + lang });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(150);
    try {
      const r = await cdp.send("Runtime.evaluate", {
        returnByValue: true,
        expression: `document.readyState === "complete" && typeof window.__TPO_LANG === "string"`,
      });
      ready = r.result.value === true;
    } catch {}
  }
  assert.ok(ready, lang + "：页面没加载完");
  await sleep(600);

  // 先生成一份清单：样例表、快照区、境外三问、交接抬头、付款与订单都在生成之后才出现，
  // 只量首屏会漏掉一大半（2026-11-12 竞品分析在整条流程里量到 39 行，首屏量到的是 0 行）。
  await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const chips = document.querySelectorAll("#tagGrid .tag-btn");
      for (let i = 0; i < Math.min(3, chips.length); i++) chips[i].click();
      const b = document.getElementById("btnMake");
      if (b) b.click();
    })()`,
  });
  await sleep(700);

  // 三个整理步骤 + 订阅页都要量：首屏干净不代表后面干净（付款/订单、样例表、快照区都在后面）
  const STATES = [
    { key: "第 1 步", js: "setOrganizeStep(1);renderAll()" },
    { key: "第 2 步", js: "setOrganizeStep(2);renderAll()" },
    { key: "第 3 步", js: "setOrganizeStep(3);renderAll()" },
    { key: "订阅页", js: "showPage(2);renderAll()" },
  ];
  const states = [];
  for (const st of STATES) {
    await cdp.send("Runtime.evaluate", { returnByValue: true, expression: "(() => {" + st.js + ";})()" });
    await sleep(250);
    const res = await cdp.send("Runtime.evaluate", { returnByValue: true, expression: EXTRACT });
    const got = JSON.parse(res.result.value);
    states.push({ key: st.key, docLang: got.docLang, lines: got.lines });
  }
  return { lang, states };
}

const CJK = /[\u4e00-\u9fff]/;
const out = await withChrome(async (cdp) => {
  const all = [];
  for (const lang of ["en", "es"]) all.push(await readPage(cdp, lang));
  return all;
});

let bad = 0;
const report = [];
for (const r of out) {
  for (const st of r.states) {
    const hits = st.lines.filter((s) => CJK.test(s));
    const pass = hits.length === 0 && st.docLang === r.lang;
    if (!pass) bad++;
    console.log(
      (pass ? "ok   " : "FAIL ") + r.lang + " · " + st.key +
      "：可见 " + st.lines.length + " 行，含中文 " + hits.length + " 行" +
      "，<html lang>=" + st.docLang
    );
    hits.forEach((s, i) => {
      console.log("     " + String(i + 1).padStart(2, " ") + ". " + s);
      report.push({ lang: r.lang, state: st.key, text: s });
    });
  }
}

if (DUMP) {
  console.log("\n| # | 语言 | 位置 | 原文（渲染后可见） |");
  console.log("|---|---|---|---|");
  report.forEach((r, i) => {
    console.log("| " + (i + 1) + " | " + r.lang + " | " + r.state + " | " + r.text.replace(/\|/g, "\\|") + " |");
  });
}

if (process.argv.includes("--missing")) {
  // 隐藏分区的中文文本节点也要有词典条目：它们现在不可见，但一展开就漏出来
  await withChrome(async (cdp) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url: base + "/formal.html?lang=en" });
    await sleep(2500);
    const res = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const I18N = window.I18N || {};
        const CJK = /[\\u4e00-\\u9fff]/;
        const out = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let n;
        while ((n = w.nextNode())) {
          const p = n.parentNode;
          if (!p || p.tagName === "SCRIPT" || p.tagName === "STYLE") continue;
          if (p.closest && p.closest(".lang-switch")) continue;
          const key = (n.nodeValue || "").trim();
          if (!key || !CJK.test(key)) continue;
          const e = I18N[key];
          if (!e || !e.en || !e.es) out.push(key);
        }
        return JSON.stringify(out);
      })()`,
    });
    const missing = JSON.parse(res.result.value);
    console.log("静态中文文本节点缺词典条目：" + missing.length + " 条\n");
    missing.forEach((s, i) => console.log(String(i + 1).padStart(3, " ") + ". " + s));
  });
  server.close();
  process.exit(0);
}

if (process.argv.includes("--all")) {
  for (const r of out) {
    for (const st of r.states) {
      console.log("\n===== " + r.lang + " · " + st.key + " 全部可见行 =====");
      st.lines.forEach((s, i) => console.log(String(i + 1).padStart(3, " ") + " | " + s));
    }
  }
}

console.log("\n" + (bad ? bad + " 个语言未通过" : "en/es 可见文本 0 处中文"));
server.close();
process.exit(bad ? 1 : 0);