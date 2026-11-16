#!/usr/bin/env node
// 首屏重量探针（成本那条尺子）：
//   1) 真浏览器量 375×812 首访的 domContentLoaded / load / 首次可交互
//   2) 逐个渲染器单独计时（不看自述，看毫秒）
//   3) 数出首访被写入但父容器不可见的渲染器（白跑的活）
// 跑法：node tools/perf_probe.mjs [--json]
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
  console.error("找不到 Chrome：重量必须真跑，不接受按源码估算");
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "perfprobe-"));
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

// 每个渲染器写到哪个容器；用于判断「写进去了但看不见」。
const TARGETS = `(() => {
  const map = {};
  const fns = ["renderChanges","renderLast","renderMerged","renderExports","renderCpa","renderDraft",
    "renderCommuteRules","renderWarnings","renderSubStatus","renderPlanCards","renderOrders","renderPriorCpa",
    "renderReminders","renderProbe","renderDeep","renderSnaps","renderPriority","renderCheckSummary","renderMiss",
    "renderDue","renderReturnState","renderForeign","renderPricing","renderDemo","applyCollapse","syncNavChrome",
    "renderStickyProgress","renderHero","renderFollowUp","applyOrganizeStep","applyLean"];
  return fns.join(",");
})()`;

const PROBE = `(() => {
  const nav = performance.getEntriesByType("navigation")[0] || {};
  const res = performance.getEntriesByType("resource").map((r) => ({
    name: r.name.split("/").pop(), bytes: r.encodedBodySize || 0, ms: Math.round(r.duration)
  }));
  // 逐个渲染器计时（单独跑，互不占便宜）
  const fns = ${TARGETS}.split(",").filter((n) => typeof window[n] === "function");
  const timings = [];
  for (const n of fns) {
    const t0 = performance.now();
    let err = null;
    try { window[n](); } catch (e) { err = String(e && e.message || e); }
    timings.push({ name: n, ms: +(performance.now() - t0).toFixed(1), err });
  }
  // 整轮
  const t0 = performance.now();
  try { renderAll(); } catch (e) {}
  const allMs = +(performance.now() - t0).toFixed(1);
  // 首访可见性：页面上所有带 id 的容器，哪些不可见
  const hiddenIds = new Set();
  document.querySelectorAll("[id]").forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") hiddenIds.add(el.id);
  });
  const vis = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { if (hiddenIds.has(n.id)) return false; } return true; };
  const invisibleWritten = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!el.id) continue;
    if (!el.textContent || !el.textContent.trim()) continue;
    if (el.children.length > 6) continue;
    if (!vis(el)) invisibleWritten.push(el.id);
  }
  const heavy = timings.slice().sort((a, b) => b.ms - a.ms);
  return JSON.stringify({
    nav: {
      ttfb: Math.round(nav.responseStart || 0),
      dcl: Math.round(nav.domContentLoadedEventEnd || 0),
      load: Math.round(nav.loadEventEnd || 0),
      transfer: nav.transferSize || 0,
      decoded: nav.decodedBodySize || 0,
    },
    resources: res.sort((a, b) => b.bytes - a.bytes).slice(0, 8),
    renderers: heavy,
    rendererTotal: +timings.reduce((s, x) => s + x.ms, 0).toFixed(1),
    renderAllMs: allMs,
    invisibleWrittenCount: invisibleWritten.length,
    invisibleWritten: invisibleWritten.slice(0, 20),
    vh: innerHeight,
    firstBtn: (() => { const b = document.querySelector("#btnMake, #btnMake2, .head-cta a"); if (!b) return null; const r = b.getBoundingClientRect(); return Math.round(r.top + scrollY); })(),
  }, null, 2);
})()`;

const out = await withChrome(async (cdp) => {
  const MIME = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".mp4": "video/mp4", ".jpg": "image/jpeg", ".png": "image/png" };
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
    await sleep(2000);
    const raw = await cdp.send("Runtime.evaluate", { returnByValue: true, expression: PROBE });
    return JSON.parse(raw.result.value);
  } finally {
    server.close();
  }
});

console.log(JSON.stringify(out, null, 2));