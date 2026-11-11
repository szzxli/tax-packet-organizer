#!/usr/bin/env node
// 窄屏闸门：375 视口下，首屏那两块（事件条 + 三行结论）不许把整页横向撑开。
// 真跑布局：起一个真 Chrome，用它的调试口把视口精确设成 375×812，再读 documentElement 的 scrollWidth / clientWidth。
// 跑法：node tools/test_narrow.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "formal.html"), "utf8");
const graph = JSON.parse(fs.readFileSync(path.join(root, "rules", "graph.json"), "utf8"));

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("找不到 Chrome：窄屏断言必须真跑布局，不接受只断言字符串");
  process.exit(2);
}

// ---- 用页面自己的函数渲染那两块 ----
const store = {};
const sandbox = {
  LANG: "zh", packet: null, console, Math, Number, String, Object, Array, JSON,
  parseInt, parseFloat, isFinite, Infinity, Date,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  esc: (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
  tr: (zh, en, es) => (sandbox.LANG === "en" ? en : sandbox.LANG === "es" ? es : zh),
  procProfileLoad: () => ({ ssPoints: "34", eduUsed: "1" }),
};
vm.createContext(sandbox);
sandbox.RULES = graph;
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b));
vm.runInContext(slice("// PLAN_CARDS_LOGIC_START", "// PLAN_CARDS_LOGIC_END"), sandbox);
vm.runInContext(slice("// OUTLOOK_LOGIC_START", "// OUTLOOK_LOGIC_END"), sandbox);

// 页面里的全部样式，原样搬过来（窄屏问题就是样式问题，不能自己造一份）
const STYLES = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
assert.ok(STYLES.includes(".one-thing"), "没抽到 .one-thing 的样式");

const STATE = { status: "single", dep: "1", income: "85000", withheld: "9000", tuition: "20000", retire: "", mkt: "", premium: "", mortgage: "" };

function barsHtml(lang, withEvent) {
  sandbox.LANG = lang;
  sandbox.procProfileLoad = () => (withEvent ? { ssPoints: "34", eduUsed: "1" } : { ssPoints: "", eduUsed: "1" });
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(STATE));
  const out = sandbox.outlookHtml(true);
  return out.slice(0, out.indexOf("<h2>"));
}

function pageFor(bars) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${STYLES}</style>
<style>html,body{margin:0;padding:0}</style>
</head><body>
<div style="padding:0 12px"><div class="card" style="padding:12px;box-sizing:border-box">${bars}</div></div>
</body></html>`;
}

// ---- 一个最小的调试口客户端 ----
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "narrow-profile-"));
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(50);
    assert.ok(fs.existsSync(portFile), "Chrome 没起来（没有 DevToolsActivePort）");
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
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

async function measure(cdp, bars) {
  const file = path.join(os.tmpdir(), "narrow-" + Math.random().toString(36).slice(2) + ".html");
  fs.writeFileSync(file, pageFor(bars), "utf8");
  // 精确设视口：375×812、DPR 1、按手机处理——和验收同一种量法
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Page.enable");
  await cdp.send("Page.navigate", { url: "file://" + file });
  await sleep(400);
  const res = await cdp.send("Runtime.evaluate", {
    expression: "JSON.stringify({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,iw:innerWidth})",
    returnByValue: true,
  });
  fs.rmSync(file, { force: true });
  return JSON.parse(res.result.value);
}

const results = [];
function check(name, fn) {
  try { fn(); results.push(["ok  ", name]); }
  catch (e) { results.push(["FAIL", name + " — " + e.message]); }
}

const cases = [];
for (const lang of ["zh", "en", "es"]) for (const withEvent of [true, false]) cases.push({ lang, withEvent });

const got = await withChrome(async (cdp) => {
  const out = [];
  for (const c of cases) {
    const bars = barsHtml(c.lang, c.withEvent);
    assert.ok(bars.includes("outlookOneThing"), c.lang + " 没渲染出三行结论");
    if (c.withEvent) assert.ok(bars.includes('id="policyBar"'), c.lang + " 没渲染出事件条");
    out.push({ ...c, bars, box: await measure(cdp, bars) });
  }
  return out;
});

for (const c of got) {
  const label = c.lang + (c.withEvent ? "-有事件" : "-无事件");
  check("375 视口不横向溢出：" + label, () => {
    assert.equal(c.box.cw, 375, "视口不是 375（实际 " + c.box.cw + "）");
    assert.ok(c.box.sw <= c.box.cw, "整页被撑宽：scrollWidth=" + c.box.sw + " > clientWidth=" + c.box.cw);
  });
}

let bad = 0;
for (const [tag, msg] of results) { if (tag !== "ok  ") bad++; console.log(tag, msg); }
console.log("\n实测：" + got.map((c) => c.lang + (c.withEvent ? "+事件" : "") + " " + c.box.sw + "/" + c.box.cw).join(" · "));
console.log(`\n${results.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);