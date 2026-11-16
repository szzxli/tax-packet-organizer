#!/usr/bin/env node
// 被删词条的运行时复核：把「判成死键」的中文串拿去驱动整页，
// 只要它在任何一个状态里作为 DOM 文本 / placeholder / aria-label 出现，
// 就说明这条词条是运行时拼出来的，删错了。
// 跑法：node tools/i18n_deleted_probe.mjs /tmp/deleted_keys.json
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = process.argv[2] === "scan";
const listFile = SCAN ? null : process.argv[2];
if (!SCAN && !listFile) {
  console.error("用法：node tools/i18n_deleted_probe.mjs <deleted_keys.json> | scan");
  process.exit(2);
}
const deleted = SCAN ? [] : JSON.parse(fs.readFileSync(listFile, "utf8"));
const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("找不到 Chrome");
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

const SETUP = `(() => {
  packet = newPacket();
  packet.lastYear = [{ form: "W-2", payer: "Acme" }];
  packet.checklist = [
    { form: "W-2", title: "今年 W-2（按去年每个雇主）", payer: "Acme", status: "uploaded" },
    { form: "1099-INT", title: "今年 1099-INT（按去年每个付款方）", payer: "Bank", status: "pending" }
  ];
  savePacket();
  return true;
})()`;

const STATES = [
  "renderAll()",
  "setOrganizeStep(1);renderAll()",
  "setOrganizeStep(2);renderAll()",
  "setOrganizeStep(3);renderAll()",
  "showPage(1);renderAll()",
  "showPage(2);renderAll()",
  "showPage(3);renderAll()",
  "renderPlanCards()",
  "try{printPlanSheet()}catch(e){}",
  "try{renderCpa();renderDraft();renderExports();renderMiss();renderDue();renderOutlook();renderForeign();renderProbe();renderDeep();renderSnaps();renderPriority();renderReminders();renderOrders();renderPriorCpa();renderCheckSummary();renderMerged();renderChanges();renderLast();renderReturnState();renderPricing();renderWarnings();}catch(e){}",
  "try{showExportGuide()}catch(e){}",
];

const CJK_COLLECT = `(() => {
  const out = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  let n;
  while ((n = w.nextNode())) {
    const p = n.parentNode;
    if (!p || p.tagName === "SCRIPT" || p.tagName === "STYLE") continue;
    if (p.closest && p.closest(".lang-switch")) continue;
    const v = (n.nodeValue || "").replace(/\\s+/g, " ").trim();
    if (v && /[\\u4e00-\\u9fff]/.test(v)) out.add(v);
  }
  document.querySelectorAll("input[placeholder],textarea[placeholder]").forEach((el) => {
    const v = (el.getAttribute("placeholder") || "").trim();
    if (/[\\u4e00-\\u9fff]/.test(v)) out.add("placeholder: " + v);
  });
  document.querySelectorAll("[aria-label]").forEach((el) => {
    const v = (el.getAttribute("aria-label") || "").trim();
    if (/[\\u4e00-\\u9fff]/.test(v)) out.add("aria: " + v);
  });
  return JSON.stringify([...out]);
})()`;

const COLLECT = (keys) => `(() => {
  const keys = ${JSON.stringify(keys)};
  const set = new Set(keys);
  const hits = new Set();
  const add = (s) => { const v = (s || "").replace(/\\s+/g, " ").trim(); if (v && set.has(v)) hits.add(v); };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  let n;
  while ((n = w.nextNode())) {
    const p = n.parentNode;
    if (!p || p.tagName === "SCRIPT" || p.tagName === "STYLE") continue;
    add(n.nodeValue);
    // 拼出来的标题常带前后缀（如「2026 税年 · …」），所以也按包含关系查一次
    const v = (n.nodeValue || "").replace(/\\s+/g, " ").trim();
    if (v) for (const k of keys) if (v.includes(k)) hits.add(k);
  }
  document.querySelectorAll("input[placeholder],textarea[placeholder]").forEach((el) => add(el.getAttribute("placeholder")));
  document.querySelectorAll("[aria-label]").forEach((el) => add(el.getAttribute("aria-label")));
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => add(el.getAttribute("data-i18n-ph")));
  ["printArea", "planCards", "cpaBox", "draftArea", "exportsList"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) { const v = (el.textContent || "").replace(/\\s+/g, " "); for (const k of keys) if (v.includes(k)) hits.add(k); }
  });
  return JSON.stringify([...hits]);
})()`;

const out = await (async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "i18nprobe-"));
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  const MIME = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "formal.html";
    const p = path.join(root, rel);
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end("nope"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(fs.readFileSync(p));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
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
    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    try {
      await cdp.send("Page.enable");
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.send("Page.navigate", { url: base + "/formal.html?lang=" + (SCAN ? "en" : "zh") });
      await sleep(2000);
      const hits = new Set();
      for (const st of STATES) {
        await cdp.send("Runtime.evaluate", { returnByValue: true, expression: `(() => { try { ${SETUP} } catch(e){} try { ${st}; } catch(e){} return true; })()` });
        await sleep(200);
        const raw = await cdp.send("Runtime.evaluate", { returnByValue: true, expression: SCAN ? CJK_COLLECT : COLLECT(deleted) });
        for (const k of JSON.parse(raw.result.value)) hits.add(k);
      }
      return [...hits];
    } finally {
      cdp.close();
    }
  } finally {
    try { proc.kill("SIGKILL"); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    server.close();
  }
})();

if (SCAN) {
  console.log("en 模式、全状态残留中文：" + out.length + " 处");
  out.forEach((k) => console.log("  " + k));
  process.exit(out.length ? 1 : 0);
}
console.log("仍被用到、不该删的词条：" + out.length);
out.forEach((k) => console.log("  " + k));
fs.writeFileSync("/tmp/needed_keys.json", JSON.stringify(out, null, 0));